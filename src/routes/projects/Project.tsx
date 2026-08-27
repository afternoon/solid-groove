import { useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { AuthProvider } from "../../auth/AuthProvider";
import ProjectNotFound from "../../components/ProjectNotFound";
import EditorView from "../../editor/EditorView";

export default function ProjectPage() {
  const params = useParams();

  // Router 2 types `useParams()` as an open `Params` record, so `id` is
  // `string | undefined` even though this route only matches with one present.
  // `Show` is the honest narrowing: it reuses the not-found surface the editor
  // already shows for a project that cannot be opened, rather than asserting
  // the param away with `!` and leaving no answer for the case that "cannot
  // happen". The fallback is unreachable through the router; it is reachable
  // if the route table ever changes underneath this component.
  return (
    <AuthProvider>
      <Show when={params.id} fallback={<ProjectNotFound />}>
        {(id) => <EditorView projectId={id()} />}
      </Show>
    </AuthProvider>
  );
}
