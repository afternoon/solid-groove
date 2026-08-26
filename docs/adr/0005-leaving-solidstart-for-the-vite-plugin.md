# ADR 0005 - Leaving SolidStart for `@solidjs/vite-plugin`'s client start mode

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-08-26 |
| Decides | Which serving layer builds and runs the app on Solid 2, and which Sentry SDK sits behind the `OPS-03` reporting boundary |
| Supersedes | The SDK named in [ADR 0001](./0001-sentry-for-error-monitoring.md)'s Decision paragraph (`@sentry/solidstart`) — that clause only. Every numbered decision in ADR 0001 stands unchanged, including decision 1's boundary, decision 2's system of record, and decision 5's `@sentry/node` option for the `AI-001` gateway |
| Affects | `vite.config.ts`, `src/app.tsx`, `src/router.tsx`, `src/routes/`, `src/monitoring/sentrySink.ts`; PRD section 9.1's "Application framework" row, section 7.10's error-monitoring paragraph, section 16's "Decisions made for implementation" list, and the "Current prototype baseline" — all four name SolidStart and now need a PRD edit |

## Context

The app was built on **SolidStart** over **vinxi**, configured CSR-only (`ssr: false` with `prerender: { routes: ["/"] }` in `app.config.ts`), with file-based routing under `src/routes/` and `@sentry/solidstart` as the error-monitoring SDK. PRD section 9.1 lists "SolidStart, SolidJS, and TypeScript" as the committed application framework and requires an approved ADR before an implementation replaces one of its rows. Section 7.10 commits the alpha to Sentry "through the official SolidStart SDK" and says replacing that "requires a superseding ADR under the section 9.1 rules". This ADR is the one both rules ask for.

The migration to `solid-js@2.0.0-rc.3` made the SolidStart question unavoidable rather than optional. **There is no SolidStart for Solid 2, and there is not meant to be one.** The evidence is in the published package metadata rather than in a roadmap statement:

- `@solidjs/start@2.0.0-rc.10`, the newest release on any tag, declares `dependencies: { "solid-js": "^1.9.14", ... }` and `peerDependencies: { "@solidjs/router": ">=0.16.0 <2.0.0-0" }`. Both ranges exclude the versions this app now runs (`solid-js@2.0.0-rc.3`, `@solidjs/router@2.0.0-next.18`). `@solidjs/start` 2.x is a **Solid 1** meta-framework; its major version tracks its own line, not Solid's.
- The replacement is not a separate package. `@solidjs/vite-plugin@3.0.0-next.34` — which peer-depends on `solid-js@^2.0.0-rc.0` and `@solidjs/web@^2.0.0-rc.0` — carries Start *as a mode of the plugin*: `solid({ start: true })`. Its own documentation describes the mode as owning "entries, dev serving, and the build — no index.html, no mount file, no server wiring", which is the whole of what SolidStart did for this app.

The Sentry SDK is blocked by exactly the same wall. `@sentry/solidstart@10.68.0` peer-depends on `@solidjs/start@^1.0.0` and `@solidjs/router@^0.13.4 || ^0.14.0 || ^0.15.0`; the `@sentry/solid` package underneath it peer-depends on `solid-js@^1.8.4` and the same router range. Neither is installable against Solid 2. ADR 0001 anticipated this in its own risk list — "the framework wrapper is a convenience over the core browser SDK — if it misbehaves we drop to `@sentry/browser` behind the same unchanged boundary" — and that is the fallback being taken, for a different reason than the one it foresaw.

One further consequence falls out of the plugin: **there is no file-based routing.** `<FileRoutes />` came from `@solidjs/start/router`. Router 2 ships a `fileRoutes()` adapter at `@solidjs/router/fs`, but it consumes a `virtual:file-routes` manifest that some build plugin must emit, and `@solidjs/vite-plugin` does not emit one.

## Decision

**Adopt `@solidjs/vite-plugin`'s client start mode as the app's serving layer, and `@sentry/browser` as the SDK behind the `OPS-03` reporting boundary.** SolidStart and vinxi are removed and are not to be reintroduced.

