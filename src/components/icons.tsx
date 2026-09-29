import type { JSX } from "@solidjs/web";

/**
 * The transport's own glyphs. Heroicons' solid set rounds every corner,
 * which fights the square-cornered design (docs/design.md), so these are
 * drawn on a 24-unit grid with mitred joins and square caps instead.
 */
type IconProps = { size?: number };

function Icon(props: IconProps & { children: JSX.Element }) {
  return (
    <svg
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="0"
      stroke-linejoin="miter"
      stroke-linecap="square"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <polygon points="6,3.5 21,12 6,20.5" />
    </Icon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <rect x="5" y="5" width="14" height="14" />
    </Icon>
  );
}

export function LoopIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <path d="M4 12V7h12M20 12v5H8" fill="none" stroke-width="2.5" />
      <polygon points="15,2.5 21,7 15,11.5" />
      <polygon points="9,12.5 3,17 9,21.5" />
    </Icon>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <path d="M8 9h11v10h-8" fill="none" stroke-width="2.5" />
      <polygon points="9,3 3,9 9,15" />
    </Icon>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <path d="M16 9H5v10h8" fill="none" stroke-width="2.5" />
      <polygon points="15,3 21,9 15,15" />
    </Icon>
  );
}

/**
 * A wind-up pyramid metronome: the tapered case on its plinth, and the
 * pendulum swung off-centre with its sliding weight.
 */
export function MetronomeIcon(props: IconProps) {
  return (
    <Icon size={props.size}>
      <polygon points="8.5,2 15.5,2 20,19 4,19" fill="none" stroke-width="2" />
      <rect x="2.5" y="19" width="19" height="3" />
      <line x1="12" y1="17" x2="15.6" y2="5" stroke-width="2" />
      <rect
        x="-2.5"
        y="-1.4"
        width="5"
        height="2.8"
        transform="translate(13.6 11.6) rotate(16.7)"
      />
    </Icon>
  );
}
