import { useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";

/** `/dashboard` was the project list's old address; send bookmarks on to `/projects`. */
export default function LegacyDashboardPage() {
  const navigate = useNavigate();
  createEffect(
    () => undefined,
    () => navigate("/projects", { replace: true }),
  );
  return null;
}
