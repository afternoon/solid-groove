import { useParams } from "@solidjs/router";
import { FirebaseProvider } from "solid-firebase";
import { AuthProvider } from "../../auth/AuthProvider";
import ProjectEditor from "../../components/ProjectEditor";
import { app } from "../../firebaseConfig";

export default function ProjectPage() {
	const params = useParams();
	return (
		<FirebaseProvider app={app}>
			<AuthProvider>
				<ProjectEditor id={params.id} />
			</AuthProvider>
		</FirebaseProvider>
	);
}
