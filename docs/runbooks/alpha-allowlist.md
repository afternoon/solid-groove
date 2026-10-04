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
  refuses every sign-in whose address is not on the list, a guest linking
  Google included. That is the enforcement; what the browser shows is only UI.
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
   leaves guests alone. Running it twice is harmless.
3. **Grant the first admin** (the account must have signed in once; the
   command allowlists the address either way):
   ```sh
   FIREBASE_PROJECT_ID=<project> bun run admin:grant -- you@example.com
   ```
   The claim reaches the browser with the next ID token: sign out and in again.
4. **Disable the Anonymous provider** in Authentication, Sign-in method.
5. Deploy (`bun run deploy` includes `functions`).

The scripts use application default credentials
(`gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS`).

## Approving people

- **Admin page:** `/admin`, visible only to admins (anyone else gets the 404
  page). Paste any number of addresses (one per line, separated by commas, or a
  column from the Tally export) and press Approve. It reports added, already
  listed and invalid. Below it are blocked sign-in attempts, each with one-click
  Approve, and the current list, each with Remove.
- **Terminal:**
  ```sh
  FIREBASE_PROJECT_ID=<project> bun run allowlist:add -- export.csv more@example.com
  ```
  Arguments are files or addresses, read by the same parser as the page.

People who are refused see a page saying they are not on the alpha list yet,
with a Request access button to the form (`requestAccessUrl` in
`site.config.mjs`).

## Locally, against the emulator

`bun run firebase:emulator` builds and runs the functions too, so the emulator
refuses an unlisted address just as production does. Put yourself on the list
with the same script, pointed at the emulator:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_PROJECT_ID=demo-solid-groove bun run allowlist:add -- you@example.com
```
