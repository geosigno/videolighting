import {
  type EdgeColors,
  type EdgeLayout,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  sampleEdges,
} from "./sample.js";

/** The image the page put in a `poster` slot next to the video: `<img slot="poster">`, or one inside a `<picture slot="poster">`. */
const slotted = (video: HTMLVideoElement) =>
  video.parentElement?.querySelector<HTMLImageElement>(
    'img[slot="poster"], [slot="poster"] img'
  );

/**
 * The poster's URL, from what names one, in this order: the video's own
 * `poster`; the `poster` attribute of its nearest ancestor that has one (a
 * player element, as in `<video-player poster>`); the image in a `poster` slot
 * (see `slotted`). Empty with none: an image that merely covers the video is
 * never guessed to be its poster.
 */
function posterUrl(video: HTMLVideoElement): string {
  if (video.poster) {
    return video.poster;
  }
  const named = video.parentElement
    ?.closest("[poster]")
    ?.getAttribute("poster");
  // An attribute is as it was written: resolve it as the browser does the video's.
  return named
    ? new URL(named, document.baseURI).href
    : (slotted(video)?.currentSrc ?? "");
}

/**
 * A poster, not a frame, is on screen until the video is first played or
 * sought: whatever its `readyState`. While that is so, the poster is the
 * picture. The video's own state comes first: this runs on every sampled frame.
 */
export const posterShown = (video: HTMLVideoElement) =>
  video.played.length === 0 &&
  video.currentTime === 0 &&
  posterUrl(video) !== "";

export interface PosterWatch {
  /** Read the poster again (a new source was set), if it is still the picture. */
  refresh: () => void;
  stop: () => void;
}

/**
 * Colors from the poster while it is what the video shows (see `posterShown`
 * and `posterUrl`), so an effect matches it and is not blank before the first
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
    // A player fills the image of its slot in late, and may swap it: read again then.
    slotted(video)?.addEventListener("load", read, { once: true });
    const url = posterUrl(video);
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
      if (stopped || posterUrl(video) !== url || !posterShown(video)) {
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
