/**
 * The DOM layer every effect draws in: a pointer-transparent child of the host,
 * behind its content. Several layers can share one host: the host's `position`
 * and `isolation` are saved once, when the first layer arrives, and restored
 * when the last one leaves, whatever the order they are destroyed in.
 */

export interface Layer {
  /** Remove the layer; the host's styles come back with the last layer. Idempotent. */
  destroy: () => void;
  element: HTMLElement;
  /** Set a CSS custom property; writes nothing if the value is the one already set. */
  setVar: (name: string, value: string) => void;
}

interface HostState {
  count: number;
  isolation: string;
  position: string;
}

/** Writes CSS custom properties on an element, skipping any value already there. */
export interface VarWriter {
  /** Remove every property this writer set. */
  clear: () => void;
  set: (name: string, value: string) => void;
}

export function createVarWriter(target: HTMLElement): VarWriter {
  const written = new Map<string, string>();
  return {
    clear: () => {
      for (const name of written.keys()) {
        target.style.removeProperty(name);
      }
      written.clear();
    },
    set: (name, value) => {
      if (written.get(name) !== value) {
        written.set(name, value);
        target.style.setProperty(name, value);
      }
    },
  };
}

const hosts = new WeakMap<HTMLElement, HostState>();

function acquireHost(host: HTMLElement) {
  const known = hosts.get(host);
  if (known) {
    known.count += 1;
    return;
  }
  hosts.set(host, {
    count: 1,
    isolation: host.style.isolation,
    position: host.style.position,
  });
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  host.style.isolation = "isolate";
}

function releaseHost(host: HTMLElement) {
  const state = hosts.get(host);
  if (!state) {
    return;
  }
  state.count -= 1;
  if (state.count <= 0) {
    host.style.isolation = state.isolation;
    host.style.position = state.position;
    hosts.delete(host);
  }
}

export function createLayer(host: HTMLElement): Layer {
  acquireHost(host);
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.style.cssText =
    "position:absolute;inset:0;z-index:-1;pointer-events:none";
  host.prepend(element);

  const writer = createVarWriter(element);
  let destroyed = false;
  return {
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      element.remove();
      releaseHost(host);
    },
    element,
    setVar: writer.set,
  };
}
