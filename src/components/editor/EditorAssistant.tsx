import type { Component } from "solid-js";
import type { ProjectStore } from "../../model/project";

type EditorAssistantProps = {
	project: ProjectStore;
};

export default function EditorAssistant(
	_props: EditorAssistantProps,
): Component<EditorAssistantProps> {
	return <div class="assistant">{/* AI assistant UI will go here */}</div>;
}
