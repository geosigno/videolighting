import type { MethodChoice } from "../../src/index.js";

export type EffectName = "halo" | "ambient" | "theme" | "letterbox";

export type Aspect = "16:9" | "4:3" | "21:9" | "9:16";

/** How the ambient effect draws: drifting blobs, or a blurred mosaic. */
export type AmbientVariant = "blobs" | "mosaic";

export interface PageState {
  aspect: Aspect;
  effects: EffectName[];
  mainThread: boolean;
  method: MethodChoice;
  panel: boolean;
  src: string;
  strict: boolean;
  variant: AmbientVariant;
}

const EFFECT_ORDER: readonly EffectName[] = [
  "halo",
  "ambient",
  "theme",
  "letterbox",
];
const METHODS: readonly MethodChoice[] = ["auto", "webgl", "canvas"];
export const ASPECTS: readonly Aspect[] = ["16:9", "4:3", "21:9", "9:16"];
export const VARIANTS: readonly AmbientVariant[] = ["blobs", "mosaic"];

/** Container size of each format: a fixed starting size, each fitting a 480 x 480 box. */
export const ASPECT_SIZES: Record<Aspect, { height: number; width: number }> = {
  "16:9": { height: 270, width: 480 },
  "21:9": { height: 206, width: 480 },
  "4:3": { height: 360, width: 480 },
  "9:16": { height: 480, width: 270 },
};

export const DEFAULTS: PageState = {
  aspect: "16:9",
  effects: [...EFFECT_ORDER],
  mainThread: false,
  method: "auto",
  panel: true,
  src: "mire.mp4",
  strict: true,
  variant: "blobs",
};

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return fallback;
}

function parseEffects(
  value: string | null,
  fallback: EffectName[]
): EffectName[] {
  if (value === null) {
    return [...fallback];
  }
  const asked = value.split(",");
  return EFFECT_ORDER.filter((name) => asked.includes(name));
}

function sameEffects(a: EffectName[], b: EffectName[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** `defaults` lets a page start from its own state (its source, its effects). */
export function parseState(
  search: string,
  defaults: PageState = DEFAULTS
): PageState {
  const params = new URLSearchParams(search);
  const method = params.get("method");
  const aspect = params.get("aspect");
  const variant = params.get("variant");
  return {
    aspect: ASPECTS.find((a) => a === aspect) ?? defaults.aspect,
    effects: parseEffects(params.get("effects"), defaults.effects),
    mainThread: parseBool(params.get("main"), defaults.mainThread),
    method: METHODS.find((m) => m === method) ?? defaults.method,
    panel: parseBool(params.get("panel"), defaults.panel),
    src: params.get("src") || defaults.src,
    strict: parseBool(params.get("strict"), defaults.strict),
    variant: VARIANTS.find((v) => v === variant) ?? defaults.variant,
  };
}

export function toSearch(
  state: PageState,
  defaults: PageState = DEFAULTS
): string {
  const params = new URLSearchParams();
  if (state.src !== defaults.src) {
    params.set("src", state.src);
  }
  if (!sameEffects(state.effects, defaults.effects)) {
    params.set("effects", state.effects.join(","));
  }
  if (state.method !== defaults.method) {
    params.set("method", state.method);
  }
  if (state.aspect !== defaults.aspect) {
    params.set("aspect", state.aspect);
  }
  if (state.variant !== defaults.variant) {
    params.set("variant", state.variant);
  }
  if (state.mainThread !== defaults.mainThread) {
    params.set("main", "1");
  }
  if (state.panel !== defaults.panel) {
    params.set("panel", "0");
  }
  if (state.strict !== defaults.strict) {
    params.set("strict", "0");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function nonDefault(
  state: PageState,
  defaults: PageState = DEFAULTS
): string[] {
  const labels: string[] = [];
  if (state.src !== defaults.src) {
    labels.push(`source: ${state.src}`);
  }
  if (!sameEffects(state.effects, defaults.effects)) {
    labels.push(`effects: ${state.effects.join(", ") || "none"}`);
  }
  if (state.method !== defaults.method) {
    labels.push(`method: ${state.method}`);
  }
  if (state.aspect !== defaults.aspect) {
    labels.push(`format: ${state.aspect}`);
  }
  if (state.variant !== defaults.variant) {
    labels.push(`variant: ${state.variant}`);
  }
  if (state.mainThread !== defaults.mainThread) {
    labels.push("main thread");
  }
  if (state.panel !== defaults.panel) {
    labels.push("panel off");
  }
  if (state.strict !== defaults.strict) {
    labels.push("StrictMode off");
  }
  return labels;
}
