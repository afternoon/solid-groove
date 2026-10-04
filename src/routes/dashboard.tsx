import { Title } from "@solidjs/meta";
import { pageTitle } from "../../site.config.mjs";
import { AuthProvider } from "../auth/AuthProvider";
import SignedInOnly from "../auth/SignedInOnly";
import Dashboard from "../components/Dashboard";
import TapeLoader from "../components/TapeLoader";
import "./dashboard.css";

export default function DashboardPage() {
  return (
    <main class="dashboard">
      <Title>{pageTitle("Projects")}</Title>
      <h1 class="dashboard-title">Projects</h1>
      <AuthProvider>
        <SignedInOnly fallback={<TapeLoader label="Loading projects" />}>
          <Dashboard />
        </SignedInOnly>
      </AuthProvider>
    </main>
  );
}
