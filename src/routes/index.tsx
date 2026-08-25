import LandingPage from "../components/LandingPage";

// The public marketing landing page (PRD `PRJ-06`, task `LOOP-001b`).
//
// A plain import: `app.config.ts` sets `ssr: false`, so there is no hydration
// for `clientOnly` to avoid here, and wrapping the page in one would only add a
// second lazy chunk fetch to the surface with the strictest first-paint budget.
// Nothing in this page's static graph pulls Firebase onto that path either --
// the auth service is reached through a dynamic `import()` on click, which
// `src/components/landingBoundaries.test.ts` enforces.
export default function IndexPage() {
  return <LandingPage />;
}
