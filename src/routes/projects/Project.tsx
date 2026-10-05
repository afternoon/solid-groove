import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import { AuthProvider, useAuth } from "../../auth/AuthProvider";
import SignedInOnly from "../../auth/SignedInOnly";
import { detectCapabilities } from "../../browser/capabilities";
import AccountControl from "../../components/AccountControls";
import ProjectNotFound from "../../components/ProjectNotFound";
import EditorView from "../../editor/EditorView";
import { editorViewFromPath, editorViewPath } from "../../editor/editorViews";

/**
 * The editor with the signed-in account handed in, so the library can offer
 * the producer their own packs (#282). Inside `AuthProvider`, which is what
 * `useAuth` reads.
 */
function AccountEditor(props: Parameters<typeof EditorView>[0]) {
  const auth = useAuth();
  return (
    <EditorView
      {...props}
      libraryAccount={
        auth.user ? { uid: auth.user.uid, registered: !auth.isAnonymous } : null
      }
    />
  );
}

export default function ProjectPage() {
  const params = useParams();
  // Three paths, one page module (`src/router.tsx`), so the view is read back
  // out of the address rather than held beside it (`UI-001`). That is what
  // makes a deep link, the back button and a reload all land on the same view.
  const location = useLocation();
  const navigate = useNavigate();
  // Probed once per visit to the editor, never by user-agent (PRD section 10).
  const capabilities = detectCapabilities();

  // Router 2 types `useParams()` as an open `Params` record, so `id` is
  // `string | undefined` even though this route only matches with one present.
  // `Show` is the honest narrowing: it reuses the not-found surface the editor
  // already shows for a project that cannot be opened, rather than asserting
  // the param away with `!` and leaving no answer for the case that "cannot
  // happen". The fallback is unreachable through the router; it is reachable
  // if the route table ever changes underneath this component.
  return (
    <AuthProvider>
      <SignedInOnly>
        <Show when={params.id} fallback={<ProjectNotFound />}>
          {(id) => (
            <AccountEditor
              projectId={id()}
              view={editorViewFromPath(location.pathname)}
              viewHref={(view) => editorViewPath(id(), view)}
              onSelectView={(view) => navigate(editorViewPath(id(), view))}
              account={<AccountControl class="account-button" />}
              capabilities={capabilities}
            />
          )}
        </Show>
      </SignedInOnly>
    </AuthProvider>
  );
}
