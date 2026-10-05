import { fileURLToPath } from "node:url";
import { SITE_ORIGIN } from "../../../../site.config.mjs";

/**
 * Where one QA sweep agent's files live (#859). Everything is under the
 * gitignored `tmp/`, so nothing an agent writes can be committed.
 *
 * The session file sits **outside** `OUT_DIR` on purpose: the workflow uploads
 * `OUT_DIR` as a build artifact, and the session holds the QA account's
 * refresh token, which must never leave the runner.
 */
const root = (path: string) =>
  fileURLToPath(new URL(`../../../../${path}`, import.meta.url));

/** The live app. `QA_SWEEP_URL` points the sweep somewhere else, e.g. a preview channel. */
export const SWEEP_URL = process.env.QA_SWEEP_URL || SITE_ORIGIN;

/** The QA account session every spec in a run shares, so cleanup can find its projects. */
export const SESSION_FILE = root("tmp/qa-sweep/session.json");

/** That account's user ID, so cleanup can tell it is signed in as the same account. */
export const ACCOUNT_FILE = root("tmp/qa-sweep/account-uid.txt");

/**
 * This agent's QA account slot, `testuser<slot>` (#1055): 1 to 10, from the
 * plan (`scripts/qa-sweep/plan.mjs`) through `QA_SWEEP_SLOT`. Read only where
 * it is used, so a spec that never signs in does not need it.
 */
export function sweepSlot(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.QA_SWEEP_SLOT?.trim() ?? "";
  const slot = Number(raw);
  if (!/^\d+$/.test(raw) || slot < 1) {
    throw new Error(
      "QA_SWEEP_SLOT must be this agent's QA account slot, 1 to 10 (the plan's `slot`).",
    );
  }
  return slot;
}

/** Where the agent writes its scratch specs. */
export const SPECS_DIR = root("tmp/qa-sweep/specs");

/** What the workflow uploads: `findings.json`, `build.json`, `cleanup.json`, `shots/`. */
export const OUT_DIR = root("tmp/qa-sweep/out");
export const BUILD_FILE = `${OUT_DIR}/build.json`;
export const CLEANUP_FILE = `${OUT_DIR}/cleanup.json`;
