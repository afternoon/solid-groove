import { AuthProvider } from "../auth/AuthProvider";
import Dashboard from "../components/Dashboard";
import "./dashboard.css";

export default function DashboardPage() {
  return (
    <main class="dashboard">
      <h1 class="dashboard-title">Projects</h1>
      <AuthProvider>
        <Dashboard />
      </AuthProvider>
    </main>
  );
}
