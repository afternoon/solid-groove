/**
 * The colours a track can be given (#534): a 5 x 10 grid, row by row.
 * Row 0 is a grey ramp from near-white to near-black; rows 1-4 are ten hues in
 * four shades, light to dark. A track colour is persisted domain data (any
 * `#rrggbb` is valid), not theme, so the values live here in TS. A new track's default
 * colour is drawn from this grid too (`TRACK_COLORS` in `factories.ts`).
 */

export const TRACK_PALETTE_COLUMNS = 10;

const HUES = [0, 25, 45, 65, 120, 165, 195, 220, 265, 320] as const;
const SHADES: readonly { saturation: number; lightness: number }[] = [
  { saturation: 85, lightness: 80 },
  { saturation: 80, lightness: 65 },
  { saturation: 75, lightness: 50 },
  { saturation: 70, lightness: 35 },
];

function hex(channel: number): string {
  return Math.round(channel * 255)
    .toString(16)
    .padStart(2, "0");
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

const GREYS = Array.from({ length: TRACK_PALETTE_COLUMNS }, (_, i) =>
  hslToHex(0, 0, 96 - (i * 90) / (TRACK_PALETTE_COLUMNS - 1)),
);

export const TRACK_PALETTE: readonly string[] = [
  ...GREYS,
  ...SHADES.flatMap(({ saturation, lightness }) =>
    HUES.map((hue) => hslToHex(hue, saturation, lightness)),
  ),
];
