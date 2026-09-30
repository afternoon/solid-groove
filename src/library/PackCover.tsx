import { For, type JSX } from "@solidjs/web";
import { waveformPath } from "./MiniWaveform";
import { type LibraryAsset, WAVEFORM_PEAK_COUNT } from "./manifest";
import { packInitials } from "./packCatalog";
import "./PackCover.css";

/** Peaks derived from a name, so a pack with no waveform data still has stripes. */
function seededPeaks(seed: string, salt: number): number[] {
  let h = 2166136261 ^ salt;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: WAVEFORM_PEAK_COUNT }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2246822519);
    return 40 + ((h >>> 0) % 200);
  });
}

/** Three stripes: assets spread through the pack, else peaks seeded from the name. */
function stripePeaks(name: string, assets: readonly LibraryAsset[] | null): number[][] {
  const withPeaks = (assets ?? []).filter((asset) => asset.peaks !== null);
  return [0, 1, 2].map((i) => {
    const pick = withPeaks[Math.floor((i * withPeaks.length) / 3)];
    return pick?.peaks ? [...pick.peaks] : seededPeaks(name, i);
  });
}

/**
 * A pack's cover (LIB-010): initials over three waveform stripes, monochrome
 * and typographic, with no artwork. Decorative: the pack's name is beside it.
 */
export default function PackCover(props: {
  name: string;
  assets: readonly LibraryAsset[] | null;
  small?: boolean;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <span
      class={props.small ? "pack-cover pack-cover-small" : "pack-cover"}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <For each={stripePeaks(props.name, props.assets)}>
          {(peaks, i) => (
            <path
              class={i() === 1 ? "pack-stripe-b" : "pack-stripe-a"}
              transform={`translate(0,${i() * 20})`}
              d={waveformPath(peaks)}
            />
          )}
        </For>
      </svg>
      <span class="pack-cover-initials">{packInitials(props.name)}</span>
      {props.children}
    </span>
  );
}
