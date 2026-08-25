// The deployed build's identity (PRD `OPS-01`).
//
// `app.config.ts` stamps the git commit SHA into `import.meta.env.VITE_RELEASE_SHA`
// at build time — see that file for how the value is resolved (CI's
// `VITE_RELEASE_SHA`/`GITHUB_SHA`, falling back to `git rev-parse HEAD` for a
// local build, and finally the `"unknown"` sentinel below if neither is
// available, e.g. under Vitest where the define never runs).
//
// `FND-001c` reads `RELEASE_SHA` to attach the release to every analytics and
// error event; this module is the one place that value comes from.

function readReleaseSha(): string {
  const raw = import.meta.env.VITE_RELEASE_SHA;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "unknown";
}

export const RELEASE_SHA: string = readReleaseSha();

/**
 * A short, display-friendly prefix of a release SHA. Full SHAs are kept in
 * events/logs for exact matching; the UI only ever needs enough of it to be
 * recognizable, and `git`'s own convention (`git rev-parse --short`) uses a
 * similar length.
 */
export function shortReleaseSha(sha: string = RELEASE_SHA): string {
  return sha === "unknown" ? sha : sha.slice(0, 12);
}