1. **`solid({ start: true })` with no `ssr`, in `vite.config.ts`.** That combination is the plugin's client start mode. It reproduces what `ssr: false` plus `prerender: { routes: ["/"] }` produced before: `vite build` emits a purely static `dist/client` whose `index.html` is the shell prerendered once through the built handler, deep links get that same shell by history fallback, and the client `render()`s — never hydrates — into it. **The PRD's client-only decision is unchanged**; only the mechanism that implements it is new.
2. **`app.config.ts`, `src/entry-client.tsx` and `src/entry-server.tsx` are deleted.** The plugin generates the entries from `src/app.tsx`. Configuration lives in `vite.config.ts`, which now also owns the release-SHA stamp, the Sentry source-map upload, `optimizeDeps.include`, `build.sourcemap: "hidden"`, and the port-3000 pin that vinxi previously supplied by default.
3. **Routes are an explicit table in `src/router.tsx`.** One `{ path, component: lazy(...) }` entry per route, four of them. Page modules keep living in `src/routes/`, but their filenames are only names — `[id].tsx` became `Project.tsx` and `[...404].tsx` became `CatchAll.tsx`, because that spelling addressed a `FileRoutes` that no longer reads it, and leaving it in place would advertise a convention the app does not have. Every page stays `lazy`, so each route is still its own chunk; the landing page's first-paint budget (PRD `PRJ-06`) depends on that and nothing else.
4. **`@sentry/browser` replaces `@sentry/solidstart`, behind an unchanged boundary.** `src/monitoring/sentrySink.ts` remains the only module in the codebase that imports `@sentry/*` (ADR 0001 decision 1), and the change is two lines: the dynamic import and its type. Every integration the sink configures — `browserSessionIntegration` for Release Health, `dedupeIntegration`, `breadcrumbsIntegration`, `replayIntegration`/`replayCanvasIntegration` under ADR 0002 and ADR 0003 — is a core browser-SDK integration and is unaffected.
5. **Client start mode is marked experimental upstream, and that risk is accepted.** `@solidjs/vite-plugin`'s documentation labels client mode "(experimental)". We are taking it anyway, because the alternatives are worse (see below) and because the failure surface is a build and a dev server rather than application code: the app's own source does not know which mode produced its entry.

## What this does not decide

- **It does not reopen client-only rendering.** The PRD's decision that the app never renders on the server stands. Flipping this project to SSR start mode is a single boolean upstream (`ssr: true`), and it would be its own decision with its own consequences.
- **It does not enable performance tracing.** The sink still runs with no tracing integration, exactly as ADR 0001 decision 2 left it. What changed is the *cost* of turning it on later — see below.
- **It does not authorize server functions.** `serverFunctions` stays off; a static `dist/client` with no server bundle is the deployable, which is what `firebase.json`'s `hosting.public` points at.
- **It does not amend the PRD.** Section 9.1's "Committed alpha stack" framework row, section 7.10's "through the official SolidStart SDK", section 16's "Decisions made for implementation", and the "Current prototype baseline" paragraph all still name SolidStart. Section 9.1's own rule is that "a decision that changes a row in the table below updates that row to point at its ADR" — so the framework row should end up pointing here, the way the error-monitoring row points at ADR 0001. That edit is the PRD owner's to make; the PRD is read-only to implementers.

## Consequences

### What this buys

- **One config file and one tool.** `vite.config.ts` replaces `app.config.ts` plus vinxi's implicit behaviour, and `vite build` replaces vinxi's two-stage `.vinxi/build` → `.output/public` hand-off with a single `dist/client` tree that is both the build output and the deployable. The Sentry source-map upload had to know about that hand-off; now it does not.
- **A dependency fewer between us and Vite.** Vinxi was a layer this app used almost none of — no server routes, no nitro deployment presets, no SSR. Dropping it removes a version to track and a source of behaviour we could not read directly out of a config file.
- **The route table is visible.** Four routes written down where they are matched, with the `lazy()` chunking explicit, is cheaper to read than a filename convention plus a manifest generator — and it is where the "why is the landing page its own chunk" answer now lives.

