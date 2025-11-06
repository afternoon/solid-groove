import type { Component } from "solid-js";
import type { ProjectStore } from "../../model/project";

type EditorAssistantProps = {
	project: ProjectStore;
};

export default function EditorAssistant(
	props: EditorAssistantProps,
): Component<EditorAssistantProps> {
	return (
		<div class="editor-assistant">
			{/* AI assistant UI will go here */}
		</div>
	);
}
