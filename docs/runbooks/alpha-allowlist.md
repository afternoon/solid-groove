# The alpha allowlist

During the alpha only invited Google addresses can sign in (#854). This is how
the list is run.

## How it works

- The list is the Firestore collection `allowlist/{normalisedEmail}`: one
  document per address, trimmed and lower-cased. Clients cannot read or write
  it; only an account with the `admin: true` custom claim, or the admin
  credential, can (`firestore.rules`).
- A blocking `beforeSignIn` Auth function (`alphaAllowlistGate` in
  `functions/src/index.ts`, deciding through `src/access/signInGate.ts`)
  refuses every sign-in whose address is not on the list or not verified, a
  guest linking Google included. That is the enforcement; what the browser
  shows is only UI. It deploys with the other functions (`bun run deploy`),
  and it shipped in the same change that retired guest start, so it never went
  live ahead of the pages it sends people to.
- Firebase never runs a blocking function for an **anonymous** sign-in, so the
  function cannot stop a new guest session. Disabling the Anonymous provider
  (step 4 below) is the control for that, not the function.
- A refused sign-in is recorded in `signInAttempts/{normalisedEmail}` (address,
  first and last time, count). Approving an address removes its attempt.
- Guest start is retired. Existing guest sessions keep working on their
  projects; no new ones are created.

## Before the first deploy with enforcement

1. **Upgrade the Firebase project to Identity Platform** (Firebase console,
   Authentication, Settings). Blocking functions need it. This is a manual,
   owner-only step.
2. **Grandfather everyone who already signs in:**
   ```sh
   FIREBASE_PROJECT_ID=<project> bun run allowlist:seed
   ```
   It adds the address of every account that has a sign-in provider, and
   leaves guests alone. Run it **before** the gate deploys; until then,
   running it twice is harmless.

   Once the gate is live it is not: a refused sign-in still creates its
   Firebase Auth account, so "every account" then includes everyone the gate
   turned away. The script never seeds an address with a refused sign-in on
   record, and once `signInAttempts` holds anything it stops unless you pass
   the time the gate deployed, after which only older accounts are added:
   ```sh
   FIREBASE_PROJECT_ID=<project> bun run allowlist:seed -- --before 2026-10-01T12:00:00Z
   ```
   Even then it re-adds anyone created before the cutoff whom you have since
   removed, so after enforcement prefer approving people by name.
3. **Grant the first admin** (the account must have signed in once; the
   command allowlists the address either way):
   ```sh
   FIREBASE_PROJECT_ID=<project> bun run admin:grant -- you@example.com
   ```
   The claim reaches the browser with the next ID token: sign out and in again.
4. **Disable the Anonymous provider** in Authentication, Sign-in method. This
   is what stops new guest sessions: the blocking function never sees an
   anonymous sign-in, so leaving the provider on leaves guest start open to
   anyone who calls the SDK directly.
5. Deploy (`bun run deploy` includes `functions`).

The scripts use application default credentials
(`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`).

## Approving people

- **Admin page:** `/admin`, visible only to admins (anyone else gets the 404
  page). Paste any number of addresses (one per line, separated by commas, or a
  column from the Tally export) and press Approve. It reports added, already
  listed and invalid. Below it are blocked sign-in attempts, each with one-click
  Approve, and the current list, each with Remove.
- **Remove does not sign anyone out.** It stops the address's next sign-in,
  but `beforeSignIn` does not run when a session refreshes its ID token, so a
  person who is signed in stays signed in. To end their session now, revoke
  their refresh tokens (`auth.revokeRefreshTokens(uid)` with the Admin SDK) or
  disable the user in Authentication, Users.
- **Terminal:**
  ```sh
  FIREBASE_PROJECT_ID=<project> bun run allowlist:add -- export.csv more@example.com
  ```
  Arguments are files or addresses, read by the same parser as the page.

People who are refused see a page saying they are not on the alpha list yet,
with a Request access button to the form (`requestAccessUrl` in
`site.config.mjs`).

## Email alerts for blocked sign-ins

A Firestore trigger (`allowlistBlockedSignInAlert` in `functions/src/index.ts`,
deciding through `src/access/blockedSignInAlert.ts`) emails the admin when an
address is refused: on its first refusal, and again when it comes back 24
hours or more after its last attempt. Retries in between send nothing. The
email names the address, the attempt count, the first and last attempt times
(UTC) and links to `/admin`. It is separate from the gate, so a broken mail
server never slows or fails a sign-in; a failed send is logged as a warning and
dropped (the attempt is still listed in `/admin`). The logs never name the
address.

1. **Store the SMTP URL as a secret.** For Gmail, create an app password and
   use `smtps://you%40gmail.com:<app-password>@smtp.gmail.com` (the `@` in the
   user name written as `%40`). Mail is sent from that account.
   ```sh
   firebase functions:secrets:set ALLOWLIST_ALERT_SMTP_URL --project <project>
   ```
   The secret must exist before the next deploy: the deploy refuses a function
   whose secret is missing. To deploy without alerts, set it to any value (for
   example `none`) and leave the recipient empty.
2. **Set the recipient**, `ALLOWLIST_ALERT_TO`, in `functions/.env.<project>`
   (for example `ALLOWLIST_ALERT_TO=you@example.com`), or answer the prompt an
   interactive `firebase deploy` shows. It defaults to empty. CI deploys
   non-interactively, so for alerts to survive its deploys the file has to be
   committed, and this repository is public: use an address you are happy to
   publish, such as an alias.
3. Deploy (`bun run deploy`). The deploy credential needs to be able to grant
   the function access to the secret (Secret Manager Admin, or Owner).

**Turning alerts off:** clear the recipient (`ALLOWLIST_ALERT_TO=`) and deploy.
With either the recipient or the secret empty the function logs
`allowlist alert skipped: not configured` and sends nothing.

## Locally, against the emulator

`bun run firebase:emulator` builds and runs the functions too, so the emulator
refuses an unlisted address just as production does. Put yourself on the list
with the same script, pointed at the emulator:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=demo-solid-groove bun run allowlist:add -- you@example.com
```

## What no longer signs in by itself

Guest start was what let automation into the live app without an account. With
it gone:

- **The post-deploy smoke test** (`tests/e2e/hosted/smoke.spec.ts`, run by the
  `deploy` job and on previews) checks the landing page, that `/projects` keeps
  a visitor with no session out, and the not-on-the-list page. It no longer
  creates a project or starts audio, because it has no account to sign in with.
- **The scheduled QA sweep** (`tests/e2e/hosted/qa-sweep/`) still starts by
  creating a guest, which the live app no longer offers, so its weekly schedule
  is turned off in `.github/workflows/qa-sweep.yml`. It needs an allowlisted
  test account and a way to sign it in from CI before it can run again (#1055).
