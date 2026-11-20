import {
  type CSSProperties,
  type ElementType,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactNode,
  type RefAttributes,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ambient } from "../ambient/index.js";
import type { Effect, EffectOptions } from "../core/effect.js";
import { resolveVideo } from "../core/resolve-video.js";
import { halo } from "../halo/index.js";
import { letterbox } from "../letterbox/index.js";
import { theme } from "../theme/index.js";
import { useGlowContext } from "./provider.js";
import { useGlow } from "./use-glow.js";

export interface GlowComponentProps<O> {
  /** The element rendered, where the effect applies. Default `div`. */
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  options?: O & EffectOptions;
  style?: CSSProperties;
  /** Default: the provider's video, else the first `<video>` among the children. */
  video?: HTMLVideoElement | null;
}

/** A component that renders an element and runs `effect` on it. */
export function glowComponent<O>(
  effect: Effect<O>,
  name: string
): ForwardRefExoticComponent<
  GlowComponentProps<O> & RefAttributes<HTMLElement>
> {
  const Component = forwardRef<HTMLElement, GlowComponentProps<O>>(
    ({ as: Tag = "div", children, className, options, style, video }, ref) => {
      const context = useGlowContext();
      // Held in state, so the effect starts once the element exists.
      const [element, setElement] = useState<HTMLElement | null>(null);
      const setRef = useCallback(
        (node: HTMLElement | null) => {
          setElement(node);
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        },
        [ref]
      );
      const given = video ?? context.video;
      // Otherwise the first `<video>` inside, found after commit and again
      // whenever the children change (a video that arrives late or is swapped).
      const [found, setFound] = useState<HTMLVideoElement | null>(null);
      useEffect(() => {
        if (given || !element) {
          return;
        }
        const update = () => setFound(resolveVideo(element) ?? null);
        update();
        const observer = new MutationObserver(update);
        observer.observe(element, { childList: true, subtree: true });
        return () => observer.disconnect();
      }, [element, given]);
      useGlow(effect, { element, video: given ?? found }, options);
      return (
        <Tag className={className} ref={setRef} style={style}>
          {children}
        </Tag>
      );
    }
  );
  Component.displayName = name;
  return Component;
}

export const Halo = glowComponent(halo, "Halo");
export const Ambient = glowComponent(ambient, "Ambient");
export const Theme = glowComponent(theme, "Theme");
export const Letterbox = glowComponent(letterbox, "Letterbox");
