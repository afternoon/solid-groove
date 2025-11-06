import type { Component } from "solid-js";
import type { ProjectStore } from "../../model/project";

type BrowserProps = {
	project: ProjectStore;
};

export default function Browser(
	props: BrowserProps,
): Component<BrowserProps> {
	return (
		<div class="browser">
			{/* Asset management UI will go here */}
		</div>
	);
}
