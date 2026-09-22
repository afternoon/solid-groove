import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorViewName } from "./editorViews";
import ViewDock from "./ViewDock";

afterEach(cleanup);

function renderDock(
  view: EditorViewName,
  onSelect: (view: EditorViewName) => void = () => {},
) {
  return render(() => (
    <ViewDock
      view={view}
      href={(target) =>
        `/projects/prj_abc${target === "arrangement" ? "" : `/${target}`}`
      }
      onSelect={onSelect}
      keyHint={(target) => ({ arrangement: "1", instrument: "2", mixer: "3" })[target]}
    />
  ));
}

function dock(): HTMLElement {
  return screen.getByRole("navigation", { name: "Views" });
}

describe("ViewDock", () => {
  it("names the three views as links to their own addresses", () => {
    renderDock("arrangement");
    const addresses = {
      Arrangement: "/projects/prj_abc",
      Instrument: "/projects/prj_abc/instrument",
      Mixer: "/projects/prj_abc/mixer",
    };
    for (const [name, href] of Object.entries(addresses)) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("marks exactly one view as the one you are on", () => {
    const [view, setView] = createSignal<EditorViewName>("arrangement");
    render(() => (
      <ViewDock
        view={view()}
        href={(target) => `/${target}`}
        onSelect={setView}
        keyHint={() => "1"}
      />
    ));
    const current = () => dock().querySelectorAll("[aria-current='page']");
    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Arrangement");

    setView("mixer");
    flush();
    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Mixer");
  });

  it("reports a plain click instead of letting the browser follow the link", () => {
    const onSelect = vi.fn();
    renderDock("arrangement", onSelect);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "Mixer" }).dispatchEvent(event);
    expect(onSelect).toHaveBeenCalledWith("mixer");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a modified click to the browser, so the address still works", () => {
    const onSelect = vi.fn();
    // Same-document hrefs: an uncancelled click on a path would have jsdom
    // attempt a navigation it does not implement, which is noise, not a find.
    render(() => (
      <ViewDock
        view="arrangement"
        href={(target) => `#${target}`}
        onSelect={onSelect}
        keyHint={() => "1"}
      />
    ));
    const link = screen.getByRole("link", { name: "Mixer" });
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    link.dispatchEvent(event);
    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("puts the key in the tooltip and hides the icon, leaving the label as the name", () => {
    renderDock("arrangement");
    expect(screen.getByRole("link", { name: "Instrument" })).toHaveAttribute(
      "title",
      "Instrument (2)",
    );
    for (const icon of dock().querySelectorAll(".view-dock-icon")) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("is keyboard operable, because every entry is a real link", () => {
    const onSelect = vi.fn();
    renderDock("arrangement", onSelect);
    // Three focusable links, and Enter on one dispatches a click — which the
    // dock treats as a pointer activation rather than handling keys itself.
    const links = dock().querySelectorAll("a[href]:not([tabindex='-1'])");
    expect(links).toHaveLength(3);
    fireEvent.click(screen.getByRole("link", { name: "Instrument" }));
    expect(onSelect).toHaveBeenCalledWith("instrument");
  });
});
