import Hls from "hls.js";

/**
 * What we expect from our plugin on a given video source, in Chrome:
 * - readable: colors can be extracted
 * - blocked: the video plays but the browser refuses to give its pixels
 * - noplay: the video itself never plays
 * - unknown: no prior knowledge, just observe
 *
 * Expectations were pinned from observed Chrome behavior: this page doubles as
 * a regression check. Other browsers are what we are here to discover.
 */
export type Expect = "readable" | "blocked" | "noplay" | "unknown";

/** Base URLs of the "other origins" started by `bun run servers`. */
export interface Urls {
  /** Full CORS. */
  cors: string;
  /** CORS headers on full responses only, missing on 206. */
  corsNoRange: string;
  /** No CORS headers at all. */
  noCors: string;
  /** Same origin as the page (relative URLs). */
  same: string;
}

export interface Prepared {
  cleanup?: () => void;
  /** Extra explanation shown when the video never becomes ready. */
  diagnostics?: () => string | undefined;
  video: HTMLVideoElement;
}

export type Preparation = Prepared | { skip: string };

export interface CompatCase {
  /** Runs once the video is ready, before reading colors (seeking, ...). */
  afterReady?: (video: HTMLVideoElement) => Promise<void>;
  detail: string;
  expect: Expect;
  group: string;
  id: string;
  prepare: (urls: Urls) => Promise<Preparation> | Preparation;
  title: string;
}

const MP4 = "/compat/mire.mp4";
const WEBM = "/compat/mire.webm";
const FRAGMENTED = "/compat/mire-frag.mp4";
const HLS_PLAYLIST = "/compat/hls/index.m3u8";
const ENCRYPTED = "/compat/mire-enc.mp4";
const H264_CODEC = 'video/mp4; codecs="avc1.64001E"';
const HLS_MIME = "application/vnd.apple.mpegurl";
/** Stream used by the Video.js 10 demo (hosted by Mux). */
export const MUX_URL =
  "https://stream.mux.com/BV3YZtogl89mg9VcNBhhnHm02Y34zI1nlMuMQfAbl3dM.m3u8";

// Same key as in make-assets.sh (ClearKey test, not representative of Widevine).
const CLEARKEY_KEY = "000102030405060708090a0b0c0d0e0f";
const CLEARKEY_KID = "101112131415161718191a1b1c1d1e1f";

function makeVideo(crossOrigin?: "anonymous"): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.width = 160;
  if (crossOrigin) {
    // Must be set before `src`, like an integrator would write the attribute.
    video.crossOrigin = crossOrigin;
  }
  return video;
}

export function plain(url: string, crossOrigin?: "anonymous"): Prepared {
  const video = makeVideo(crossOrigin);
  video.src = url;
  return { video };
}

