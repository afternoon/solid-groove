import { useParams } from "@solidjs/router";
import { FirebaseProvider } from "solid-firebase";
import { AuthProvider } from "../../auth/AuthProvider";
import Editor from "../../components/editor/Editor";
import { app } from "../../firebaseConfig";

export default function ProjectPage() {
	const params = useParams();
	return (
		<FirebaseProvider app={app}>
			<AuthProvider>
				<Editor id={params.id} />
			</AuthProvider>
		</FirebaseProvider>
	);
}
