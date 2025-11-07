import type { Component } from "solid-js";

interface SampleChooserProps {
	sampleUrl: string;
	onChange: (sampleUrl: string) => void;
}

export const SampleChooser: Component<SampleChooserProps> = (_props) => {
	return (
		<div class="param-group">
			<div class="param-group-title">Sample</div>
			<button class="sample-chooser" type="button">
				Choose Sample
			</button>
		</div>
	);
};
