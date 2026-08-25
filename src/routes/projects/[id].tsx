import { useParams } from "@solidjs/router";
import { AuthProvider } from "../../auth/AuthProvider";
import EditorView from "../../editor/EditorView";

export default function ProjectPage() {
  const params = useParams();
  return (
    <AuthProvider>
      <EditorView projectId={params.id} />
    </AuthProvider>
  );
}
