import { clientOnly } from "@solidjs/start";

// The public marketing landing page (PRD `PRJ-06`, backlog `LOOP-001b`).
// `clientOnly` because the page navigates and reaches the auth service on
// click; everything it renders is static content, so nothing here pulls
// Firebase onto the first-paint path.
const LandingPage = clientOnly(() => import("../components/LandingPage"));

export default function IndexPage() {
	return <LandingPage />;
}
