import { execSync } from "node:child_process";
import { defineConfig } from "@solidjs/start/config";

// PRD `OPS-01`: every build stamps the git commit SHA into the client so the
// deployed revision is identifiable and every analytics/error event can carry
// it (`FND-001c`). CI sets `VITE_RELEASE_SHA` explicitly (the deploy job pins
// it to the exact commit it built and deployed); `GITHUB_SHA` is Actions'
// automatic fallback for any other workflow run (e.g. the always-on `build`
// job, which never sets `VITE_RELEASE_SHA` itself). A local `bun run build`
// or `bun run dev` has neither, so it falls back to the working tree's own
// HEAD, and `"unknown"` is the last resort if even `git` is unavailable --
// this must never throw and block a build.
function resolveReleaseSha(): string {
	if (process.env.VITE_RELEASE_SHA) return process.env.VITE_RELEASE_SHA;
	if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
	try {
		return execSync("git rev-parse HEAD", {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return "unknown";
	}
}

export default defineConfig({
	ssr: false,
	server: {
		prerender: {
			routes: ["/"],
		},
	},
	vite: {
		define: {
			"import.meta.env.VITE_RELEASE_SHA": JSON.stringify(resolveReleaseSha()),
		},
	},
});