### What this costs

- **Client start mode is experimental.** An upstream change to it can break the dev server or the build shape. The mitigation is that nothing in `src/` depends on the mode, and the CI `build` job runs `bun run build` on every push and PR, so a break surfaces as a red build rather than as a bad deploy.
- **File-based routing is gone, and a new route is now a two-file change.** Adding a page means adding the module *and* an entry in `src/router.tsx`, and forgetting the second yields a page that exists and is unreachable. `src/router.tsx` also becomes a shared registration point in the `CLAUDE.md` sense — two parallel features adding routes will collide there.
- **Sentry router tracing is no longer available off the shelf.** `@sentry/solid` shipped `solidRouterBrowserTracingIntegration` and `withSentryRouterRouting` (from `@sentry/solid/solidrouter`), which instrument navigations as transactions with parameterized route names. `@sentry/browser` has `browserTracingIntegration`, which sees URLs and not route patterns. Because tracing was never enabled, **nothing in production changed** — the cost is entirely future: the decision ADR 0001 deferred now carries an extra piece of work, wiring route spans onto `@solidjs/router` by hand, rather than adding one integration to the sink.
- **`withSentryErrorBoundary` is gone too, and costs nothing.** ADR 0001 decision 1 already forbids application code from calling the SDK directly; the app's boundaries are its own and report through `src/monitoring`. We were never going to use it.
- **The upgrade path is now `next`-tagged.** `@solidjs/vite-plugin@3.0.0-next.34` and `@solidjs/router@2.0.0-next.18` are pre-release, as is `solid-js@2.0.0-rc.3` itself. That is the price of Solid 2 generally, not of this decision specifically, but this ADR is where it is written down.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Stay on SolidStart and stay on Solid 1 | The whole migration's premise. It defers the same decision to a later date at which more code has been written against the older idioms |
| Keep SolidStart 2.x alongside `solid-js@2.0.0-rc.3` | Not possible. `@solidjs/start@2.0.0-rc.10` depends on `solid-js@^1.9.14` and peer-depends on `@solidjs/router@<2.0.0-0`; the app would have two incompatible copies of the framework |
| Hand-roll the serving layer: plain Vite, own `index.html`, own client mount | Reintroduces exactly the entry/prerender/history-fallback wiring that start mode owns, as code we would then maintain and test. It also gives up the prerendered shell that the current `index.html` is |
| SSR start mode (`start: { }, ssr: true`) instead of client mode, to avoid the experimental label | Not a smaller change — a bigger one. It contradicts the PRD's client-only decision, adds a server bundle to deploy, and would make every component's server-safety a live concern |
| Write a `virtual:file-routes` emitter so `@solidjs/router/fs` keeps file-based routing | A build plugin to maintain, so that four routes need not be written down. The manifest is the thing that would drift, and it would have no owner |
| Keep `@sentry/solidstart` by pinning the old Solid | Same wall as the framework, from the other side: `@sentry/solid` peer-depends on `solid-js@^1.8.4` |
| Drop Sentry rather than lose the Solid wrapper | The wrapper is a convenience over the core SDK, as ADR 0001 said when it named this exact fallback. Everything ADR 0001 adopted Sentry *for* — grouping, releases, symbolication, crash-free session rate — is in `@sentry/browser` |

## Revisit when

- **Client start mode loses its experimental label, or changes shape.** The first is a note; the second is a real upgrade to plan.
- **`@solidjs/vite-plugin` starts emitting a `virtual:file-routes` manifest.** File-based routing becomes available again and the route table becomes a choice rather than a constraint — at which point it may well still be the better choice.
- **Performance tracing is decided** (the decision ADR 0001 decision 2 deferred). That is when the router-tracing cost above stops being hypothetical and needs a real answer for `@solidjs/router` 2.
- **Sentry ships a Solid 2 SDK.** Adopting it would be a small change behind an unchanged boundary, and would be worth it only if it brings back router tracing we actually want.
- **The app needs a server for anything** — server functions, an SSR route, a non-static host. Every one of those reopens decision 1.
