export interface Size {
  height: number;
  width: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

const EMPTY: Rect = { height: 0, width: 0, x: 0, y: 0 };

/**
 * Where a video of size `media` lands in a `container`, as `object-fit: contain`
 * draws it: as large as fits, centred. A container or a video with no size
 * (metadata not loaded yet, element hidden) gives an empty rectangle, never NaN.
 */
export function fitRect(container: Size, media: Size): Rect {
  if (
    container.width <= 0 ||
    container.height <= 0 ||
    media.width <= 0 ||
    media.height <= 0
  ) {
    return EMPTY;
  }
  const scale = Math.min(
    container.width / media.width,
    container.height / media.height
  );
  const width = media.width * scale;
  const height = media.height * scale;
  return {
    height,
    width,
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
  };
}
