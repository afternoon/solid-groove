# The assistant gateway

The assistant reaches its model provider (Anthropic, ADR 0006) through one
callable Cloud Function, `assistantTurn` (#69). The browser never holds the
provider's API key or talks to the provider directly.

## How it works

- `functions/src/index.ts` exports `assistantTurn`, a streaming callable in
  `us-east1`. Firebase verifies the caller's ID token; the gateway
  (`src/assistant/gateway.ts`) then refuses a guest, parses the request
  against ADR 0007's allowlist, calls the provider and streams the reply.
- The API key is the Secret Manager secret **`ANTHROPIC_API_KEY`**
  (`ASSISTANT_API_KEY_SECRET` in `src/assistant/config.ts`), bound to
  `assistantTurn` alone.
- The model, and how its request is shaped, are configuration in
  `src/assistant/config.ts`. Switching between `claude-sonnet-5` and
  `claude-haiku-4-5` is a change to `ASSISTANT_MODEL_ID` and a deploy.
- Each turn logs one `assistant turn` record to Cloud Logging: outcome code,
  model, prompt version, attempts, failure kinds, token counts, duration.
  Never the conversation, the project, the account or the provider's error
  text.

## Before the first deploy that includes `assistantTurn`

`main` deploys functions on every merge (`bun run deploy` in
`.github/workflows/ci.yml`). A function that binds a secret cannot deploy
until the secret exists, so do these **before merging** the PR that adds the
gateway, or the next `main` deploy fails:

1. **Create the secret.** With the Firebase CLI signed in as a project owner:

   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY --project <project-id>
   ```

   Paste the Anthropic API key when prompted. This enables the Secret Manager
   API if it is not already on. Use a key from an Anthropic workspace whose
   spend limit you are comfortable with as a last line of defence.

2. **Let the deploy account bind it.** The deploy grants the functions'
   runtime service account access to the secret, so the service account in
   `FIREBASE_DEPLOY_SERVICE_ACCOUNT` needs the **Secret Manager Admin** role
   (`roles/secretmanager.admin`) in the project's IAM page. Without it the
   deploy fails with a permission error on the secret.

3. **Merge.** The `deploy` job deploys `assistantTurn` with the rest.

To check it is live: Cloud Functions in the Google Cloud console lists
`assistantTurn` in `us-east1`, with `ANTHROPIC_API_KEY` under its secrets.

## Rotating the key

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY --project <project-id>
firebase deploy --only functions:assistantTurn --project <project-id>
```

A function reads the secret version it was deployed with, so the redeploy is
what picks up the new key. Then disable the old key in the Anthropic console.

## Running it locally

The emulator loads `assistantTurn` without a key; a call that reaches the
provider then fails as `provider_error`. To try it against the real provider,
put `ANTHROPIC_API_KEY=<key>` in `functions/.secret.local` (gitignored by
`*.local`) and restart the emulators. The automated suites never use a key:
they script the provider (`src/testing/scriptedAssistantProvider.ts`).
