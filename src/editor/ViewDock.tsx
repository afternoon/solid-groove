import { For, type JSX } from "@solidjs/web";
import {
  HiSolidAdjustmentsVertical,
  HiSolidMusicalNote,
  HiSolidViewColumns,
} from "solid-icons/hi";
import { EDITOR_VIEW_SPECS, type EditorViewName } from "./editorViews";
import "./ViewDock.css";

const ICONS: Record<EditorViewName, () => JSX.Element> = {
  arrangement: () => <HiSolidViewColumns size={18} />,
  instrument: () => <HiSolidMusicalNote size={18} />,
  mixer: () => <HiSolidAdjustmentsVertical size={18} />,
};

export interface ViewDockProps {
  /** The view currently on screen, from the URL (`UI-001`). */
  readonly view: EditorViewName;
  /** Where each view lives, so every entry is a real, copyable address. */
  href(view: EditorViewName): string;
  /** Called for an ordinary activation, so the host navigates and measures. */
  onSelect(view: EditorViewName): void;
  /** The key that reaches this view, from the registry — for the tooltip. */
  keyHint(view: EditorViewName): string;
}

/**
 * The floating dock: three views, one tap each (`UI-001`).
 *
 * A phone's tab bar in idiom — above the content along the bottom edge, always
 * reachable, never scrolling away — but **navigation, not tabs**: a view is an
 * address, so each entry is a real `<a href>`, openable in a new tab, copyable,
 * reachable with the back button, and marked with `aria-current`.
 *
 * An ordinary left-click is handled here rather than by the anchor, so the host
 * can record *how* the view was reached (`view_changed`'s `via`) before it
 * navigates; a modified click is left to the browser, which keeps the addresses
 * honest. The label is the accessible name and the icon is decorative, so
 * "Arrangement" is what a speech-input user says — hence the key in the tooltip.
 */
export default function ViewDock(props: ViewDockProps): JSX.Element {
  /** The plain activation the dock owns; anything the browser gives its own
   * meaning — a middle click, a modifier — belongs to the anchor. */
  const isPlainActivation = (event: MouseEvent): boolean =>
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;

  return (
    <nav class="view-dock" aria-label="Views">
      <ul class="view-dock-list">
        <For each={EDITOR_VIEW_SPECS}>
          {(spec) => {
            const current = () => props.view === spec.view;
            const Icon = ICONS[spec.view];
            return (
              <li>
                <a
                  class="view-dock-link"
                  href={props.href(spec.view)}
                  aria-current={current() ? "page" : undefined}
                  title={`${spec.label} (${props.keyHint(spec.view)})`}
                  onClick={(event) => {
                    if (!isPlainActivation(event)) return;
                    event.preventDefault();
                    props.onSelect(spec.view);
                  }}
                >
                  <span class="view-dock-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  {spec.label}
                </a>
              </li>
            );
          }}
        </For>
      </ul>
    </nav>
  );
}
