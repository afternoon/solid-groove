import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { AuthProvider } from "../../auth/AuthProvider";
import ProjectNotFound from "../../components/ProjectNotFound";
import EditorView from "../../editor/EditorView";
import { editorViewFromPath, editorViewPath } from "../../editor/editorViews";

export default function ProjectPage() {
  const params = useParams();
  // Three paths, one page module (`src/router.tsx`), so the view is read back
  // out of the address rather than held beside it (`UI-001`). That is what
  // makes a deep link, the back button and a reload all land on the same view.
  const location = useLocation();
  const navigate = useNavigate();

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
        {(id) => (
          <EditorView
            projectId={id()}
            view={editorViewFromPath(location.pathname)}
            viewHref={(view) => editorViewPath(id(), view)}
            onSelectView={(view) => navigate(editorViewPath(id(), view))}
          />
        )}
      </Show>
    </AuthProvider>
  );
}
