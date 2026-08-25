import type { Component } from "solid-js";
import { RELEASE_SHA, shortReleaseSha } from "../release";
import "./ReleaseBadge.css";

/**
 * PRD `OPS-01`: "the build stamps the git commit SHA into the client, [and]
 * the app can display it." A small, unobtrusive badge is enough to satisfy
 * that -- someone checking which revision is live on the hosted alpha (or
 * attaching a diagnostic to a bug report) can read it without it competing
 * with the product UI.
 *
 * `data-release-sha` carries the full, untruncated SHA so tooling (the
 * `FND-001b` post-deploy smoke test, a future support workflow) can read the
 * exact revision without parsing the truncated display text.
 */
const ReleaseBadge: Component = () => (
  <footer
    class="release-badge"
    data-release-sha={RELEASE_SHA}
    title={`Build ${RELEASE_SHA}`}
  >
    {shortReleaseSha()}
  </footer>
);

export default ReleaseBadge;
