import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { GlowProvider } from "../../src/react/index.js";
import { Checks, readCheckParams } from "./checks.js";
import { Controls } from "./controls.js";
import { installHandle, recordError } from "./handle.js";
import { MetricsPanel } from "./metrics-panel.js";
import { createMetricsStore } from "./metrics-store.js";
import { Stage } from "./stage.js";
import {
  type Aspect,
  DEFAULTS,
  type EffectName,
  nonDefault,
  type PageState,
  parseState,
  toSearch,
} from "./state.js";
import "../base.css";
import "./page.css";

/** How a host starts the page: its own source and effects. */
export interface PageStart {
  /** Effects on when the URL names none (default: all four). */
  effects?: EffectName[];
  /** Source loaded when the URL names none. */
  src: string;
}

/**
 * The reference page: one video, the four effect components on it, the read
 * settings, and live metrics. The URL is the input (read once), and is kept
 * in step with every change; `window.glowPage` is the output.
 */
export function Page({ start }: { start: PageStart }) {
  // This page's own start counts as the default: the URL only carries the rest.
  const defaults = useMemo<PageState>(
    () => ({
      ...DEFAULTS,
      effects: start.effects ?? DEFAULTS.effects,
      src: start.src,
    }),
    [start.effects, start.src]
  );
  const [state, setState] = useState(() =>
    parseState(location.search, defaults)
  );
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [checkParams] = useState(() => readCheckParams(location.search));
  // Checks section: how many times it re-rendered the page (0 unless used).
  const [rerenders, setRerenders] = useState(0);
  const search = toSearch(state, defaults);
  const flagged = nonDefault(state, defaults);

  useEffect(() => {
    // Best effort: Safari throws past 100 calls in 10 s (rapid toggling).
    try {
      history.replaceState(null, "", `${location.pathname}${search}`);
    } catch {
      // The URL lags behind until the next change.
    }
  }, [search]);

  const change = useCallback(
    (next: Partial<PageState>) => setState((now) => ({ ...now, ...next })),
    []
  );
  // Every click on a format asks for its size again, the current one included
  // (after a drag): a new object each time.
  const [preset, setPreset] = useState(() => ({ aspect: state.aspect }));
  const chooseAspect = useCallback(
    (aspect: Aspect) => {
      change({ aspect });
      setPreset({ aspect });
    },
    [change]
  );
  const setEffect = useCallback(
    (name: EffectName, on: boolean) =>
      setState((now) => ({
        ...now,
        effects: on
          ? DEFAULTS.effects.filter(
              (e) => e === name || now.effects.includes(e)
            )
          : now.effects.filter((e) => e !== name),
      })),
    []
  );

  const toggleAll = useCallback(
    () =>
      setState((now) => ({
        ...now,
        effects: now.effects.length > 0 ? [] : [...DEFAULTS.effects],
      })),
    []
  );
  const rerender = useCallback((times: number) => {
    for (let i = 0; i < times; i += 1) {
      flushSync(() => setRerenders((n) => n + 1));
    }
  }, []);

  const anyEffect = useRef(state.effects.length > 0);
  useEffect(() => {
    anyEffect.current = state.effects.length > 0;
  }, [state.effects]);

  const store = useMemo(() => video && createMetricsStore(video), [video]);
  useEffect(() => {
    if (!(store && video)) {
      return;
    }
    store.start();
    installHandle(video, store.metrics, setEffect, () => anyEffect.current);
    return store.stop;
  }, [setEffect, store, video]);

  const options = useMemo(
    () => ({
      method: state.method,
      onError: recordError,
      worker: !state.mainThread,
    }),
    [state.method, state.mainThread]
  );

  // Once the Checks section re-renders the page: a new object and a new
  // inline `onError` on every render, which must restart nothing.
  const providerOptions =
    rerenders > 0
      ? { ...options, onError: (error: unknown) => recordError(error) }
      : options;

  return (
    <GlowProvider options={providerOptions} video={video}>
      <header className="pg-head">
        <h1>Glow reference page</h1>
        <Controls
          onAspect={chooseAspect}
          onChange={change}
          setEffect={setEffect}
          state={state}
        />
        {flagged.length > 0 && (
          <p className="pg-flag" data-testid="non-default">
            Non-default: {flagged.join(" · ")}{" "}
            <a data-testid="reset" href={location.pathname}>
              reset
            </a>
          </p>
        )}
      </header>
      <Stage
        effects={state.effects}
        lateVideoMs={checkParams.lateVideoMs}
        onVideo={setVideo}
        preset={preset}
        src={state.src}
        variant={state.variant}
        video={video}
      />
      {state.panel && (
        <MetricsPanel forced={state.method !== "auto"} store={store} />
      )}
      <Checks
        onRerender={rerender}
        rerenders={rerenders}
        src={state.src}
        toggleAll={toggleAll}
        video={video}
      />
    </GlowProvider>
  );
}

/** Mounts the page in `container`, under StrictMode unless the URL says `strict=0`. */
export function renderPage(container: HTMLElement, start: PageStart): void {
  const page = <Page start={start} />;
  createRoot(container).render(
    parseState(location.search).strict ? <StrictMode>{page}</StrictMode> : page
  );
}
