import { type Component, Show } from "solid-js";
import "./NotFound.css";

type NotFoundProps = {
	/** Optional call-to-action link back into the app. Defaults to the dashboard. */
	homeHref?: string;
};

/**
 * A full-page 404 shown when a project does not exist or the current user is
 * not allowed to open it. The illustration is a Roland Juno-106-style
 * synthesizer that has been dropped and cracked clean in half: a wide, shallow
 * control panel with the Juno's signature row of slider faders and a full-width
 * keyboard.
 *
 * It's drawn as a monochrome line illustration — thin outlines in the shared
 * foreground colour over the app's dark background, no flat cartoon fills — to
 * sit quietly in the app's visual language (see TapeLoader).
 *
 * The two halves are knocked apart and askew across a jagged break, with a
 * couple of sliders jolted loose. We keep it calm: nothing animates except an
 * optional subtle drift on the halves, which respects prefers-reduced-motion.
 */
const NotFound: Component<NotFoundProps> = (props) => {
	// A row of the Juno's signature vertical slider faders. Each is a track with
	// a small cap at a given height. `knock` nudges a cap off-centre so the
	// dropped unit looks jolted.
	const Sliders = (
		startX: number,
		count: number,
		caps: number[],
		knock = 0,
	) => (
		<g
			stroke="var(--color-foreground)"
			stroke-width="1.5"
			fill="none"
			stroke-linecap="round"
		>
			{Array.from({ length: count }, (_, i) => {
				const x = startX + i * 12;
				const capY = caps[i % caps.length];
				const jolt = i === 0 ? knock : 0;
				return (
					<>
						{/* Track */}
						<line x1={x} y1={80} x2={x} y2={112} />
						{/* Cap */}
						<line
							x1={x - 4 + jolt}
							y1={capY}
							x2={x + 4 + jolt}
							y2={capY - jolt * 0.4}
						/>
					</>
				);
			})}
		</g>
	);

	return (
		<div class="not-found">
			<svg
				class="not-found-synth"
				viewBox="0 0 440 230"
				xmlns="http://www.w3.org/2000/svg"
				role="img"
				aria-labelledby="not-found-title"
			>
				<title id="not-found-title">
					A Roland Juno-style synthesizer dropped and broken in half
				</title>

				{/* Shared line style: everything is a thin monochrome outline. */}
				<g
					stroke="var(--color-foreground)"
					stroke-width="2"
					fill="none"
					stroke-linejoin="round"
				>
					{/* ---------- Left half ---------- */}
					<g class="synth-half synth-half-left">
						{/* Chassis: shallow wedge, end-cap on the far side */}
						<path d="M26 52 h168 v128 H40 a12 12 0 0 1 -12 -12 Z" />
						{/* End cap seam */}
						<line x1="40" y1="52" x2="40" y2="180" />
						{/* Control-panel baseline separating panel from keys */}
						<line x1="40" y1="124" x2="194" y2="124" />
						{/* Logo strip (Juno's left accent block) */}
						<rect x="48" y="60" width="34" height="10" rx="1" />

						{/* Slider bank — the Juno's signature. One knocked loose. */}
						{Sliders(96, 6, [98, 90, 104, 88, 100, 94], 5)}

						{/* A couple of knobs to the right of the sliders */}
						<circle cx="176" cy="88" r="8" />
						<line x1="176" y1="88" x2="176" y2="81" />

						{/* Keyboard: white-key seams + black-key groups, all outline */}
						<g stroke-width="1.5">
							<line x1="58" y1="132" x2="58" y2="176" />
							<line x1="76" y1="132" x2="76" y2="176" />
							<line x1="94" y1="132" x2="94" y2="176" />
							<line x1="112" y1="132" x2="112" y2="176" />
							<line x1="130" y1="132" x2="130" y2="176" />
							<line x1="148" y1="132" x2="148" y2="176" />
							<line x1="166" y1="132" x2="166" y2="176" />
							<line x1="184" y1="132" x2="184" y2="176" />
							{/* Black keys: subtly filled so the keyboard reads clearly
							    while staying monochrome. */}
							<g fill="var(--color-background-highlight)">
								<rect x="52" y="132" width="10" height="26" />
								<rect x="72" y="132" width="10" height="26" />
								<rect x="108" y="132" width="10" height="26" />
								<rect x="126" y="132" width="10" height="26" />
								<rect x="144" y="132" width="10" height="26" />
								<rect x="180" y="132" width="10" height="26" />
							</g>
						</g>
					</g>

					{/* ---------- Right half ---------- */}
					<g class="synth-half synth-half-right">
						{/* Chassis mirror */}
						<path d="M246 52 h168 a12 12 0 0 1 12 12 v104 a12 12 0 0 1 -12 12 H246 Z" />
						{/* Seam where it broke */}
						<line x1="246" y1="52" x2="246" y2="180" />
						<line x1="246" y1="124" x2="414" y2="124" />

						{/* Remaining sliders + knobs cluster */}
						{Sliders(264, 5, [92, 100, 86, 98, 94])}
						<circle cx="344" cy="88" r="8" />
						<line x1="344" y1="88" x2="350" y2="83" />
						<circle cx="372" cy="88" r="8" />
						<line x1="372" y1="88" x2="367" y2="82" />

						{/* Keyboard */}
						<g stroke-width="1.5">
							<line x1="264" y1="132" x2="264" y2="176" />
							<line x1="282" y1="132" x2="282" y2="176" />
							<line x1="300" y1="132" x2="300" y2="176" />
							<line x1="318" y1="132" x2="318" y2="176" />
							<line x1="336" y1="132" x2="336" y2="176" />
							<line x1="354" y1="132" x2="354" y2="176" />
							<line x1="372" y1="132" x2="372" y2="176" />
							<line x1="390" y1="132" x2="390" y2="176" />
							<g fill="var(--color-background-highlight)">
								<rect x="258" y="132" width="10" height="26" />
								<rect x="294" y="132" width="10" height="26" />
								<rect x="312" y="132" width="10" height="26" />
								<rect x="348" y="132" width="10" height="26" />
								<rect x="384" y="132" width="10" height="26" />
							</g>
						</g>
					</g>

					{/* ---------- The break ---------- */}
					{/* Jagged crack running down where the two halves parted. */}
					<path
						d="M212 50 l10 14 -12 12 12 16 -10 12 8 18 -12 12 6 16"
						stroke-width="2"
					/>
					{/* A slider cap knocked clean off, tumbling in the gap. */}
					<line x1="224" y1="70" x2="234" y2="66" stroke-width="1.5" />
				</g>
			</svg>

			<div class="not-found-copy">
				<p class="not-found-code">404</p>
				<h1 class="not-found-title">This groove is broken</h1>
				<p class="not-found-message">
					We couldn't find this project — it may have been deleted, or you might
					not have access to it.
				</p>
				<Show when={props.homeHref !== ""}>
					<a class="not-found-home" href={props.homeHref ?? "/dashboard"}>
						Back to your projects
					</a>
				</Show>
			</div>
		</div>
	);
};

export default NotFound;
