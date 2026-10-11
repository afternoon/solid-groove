// The dashboard page module that `router.tsx` points at.

import { Title } from "@solidjs/meta";
import { pageTitle } from "../../site.config.mjs";
import { AuthProvider } from "../auth/AuthProvider";
import SignedInOnly from "../auth/SignedInOnly";
import Dashboard from "../components/Dashboard";
import TapeLoader from "../components/TapeLoader";
import OnboardingGate from "../onboarding/OnboardingGate";
import "./dashboard.css";

export default function DashboardPage() {
  return (
    <main class="dashboard">
      <Title>{pageTitle("Projects")}</Title>
      <h1 class="dashboard-title">Projects</h1>
      <AuthProvider>
        <SignedInOnly fallback={<TapeLoader label="Loading projects" />}>
          <OnboardingGate fallback={<TapeLoader label="Loading projects" />}>
            <Dashboard />
          </OnboardingGate>
        </SignedInOnly>
      </AuthProvider>
    </main>
  );
}
