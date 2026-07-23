import type { Component } from "solid-js";
import "./TapeLoader.css";

type TapeLoaderProps = {
	label?: string;
};

/**
 * A large, electronic-music-themed loading spinner: a reel-to-reel tape deck
 * with two spinning reels and tape running across the bottom. Only the reels
 * are animated, to keep things calm.
 */
const TapeLoader: Component<TapeLoaderProps> = (props) => {
	// One reel rendered as a group so we can reuse it for both spools.
	const Reel = (cx: number, cy: number, spinClass: string) => (
		<g class={spinClass}>
			{/* Outer flange */}
			<circle
				cx={cx}
				cy={cy}
				r="52"
				fill="var(--color-background-highlight)"
				stroke="var(--color-foreground)"
				stroke-width="2"
			/>
			{/* Wound tape */}
			<circle
				cx={cx}
				cy={cy}
				r="42"
				fill="none"
				stroke="var(--color-background-tertiary)"
				stroke-width="16"
			/>
			{/* Hub */}
			<circle cx={cx} cy={cy} r="14" fill="var(--color-background-secondary)" />
			<circle
				cx={cx}
				cy={cy}
				r="14"
				fill="none"
				stroke="var(--color-foreground)"
				stroke-width="2"
			/>
			{/* Three spokes so rotation is visible */}
			<g
				stroke="var(--color-foreground)"
				stroke-width="4"
				stroke-linecap="round"
			>
				<line x1={cx} y1={cy} x2={cx} y2={cy - 40} />
				<line x1={cx} y1={cy} x2={cx + 35} y2={cy + 20} />
				<line x1={cx} y1={cy} x2={cx - 35} y2={cy + 20} />
			</g>
			<circle cx={cx} cy={cy} r="4" fill="var(--color-foreground-bright)" />
		</g>
	);

	return (
		<output class="tape-loader" aria-live="polite">
			<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg">
				<title>Loading</title>

				{/* The two reels (drawn first so the tape runs in front of them) */}
				{Reel(70, 90, "reel-left")}
				{Reel(190, 90, "reel-right")}

				{/* Tape runs in a straight line across the bottom of the reels */}
				<line
					x1="70"
					y1="142"
					x2="190"
					y2="142"
					stroke="var(--color-foreground)"
					stroke-width="2.5"
					opacity="0.85"
				/>

				{/* Capstan / tape head block sitting on the tape path, centre */}
				<rect
					x="116"
					y="134"
					width="28"
					height="16"
					rx="2"
					fill="var(--color-foreground)"
				/>
			</svg>
			<span class="loader-label">{props.label ?? "Loading"}</span>
		</output>
	);
};

export default TapeLoader;
