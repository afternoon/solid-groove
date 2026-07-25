import { defineConfig } from "vitest/config";

// The Firebase Emulator suite: contract tests that talk to a real (local)
// Firestore instance instead of mocks, so security rules and query behavior
// are verified against the actual service rather than assumed. It is
// isolated from `vitest.config.ts` — see `bun run test:emulator` in
// package.json, which starts the emulator, runs this config, then tears the
// emulator down — so the default `bun run test` never needs an emulator
// running and this suite never runs twice under two configs.
export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/emulator/**/*.test.ts"],
		hookTimeout: 30_000,
		testTimeout: 20_000,
	},
});
