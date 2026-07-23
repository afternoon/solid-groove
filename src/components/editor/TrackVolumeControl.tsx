import type { Component } from "solid-js";
import { VerticalSlider } from "./VerticalSlider";

interface TrackVolumeControlProps {
	volume: number;
	onChange: (volume: number) => void;
}

/**
 * Per-track output fader. The stored value is a 0–1 fader position; SongPlayer
 * applies the perceptual taper when turning it into audio gain.
 */
export const TrackVolumeControl: Component<TrackVolumeControlProps> = (
	props,
) => {
	return (
		<div class="param-group">
			<div class="param-group-title">Level</div>
			<div class="param-group-controls">
				<VerticalSlider
					label={`${Math.round(props.volume * 100)}%`}
					min={0}
					max={1}
					value={props.volume}
					step={0.01}
					onChange={props.onChange}
				/>
			</div>
		</div>
	);
};
