import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
} from "react";
import type { MethodChoice } from "../internal.js";
import {
  ASPECTS,
  type Aspect,
  type EffectName,
  type PageState,
  VARIANTS,
  type Variant,
} from "./state.js";

/** Local clips first (fixed resolution, honest numbers), the Mux stream last. */
const SOURCES = [
  "mire.mp4",
  "mire60.mp4",
  "mire1080.webm",
  "mire4k.webm",
  "detail.mp4",
  "static.mp4",
  "mux",
];
const EFFECTS: EffectName[] = ["halo", "ambient", "theme"];
const METHODS: MethodChoice[] = ["auto", "webgl", "canvas"];

/** Keys 1 to 4 toggle the effects, outside form fields. */
function useEffectKeys(
  effects: EffectName[],
  setEffect: (name: EffectName, on: boolean) => void
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      const name = EFFECTS[Number(event.key) - 1];
      if (name) {
        setEffect(name, !effects.includes(name));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effects, setEffect]);
}

export function Controls({
  onAspect: chooseAspect,
  onChange,
  setEffect,
  state,
}: {
  /** A format chosen, even the current one: its size applies again. */
  onAspect: (aspect: Aspect) => void;
  onChange: (change: Partial<PageState>) => void;
  setEffect: (name: EffectName, on: boolean) => void;
  state: PageState;
}) {
  useEffectKeys(state.effects, setEffect);
  const onSource = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onChange({ src: event.target.value }),
    [onChange]
  );
  const onMethod = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onChange({ method: event.target.value as MethodChoice }),
    [onChange]
  );
  const onVariant = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) =>
      onChange({ [event.target.name]: event.target.value as Variant }),
    [onChange]
  );
  const onAspect = useCallback(
    (event: MouseEvent<HTMLButtonElement>) =>
      chooseAspect(event.currentTarget.value as Aspect),
    [chooseAspect]
  );
  const onMainThread = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      onChange({ mainThread: event.target.checked }),
    [onChange]
  );
  const onEffect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setEffect(event.target.value as EffectName, event.target.checked),
    [setEffect]
  );
  const sources = SOURCES.includes(state.src)
    ? SOURCES
    : [state.src, ...SOURCES];
  return (
    <div className="pg-controls">
      <label>
        source{" "}
        <select
          data-testid="source-select"
          onChange={onSource}
          value={state.src}
        >
          {sources.map((src) => (
            <option key={src} value={src}>
              {src === "mux" ? "Video.js demo (Mux, HLS)" : src}
            </option>
          ))}
        </select>
      </label>
      {EFFECTS.map((name, index) => (
        <label key={name} title={`key ${index + 1}`}>
          <input
            checked={state.effects.includes(name)}
            data-testid={`effect-${name}`}
            onChange={onEffect}
            type="checkbox"
            value={name}
          />{" "}
          {name}
        </label>
      ))}
      {EFFECTS.map((name) => (
        <label key={name}>
          {name} variant{" "}
          <select
            data-testid={`${name}-select`}
            name={name}
            onChange={onVariant}
            value={state[name]}
          >
            {VARIANTS.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
        </label>
      ))}
      <fieldset className="pg-aspects">
        <legend>format</legend>
        {ASPECTS.map((aspect) => (
          <button
            aria-pressed={state.aspect === aspect}
            data-testid={`aspect-${aspect}`}
            key={aspect}
            onClick={onAspect}
            type="button"
            value={aspect}
          >
            {aspect}
          </button>
        ))}
      </fieldset>
      <label>
        method{" "}
        <select
          data-testid="method-select"
          onChange={onMethod}
          value={state.method}
        >
          {METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
      </label>
      <details data-testid="advanced">
        <summary>Advanced</summary>
        <label>
          <input
            checked={state.mainThread}
            data-testid="main-thread"
            onChange={onMainThread}
            type="checkbox"
          />{" "}
          main thread (no Worker)
        </label>
      </details>
    </div>
  );
}
