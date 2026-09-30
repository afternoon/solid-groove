import type { JsonFetcher } from "../libraryClient";
import { fixtureFetcher } from "./fixtures";

/** The roles the first fixture pack's five one-shots are spread over. */
export const VARIED_ROLES = ["kick", "snare", "clap", "rim", "closed-hat"] as const;

/**
 * {@link fixtureFetcher}, except the first pack's one-shots are five different
 * roles instead of five kicks, so a pack has enough categories for a cover's
 * "+N more" and for a "Hear it" run of more than one sound.
 */
export function variedPackFetcher(): JsonFetcher {
  const base = fixtureFetcher();
  return async (path) => {
    const doc = (await base(path)) as { assets?: { type: string; role: string }[] };
    if (!Array.isArray(doc.assets) || doc.assets[0]?.role !== "kick") return doc;
    let next = 0;
    return {
      ...doc,
      assets: doc.assets.map((asset) =>
        asset.type === "one-shot"
          ? { ...asset, role: VARIED_ROLES[next++ % VARIED_ROLES.length] }
          : asset,
      ),
    };
  };
}
