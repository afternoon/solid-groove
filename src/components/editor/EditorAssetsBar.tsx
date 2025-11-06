import type { Component } from "solid-js";
import type { ProjectStore } from "../../model/project";

type EditorAssetsBarProps = {
	project: ProjectStore;
};

export default function EditorAssetsBar(
	props: EditorAssetsBarProps,
): Component<EditorAssetsBarProps> {
	return (
		<div class="editor-assets-bar">
			{/* Asset management UI will go here */}
		</div>
	);
}
