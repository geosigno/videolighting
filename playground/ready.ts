/** Shared by the compat and bench pages: wait until a video really shows frames. */

const READY_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const FIRST_FRAME_TIMEOUT_MS = 3000;

export function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

export function mediaErrorReason(video: HTMLVideoElement): string | undefined {
  const { error } = video;
  if (!error) {
    return;
  }
  return `MediaError ${error.code}${error.message ? ` : ${error.message}` : ""}`;
}

/** readyState can be optimistic: wait until a frame was really presented. */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (!("requestVideoFrameCallback" in video)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FIRST_FRAME_TIMEOUT_MS);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function waitReady(
  video: HTMLVideoElement,
  diagnostics?: () => string | undefined
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    const started = performance.now();
    const timer = setInterval(() => {
      const failure = mediaErrorReason(video) ?? diagnostics?.();
      const ready =
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0;
      const expired = performance.now() - started > READY_TIMEOUT_MS;
      if (ready) {
        clearInterval(timer);
        firstFrame(video).then(() => resolve({ ok: true }));
      } else if (failure || expired) {
        clearInterval(timer);
        resolve({
          ok: false,
          reason: failure ?? "aucune donnée vidéo (délai)",
        });
      }
    }, POLL_MS);
  });
}