function once(target: EventTarget, type: string, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for "${type}"`)),
      ms
    );
    target.addEventListener(
      type,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

async function seekToThreeSeconds(video: HTMLVideoElement): Promise<void> {
  video.currentTime = 3;
  try {
    await once(video, "seeked", 5000);
  } catch {
    // A failed seek shows up as a read error or a stalled video afterwards.
  }
}

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

async function blobVideo(url: string): Promise<Prepared> {
  const blob = await (await fetch(url)).blob();
  const objectUrl = URL.createObjectURL(blob);
  const video = makeVideo();
  video.src = objectUrl;
  return { cleanup: () => URL.revokeObjectURL(objectUrl), video };
}

/** What hls.js / dash.js do: fetch segments with CORS, play from a blob: URL. */
async function mediaSourceVideo(url: string): Promise<Preparation> {
  if (typeof MediaSource === "undefined") {
    return {
      skip: "MediaSource indisponible (iPhone avant iOS 17.1 : ManagedMediaSource non géré par ce test)",
    };
  }
  if (!MediaSource.isTypeSupported(H264_CODEC)) {
    return { skip: `codec non supporté en MediaSource : ${H264_CODEC}` };
  }
  const source = new MediaSource();
  const objectUrl = URL.createObjectURL(source);
  const video = makeVideo();
  video.src = objectUrl;
  await once(source, "sourceopen");
  const buffer = source.addSourceBuffer(H264_CODEC);
  const data = await (await fetch(url)).arrayBuffer();
  buffer.appendBuffer(data);
  await once(buffer, "updateend");
  return { cleanup: () => URL.revokeObjectURL(objectUrl), video };
}

export function hlsJsVideo(url: string): Preparation {
  if (!Hls.isSupported()) {
    return { skip: "hls.js non supporté (pas de MediaSource)" };
  }
  const video = makeVideo();
  const hls = new Hls();
  let fatal: string | undefined;
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      fatal = `hls.js ${data.type} / ${data.details}`;
    }
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return { cleanup: () => hls.destroy(), diagnostics: () => fatal, video };
}

export function nativeHlsVideo(
  url: string,
  crossOrigin?: "anonymous"
): Preparation {
  const video = makeVideo(crossOrigin);
  if (!video.canPlayType(HLS_MIME)) {
    return { skip: "HLS natif non supporté ici (normal hors Safari)" };
  }
  video.src = url;
  return { video };
}

/** A live-like source: a MediaStream fed by an animated canvas. */
function streamVideo(): Prepared {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  let step = 0;
  const timer = setInterval(() => {
    if (!context) {
      return;
    }
    step += 1;
    const hue = (step * 4) % 360;
    context.fillStyle = `hsl(${hue} 90% 50%)`;
    context.fillRect(0, 0, 160, 180);
    context.fillStyle = `hsl(${(hue + 120) % 360} 90% 50%)`;
    context.fillRect(160, 0, 160, 180);
  }, 40);
  const stream = canvas.captureStream(25);
  const video = makeVideo();
  video.srcObject = stream;
  return {
    cleanup: () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) {
        track.stop();
      }
    },
    video,
  };
}

/** Encrypted mp4 played through EME with the browser's ClearKey implementation. */
function emeVideo(url: string): Preparation {
  if (!navigator.requestMediaKeySystemAccess) {
    return { skip: "EME indisponible" };
  }
  const video = makeVideo();
  let problem: string | undefined;

  video.addEventListener("encrypted", async (event) => {
    try {
      const access = await navigator.requestMediaKeySystemAccess(
        "org.w3.clearkey",
        [
          {
            initDataTypes: [event.initDataType || "keyids", "cenc", "keyids"],
            videoCapabilities: [{ contentType: H264_CODEC }],
          },
        ]
      );
      const keys = await access.createMediaKeys();
      await video.setMediaKeys(keys);
      const session = keys.createSession();
      session.addEventListener("message", async () => {
        const license = {
          keys: [
            {
              k: base64Url(hexToBytes(CLEARKEY_KEY)),
              kid: base64Url(hexToBytes(CLEARKEY_KID)),
              kty: "oct",
            },
          ],
        };
        await session.update(new TextEncoder().encode(JSON.stringify(license)));
      });
      if (event.initData) {
        await session.generateRequest(event.initDataType, event.initData);
      }
    } catch (error) {
      problem = `EME : ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  video.src = url;
  return { diagnostics: () => problem, video };
}

