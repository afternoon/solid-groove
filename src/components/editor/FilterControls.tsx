import type { Component } from "solid-js";
import type { FilterConfig } from "../../model/types";
import { VerticalSlider } from "./VerticalSlider";

interface FilterControlsProps {
	filter: FilterConfig;
	onChange: (filter: FilterConfig) => void;
}

export const FilterControls: Component<FilterControlsProps> = (props) => {
	return (
		<div class="param-group">
			<div class="param-group-title">Filter</div>
			<div class="param-group-controls">
				<div class="param-group">
					<div
						class="param-group-controls"
						style={{ "flex-direction": "column", gap: "4px" }}
					>
						<select
							value={props.filter.type}
							onChange={(e) =>
								props.onChange({
									...props.filter,
									type: e.target.value as FilterConfig["type"],
								})
							}
							style={{
								"font-size": "10px",
								padding: "4px",
								"background-color": "var(--color-background-tertiary, #2a2a2a)",
								color: "var(--color-text-primary, #fff)",
								border: "1px solid var(--color-text-secondary, #888)",
								"border-radius": "2px",
							}}
						>
							<option value="lowpass">Lowpass</option>
							<option value="highpass">Highpass</option>
							<option value="bandpass">Bandpass</option>
							<option value="notch">Notch</option>
						</select>
					</div>
				</div>
				<VerticalSlider
					label="Cutoff"
					min={20}
					max={20000}
					value={props.filter.cutoff}
					step={10}
					onChange={(cutoff) => props.onChange({ ...props.filter, cutoff })}
				/>
				<VerticalSlider
					label="Resonance"
					min={0}
					max={20}
					value={props.filter.resonance}
					step={0.1}
					onChange={(resonance) =>
						props.onChange({ ...props.filter, resonance })
					}
				/>
			</div>
		</div>
	);
};
