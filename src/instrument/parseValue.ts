import type { ParameterDefinition } from "../domain/parameters";

/**
 * Reads what a person typed into a value field back into a parameter's own
 * unit, or null when it is not a value at all (#447). The field shows the
 * formatted value ("420 ms", "2.4 kHz", "L30"), so this accepts that same
 * spelling back, plus the short forms people actually type: `2.4k`, `120ms`,
 * `-inf`, `4:1`.
 *
 * A bare number means the unit the field was showing. For a time that read
 * "420 ms", `300` is 300 ms; for one that read "1.50 s", `2` is two seconds.
 * Percent-style normalized values (range `0..1`) read `45` as 45%.
 *
 * The result is not clamped: the caller hands it to the command layer, which
 * owns the range, so an out-of-range entry lands at the nearest edge exactly
 * as a drag past the end of a fader does.
 */
export function parseParameterInput(
  definition: ParameterDefinition,
  input: string,
  current: number,
  /** Labels for a stepped value whose index is the value (a delay division). */
  options?: readonly string[],
): number | null {
  const text = input.trim().toLowerCase().replace(/−/g, "-").replace(/\s+/g, "");
  if (text === "") return null;

  if (options) {
    const index = options.findIndex((label) => label.toLowerCase().replace(/\s+/g, "") === text);
    if (index >= 0) return index;
  }

  switch (definition.unit) {
    case "seconds": {
      const n = leadingNumber(text);
      if (n === null || !/^[-+]?[\d.]+(ms|s|sec)?$/.test(text)) return null;
      if (text.endsWith("ms")) return n / 1000;
      if (/s(ec)?$/.test(text)) return n;
      return current < 1 ? n / 1000 : n;
    }
    case "hertz": {
      const n = leadingNumber(text);
      if (n === null || !/^[-+]?[\d.]+(k|khz|hz)?$/.test(text)) return null;
      return text.includes("k") ? n * 1000 : n;
    }
    case "decibels": {
      if (/^-?inf/.test(text) || text === "-∞" || text === "-∞db") return definition.min;
      return numberWithSuffix(text, /^(db)?$/);
    }
    case "semitones":
      return numberWithSuffix(text, /^(st|semitones?)?$/);
    case "bipolar":
      return parsePan(text);
    case "normalized": {
      const ratio = text.match(/^([\d.]+):1$/);
      if (ratio) return Number(ratio[1]);
      const percentStyle = definition.min >= 0 && definition.max <= 1;
      const n = numberWithSuffix(text, /^%?$/);
      if (n === null) return null;
      return percentStyle ? n / 100 : n;
    }
    default:
      return numberWithSuffix(text, /^[a-z%]*$/);
  }
}

/** `C`, `L30`, `R30`, or a signed percent (`-30` is 30% left). */
function parsePan(text: string): number | null {
  if (text === "c") return 0;
  const side = text.match(/^([lr])([\d.]+)%?$/);
  if (side) return ((side[1] === "l" ? -1 : 1) * Number(side[2])) / 100;
  const n = numberWithSuffix(text, /^%?$/);
  return n === null ? null : n / 100;
}

function numberWithSuffix(text: string, suffix: RegExp): number | null {
  const match = text.match(/^[-+]?(\d+\.?\d*|\.\d+)/);
  if (!match) return null;
  if (!suffix.test(text.slice(match[0].length))) return null;
  return Number(match[0]);
}

function leadingNumber(text: string): number | null {
  const match = text.match(/^[-+]?(\d+\.?\d*|\.\d+)/);
  return match ? Number(match[0]) : null;
}
