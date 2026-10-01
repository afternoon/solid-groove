import type { JSX } from "@solidjs/web";

/**
 * The library window's line icons, drawn as the reference draws them
 * (`docs/library-browser.html`): 16-unit boxes stroked in `currentColor`, so
 * each takes its control's colour and state.
 */
function Icon(props: { children: JSX.Element }): JSX.Element {
  return (
    <svg
      class="library-modal-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export function SearchIcon(): JSX.Element {
  return (
    <Icon>
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" />
    </Icon>
  );
}

export function ClearIcon(): JSX.Element {
  return (
    <Icon>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}
