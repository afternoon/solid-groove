import type { JSX } from "solid-js";
import type { ProjectStore } from "../../model/project";

type EditorAssistantProps = {
	project: ProjectStore;
};

export default function EditorAssistant(
	_props: EditorAssistantProps,
): JSX.Element {
	return <div class="assistant">{/* AI assistant UI will go here */}</div>;
}
