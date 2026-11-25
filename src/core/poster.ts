import {
  type EdgeColors,
  type EdgeLayout,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  sampleEdges,
} from "./sample.js";

/**
 * The browser shows the poster, not a frame, until the video is first played or
 * sought: whatever its `readyState`. While that is so, the poster is the picture.
 */
export const posterShown = (video: HTMLVideoElement) =>
  video.poster !== "" && video.played.length === 0 && video.currentTime === 0;

export interface PosterWatch {
  /** Read the poster again (a new source was set), if it is still the picture. */
  refresh: () => void;
  stop: () => void;
}

/**
 * Colors from the `poster` image while it is what the video shows (see
 * `posterShown`), so an effect matches it and is not blank before the first
 * frame. The poster is read as soon as it is set, and again when it changes.
 * Once the video has played or been sought, or if the image cannot be read (no
 * CORS), nothing is given: the frames take over.
 */
export function watchPoster(
  video: HTMLVideoElement,
  layout: EdgeLayout,
  deliver: (edges: EdgeColors) => void
): PosterWatch {
  let stopped = false;
  let canvas: HTMLCanvasElement | undefined;
  let loading: HTMLImageElement | undefined;

  const read = () => {
    const url = video.poster;
    if (stopped || !posterShown(video)) {
      return;
    }
    // A new source fires several events at once: one load is enough.
    if (loading && !loading.complete && loading.src === url) {
      return;
    }
    const image = new Image();
    loading = image;
    image.crossOrigin = video.crossOrigin ?? "anonymous";
    image.onload = () => {
      // The video may have started, or changed poster, while the image loaded.
      if (stopped || video.poster !== url || !posterShown(video)) {
        return;
      }
      try {
        canvas ??= document.createElement("canvas");
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          return;
        }
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const { data } = context.getImageData(
          0,
          0,
          SAMPLE_WIDTH,
          SAMPLE_HEIGHT
        );
        deliver(
          sampleEdges(
            data,
            SAMPLE_WIDTH,
            SAMPLE_HEIGHT,
            layout,
            image.naturalWidth / image.naturalHeight
          )
        );
      } catch {
        // A poster the page may not read (cross-origin without CORS): the frames will do.
      }
    };
    image.src = url;
  };

  const observer = new MutationObserver(read);
  observer.observe(video, { attributeFilter: ["poster"], attributes: true });
  read();

  return {
    refresh: read,
    stop: () => {
      stopped = true;
      observer.disconnect();
    },
  };
}
