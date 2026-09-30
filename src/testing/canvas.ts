import { afterEach, beforeEach, vi } from "vitest";

/**
 * jsdom has no canvas, so a component that draws one is handed a null context
 * and draws nothing. Call it at the top of a test file that mounts such a
 * component (the Export dialog's lanes); it registers its own hooks.
 */
export function stubCanvasContext(): void {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
