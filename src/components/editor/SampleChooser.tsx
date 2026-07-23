import { type Component, createEffect, For } from "solid-js";
import {
	isKnownSample,
	sampleLibrary,
	sampleName,
} from "../../model/sampleLibrary";

interface SampleChooserProps {
	sampleUrl: string;
	onChange: (sampleUrl: string) => void;
}

export const SampleChooser: Component<SampleChooserProps> = (props) => {
	let dialog: HTMLDialogElement | undefined;

	const choose = (url: string) => {
		props.onChange(url);
		dialog?.close();
	};

	// Close when the user clicks the backdrop (outside the dialog content).
	createEffect(() => {
		const el = dialog;
		if (!el) return;
		const onClick = (e: MouseEvent) => {
			if (e.target === el) el.close();
		};
		el.addEventListener("click", onClick);
	});

	return (
		<div class="param-group">
			<div class="param-group-title">Sample</div>
			<button
				class="sample-chooser"
				classList={{
					"sample-chooser-unknown": !isKnownSample(props.sampleUrl),
				}}
				type="button"
				onClick={() => dialog?.showModal()}
			>
				{sampleName(props.sampleUrl)}
			</button>

			<dialog class="sample-modal" ref={dialog} aria-label="Choose sample">
				<div class="sample-modal-title">Choose Sample</div>
				<ul class="sample-modal-list">
					<For each={sampleLibrary}>
						{(sample) => (
							<li>
								<button
									type="button"
									class="sample-modal-option"
									classList={{
										"sample-modal-option-selected":
											sample.url === props.sampleUrl,
									}}
									onClick={() => choose(sample.url)}
								>
									{sample.name}
								</button>
							</li>
						)}
					</For>
				</ul>
				<button
					type="button"
					class="sample-modal-close"
					onClick={() => dialog?.close()}
				>
					Cancel
				</button>
			</dialog>
		</div>
	);
};
