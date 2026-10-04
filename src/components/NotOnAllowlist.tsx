import { Title } from "@solidjs/meta";
import type { JSX } from "@solidjs/web";
import { pageTitle, requestAccessUrl } from "../../site.config.mjs";
import "./NotOnAllowlist.css";

/**
 * What someone sees when they sign in with an address that is not on the
 * alpha allowlist (#854): why they are not in, in plain words, and one press
 * to ask. Request access is the page's one bold action and goes to the form
 * (`requestAccessUrl` in `site.config.mjs`).
 *
 * It shows no address and holds no session: the blocking function refused the
 * sign-in, so there is nobody signed in to name, and a reload shows the same
 * page.
 */
export default function NotOnAllowlist(): JSX.Element {
  return (
    <main class="not-invited">
      <Title>{pageTitle("Private alpha")}</Title>
      <div class="not-invited-copy">
        <p class="not-invited-kicker">Private alpha</p>
        <h1 class="not-invited-title">You're not on the alpha list yet</h1>
        <p class="not-invited-message">
          Groove is open to invited producers while it's in alpha, and the Google account
          you signed in with isn't on the list. Request access and we'll let you know when
          you're in.
        </p>
        <div class="not-invited-actions">
          <a
            class="not-invited-button not-invited-button-primary"
            href={requestAccessUrl}
          >
            Request access
          </a>
          <a class="not-invited-button" href="/">
            Back to the home page
          </a>
        </div>
      </div>
    </main>
  );
}
