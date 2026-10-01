import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";
import "./Sleeve.css";
import {
  drawSleeve,
  resolveSleevePalette,
  SLEEVE_MS,
  type SleeveFrame,
  type SleeveStripe,
} from "./sleeveCanvas";

/**
 * The finished screen's cover art (EXP-004): a canvas that animates the
 * exported tracks' lanes into a square of stripes. Under `prefers-reduced-motion`
 * it is drawn once, already landed. The animation owns its frame request and
 * cancels it when the screen goes.
 */

export interface SleeveProps {
  readonly stripes: readonly SleeveStripe[];
  readonly bars: number;
  readonly name: string;
  readonly meta: string;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Sleeve(props: SleeveProps): JSX.Element {
  let canvas!: HTMLCanvasElement;

  onSettled(() => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const box = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const frame: SleeveFrame = {
      width: box.width,
      height: box.height,
      stripes: props.stripes,
      bars: props.bars,
      name: props.name,
      meta: props.meta,
      palette: resolveSleevePalette(),
    };
    if (reducedMotion()) {
      drawSleeve(ctx, frame, 1);
      return undefined;
    }
    const start = performance.now();
    let request = 0;
    const step = (now: number) => {
      const progress = (now - start) / SLEEVE_MS;
      drawSleeve(ctx, frame, progress);
      if (progress < 1) request = requestAnimationFrame(step);
    };
    request = requestAnimationFrame(step);
    return () => cancelAnimationFrame(request);
  });

  return (
    <div class="export-sleeve">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Cover drawn from ${props.stripes.length} track colours`}
      />
    </div>
  );
}
