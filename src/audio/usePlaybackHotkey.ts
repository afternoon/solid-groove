import { onCleanup, onMount } from "solid-js";
import type SongPlayer from "./SongPlayer";

/**
 * Text entry is the one place space has to keep its normal meaning, so typing
 * targets are left alone. Everything else — buttons, sliders, the page body —
 * toggles playback.
 */
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target instanceof HTMLTextAreaElement) return true;
	if (target instanceof HTMLSelectElement) return true;
	if (target instanceof HTMLInputElement) {
		// Sliders, checkboxes and buttons have no text to type into.
		return ![
			"range",
			"checkbox",
			"radio",
			"button",
			"submit",
			"reset",
		].includes(target.type);
	}
	return false;
}

/**
 * Toggles playback whenever the user presses space, wherever focus happens to
 * be. Space would otherwise re-activate a focused button (replaying the last
 * transport click) or scroll the page, so the default is suppressed.
 */
export function usePlaybackHotkey(audio: SongPlayer) {
	function handleKeyDown(event: KeyboardEvent) {
		if (event.code !== "Space" && event.key !== " ") return;
		if (event.repeat) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTextEntry(event.target)) return;

		event.preventDefault();
		audio.toggle();
	}

	onMount(() => {
		window.addEventListener("keydown", handleKeyDown);
		onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
	});
}