export const CASES: CompatCase[] = [
  // --- Plain <video src> ---------------------------------------------------
  {
    detail: "Le cas le plus simple : fichier servi par le même site.",
    expect: "readable",
    group: "Fichier <video src>",
    id: "same-mp4",
    prepare: (urls) => plain(`${urls.same}${MP4}`),
    title: "Même origine, mp4",
  },
  {
    detail:
      "VP9. Safari a eu un bug qui traite tout WebM comme non lisible (WebKit 307812).",
    expect: "readable",
    group: "Fichier <video src>",
    id: "same-webm",
    prepare: (urls) => plain(`${urls.same}${WEBM}`),
    title: "Même origine, WebM",
  },
  {
    detail: "Fichier téléchargé par fetch puis joué depuis une URL blob:.",
    expect: "readable",
    group: "Fichier <video src>",
    id: "same-blob",
    prepare: (urls) => blobVideo(`${urls.same}${MP4}`),
    title: "Même origine, blob:",
  },
  {
    detail:
      "Autre origine, aucun en-tête CORS, pas d'attribut crossorigin. C'est le mur.",
    expect: "blocked",
    group: "Fichier <video src>",
    id: "x-nocors",
    prepare: (urls) => plain(`${urls.noCors}${MP4}`),
    title: "Autre origine, SANS CORS",
  },
  {
    detail:
      "Serveur avec CORS + attribut crossorigin=anonymous : le cas propre.",
    expect: "readable",
    group: "Fichier <video src>",
    id: "x-cors-attr",
    prepare: (urls) => plain(`${urls.cors}${MP4}`, "anonymous"),
    title: "Autre origine, CORS + crossorigin",
  },
  {
    detail:
      "Le serveur envoie CORS mais l'intégrateur a oublié l'attribut : la requête reste no-cors, donc bloqué.",
    expect: "blocked",
    group: "Fichier <video src>",
    id: "x-cors-noattr",
    prepare: (urls) => plain(`${urls.cors}${MP4}`),
    title: "Autre origine, CORS mais SANS l'attribut",
  },
  {
    detail:
      "Piège : l'attribut seul, sans CORS côté serveur, empêche la vidéo de charger.",
    expect: "noplay",
    group: "Fichier <video src>",
    id: "x-nocors-attr",
    prepare: (urls) => plain(`${urls.noCors}${MP4}`, "anonymous"),
    title: "Autre origine, attribut SANS CORS serveur",
  },
  {
    afterReady: seekToThreeSeconds,
    detail: "Un déplacement dans la vidéo déclenche des requêtes Range (206).",
    expect: "readable",
    group: "Fichier <video src>",
    id: "x-cors-seek",
    prepare: (urls) => plain(`${urls.cors}${MP4}`, "anonymous"),
    title: "CORS + déplacement (Range)",
  },
  {
    afterReady: seekToThreeSeconds,
    detail:
      "CDN mal configuré : CORS sur les réponses 200 mais pas sur les 206. Observé dans Chrome : la vidéo ne joue plus du tout (les lectures utilisent des requêtes Range).",
    expect: "noplay",
    group: "Fichier <video src>",
    id: "x-cors206-missing",
    prepare: (urls) => plain(`${urls.corsNoRange}${MP4}`, "anonymous"),
    title: "CORS absent sur les réponses 206",
  },

  // --- MediaSource and players ---------------------------------------------
  {
    detail:
      "Segments récupérés par fetch avec CORS puis ajoutés à un MediaSource, comme hls.js.",
    expect: "readable",
    group: "MediaSource et players",
    id: "mse-cors",
    prepare: (urls) => mediaSourceVideo(`${urls.cors}${FRAGMENTED}`),
    title: "MediaSource maison, segments CORS",
  },
  {
    detail: "hls.js, playlist et segments du même site.",
    expect: "readable",
    group: "MediaSource et players",
    id: "hlsjs-same",
    prepare: (urls) => hlsJsVideo(`${urls.same}${HLS_PLAYLIST}`),
    title: "hls.js, même origine",
  },
  {
    detail: "hls.js, playlist et segments sur un autre domaine avec CORS.",
    expect: "readable",
    group: "MediaSource et players",
    id: "hlsjs-cors",
    prepare: (urls) => hlsJsVideo(`${urls.cors}${HLS_PLAYLIST}`),
    title: "hls.js, autre origine + CORS",
  },
  {
    detail: "hls.js ne peut même pas lire les segments sans CORS.",
    expect: "noplay",
    group: "MediaSource et players",
    id: "hlsjs-nocors",
    prepare: (urls) => hlsJsVideo(`${urls.noCors}${HLS_PLAYLIST}`),
    title: "hls.js, autre origine SANS CORS",
  },
  {
    detail:
      "Le moteur du navigateur lit le HLS lui-même (Safari, iOS, et Chrome récent). Observé lisible dans Chrome ; à comparer sur Safari.",
    expect: "readable",
    group: "MediaSource et players",
    id: "native-hls-same",
    prepare: (urls) => nativeHlsVideo(`${urls.same}${HLS_PLAYLIST}`),
    title: "HLS natif, même origine",
  },
  {
    detail:
      "HLS natif, autre domaine avec CORS et attribut. Observé lisible dans Chrome ; à comparer sur Safari.",
    expect: "readable",
    group: "MediaSource et players",
    id: "native-hls-cors",
    prepare: (urls) =>
      nativeHlsVideo(`${urls.cors}${HLS_PLAYLIST}`, "anonymous"),
    title: "HLS natif, autre origine + CORS + attribut",
  },
  {
    detail:
      "HLS natif, autre domaine sans CORS : le cas iPhone le plus courant. Observé bloqué dans Chrome ; à comparer sur Safari.",
    expect: "blocked",
    group: "MediaSource et players",
    id: "native-hls-nocors",
    prepare: (urls) => nativeHlsVideo(`${urls.noCors}${HLS_PLAYLIST}`),
    title: "HLS natif, autre origine SANS CORS",
  },

  // --- Other sources -------------------------------------------------------
  {
    detail: "Flux généré (srcObject), comme un live ou une webcam.",
    expect: "readable",
    group: "Autres sources",
    id: "stream",
    prepare: () => streamVideo(),
    title: "MediaStream (srcObject)",
  },
  {
    detail:
      "Cas NON CONCLUANT : le fichier chiffré de test ne se décode pas dans Chrome (erreur de décodage), probablement un défaut de sa génération avec ffmpeg. Il ne représente de toute façon ni Widevine ni FairPlay, qui restent non testés.",
    expect: "unknown",
    group: "Autres sources",
    id: "eme-clearkey",
    prepare: (urls) => emeVideo(`${urls.same}${ENCRYPTED}`),
    title: "Vidéo chiffrée (EME ClearKey)",
  },

  // --- Real-world source: the Video.js 10 demo stream (Mux) -----------------
  {
    detail:
      "Flux HLS réel de la démo Video.js 10, hébergé par Mux (la playlist envoie access-control-allow-origin: *). Nécessite internet. Observé lisible dans Chrome.",
    expect: "readable",
    group: "Source réelle : démo Video.js 10 (Mux)",
    id: "mux-hlsjs",
    prepare: () => hlsJsVideo(MUX_URL),
    title: "Mux via hls.js",
  },
  {
    detail:
      "Le même flux en HLS natif, sans attribut crossorigin. Observé dans Chrome : refus de lecture (MediaError 4), cause non élucidée. Sur Safari (iPhone 16e, 27.2) : la vidéo joue mais ses images sont illisibles (SecurityError, vidéo « tainted »).",
    expect: "noplay",
    group: "Source réelle : démo Video.js 10 (Mux)",
    id: "mux-native",
    prepare: () => nativeHlsVideo(MUX_URL),
    title: "Mux en HLS natif, sans attribut",
  },
  {
    detail:
      "Le même flux en HLS natif avec crossorigin=anonymous, comme le ferait un intégrateur. Observé lisible dans Chrome (la qualité monte jusqu'à 4K).",
    expect: "readable",
    group: "Source réelle : démo Video.js 10 (Mux)",
    id: "mux-native-attr",
    prepare: () => nativeHlsVideo(MUX_URL, "anonymous"),
    title: "Mux en HLS natif, avec crossorigin",
  },
];
