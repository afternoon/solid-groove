import type { JSX } from "solid-js";
import type { ProjectStore } from "../../model/project";

type BrowserProps = {
	project: ProjectStore;
};

export default function Browser(_props: BrowserProps): JSX.Element {
	return <div class="browser">{/* Asset management UI will go here */}</div>;
}
