import { createGlReader } from "./gl-reader.js";
import { createReader, type MethodChoice, type ReadMethod } from "./reader.js";
import {
  type EdgeColors,
  type EdgeLayout,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
} from "./sample.js";

export interface SampleRequest {
  frame: VideoFrame;
  layout: EdgeLayout;
  /** Which way to read the frame; "auto" lets the reader measure and pick. */
  method: MethodChoice;
}

export interface SampleReply {
  colors: EdgeColors;
  /** How the frame was read. */
  method: ReadMethod;
  /** The frame was read both ways to compare them: `workerMs` is inflated. */
  probe: boolean;
  /** Time spent reading and reducing the frame, inside the worker. */
  workerMs: number;
}

// Reading the frame's pixels is what costs, not averaging them: it happens here,
// off the main thread.
const canvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
const context = canvas.getContext("2d", { willReadFrequently: true });
if (context) {
  // The default samples only a few source pixels per output pixel: on a 4K
  // frame squashed to 256×144 that aliases and makes the colors flicker.
  context.imageSmoothingQuality = "high";
}

let gl: ReturnType<typeof createGlReader>;
try {
  gl = createGlReader(SAMPLE_WIDTH, SAMPLE_HEIGHT);
} catch {
  gl = undefined;
}

/** One reader for the method asked for; recreated if the method changes. */
let current:
  | { method: MethodChoice; read: ReturnType<typeof createReader> }
  | undefined;

const readerFor = (method: MethodChoice) => {
  if (current?.method !== method) {
    current = {
      method,
      read: createReader({
        canvas: (frame) => {
          if (!context) {
            throw new Error("2D canvas context unavailable in worker");
          }
          context.drawImage(frame, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
          return context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
        },
        gl,
        method,
      }),
    };
  }
  return current.read;
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SampleRequest>) => void) | null;
  postMessage: (message: SampleReply) => void;
};

scope.onmessage = ({ data: { frame, layout, method } }) => {
  const start = performance.now();
  try {
    const { colors, method: used, probe } = readerFor(method)(frame, layout);
    scope.postMessage({
      colors,
      method: used,
      probe: probe === true,
      workerMs: performance.now() - start,
    });
  } finally {
    // Always release the frame: the decoder only has a few of them to hand out.
    frame.close();
  }
};
