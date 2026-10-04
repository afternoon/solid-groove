import { describe, expect, it, vi } from "vitest";
import { Analytics } from "../analytics/analytics";
import { ConsentStore } from "../analytics/consent";
import { createRecordingTransport } from "../analytics/transport";
import { memoryStorage } from "../testing/storage";
import { ShortcutController, type ShortcutHandlers } from "./ShortcutController";
import type { ShortcutContext } from "./types";

interface FakeKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  defaultPrevented: boolean;
}

function keyEvent(
  key: string,
  overrides: Partial<Omit<FakeKeyEvent, "preventDefault">> = {},
): FakeKeyEvent {
  const event = {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    ...overrides,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
  } as FakeKeyEvent;
  return event;
}

function setup(
  options: {
    handlers?: ShortcutHandlers;
    contexts?: readonly ShortcutContext[];
    isTextEntry?: (target: EventTarget | null) => boolean;
  } = {},
) {
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  analytics.setAccountType("anonymous");
  let handlers = options.handlers ?? {};
  let contexts = options.contexts ?? (["editor"] as readonly ShortcutContext[]);
  const controller = new ShortcutController({
    handlers: () => handlers,
    contexts: () => contexts,
    platform: "other",
    analytics,
    isTextEntry: options.isTextEntry ?? (() => false),
  });
  return {
    controller,
    transport,
    press: (event: FakeKeyEvent) =>
      controller.handleKeyDown(event as unknown as KeyboardEvent),
    setHandlers: (next: ShortcutHandlers) => {
      handlers = next;
    },
    setContexts: (next: readonly ShortcutContext[]) => {
      contexts = next;
    },
  };
}

describe("dispatch", () => {
  it("runs the handler for a registered action and suppresses the default", () => {
    const run = vi.fn();
    const { press } = setup({ handlers: { "transport.play_stop": { run } } });

    const event = keyEvent(" ");
    const result = press(event);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.ran).toBe(true);
    expect(result.shortcut?.id).toBe("transport.play_stop");
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores a key with no mapping", () => {
    const { press } = setup({
      handlers: { "transport.play_stop": { run() {} } },
    });

    const event = keyEvent("j");

    expect(press(event).rejected).toBe("no_match");
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing for a mapped action nobody has registered a handler for", () => {
    // Every PRD mapping is registered; the surfaces land task by task.
    const { press } = setup({ contexts: ["arrangement"] });

    const event = keyEvent("e");

    expect(press(event).rejected).toBe("no_handler");
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing for a disabled action, and leaves the default alone", () => {
    const run = vi.fn();
    const { press } = setup({
      handlers: { "edit.undo": { run, isEnabled: () => false } },
    });

    const event = keyEvent("z", { ctrlKey: true });
    const result = press(event);

    expect(run).not.toHaveBeenCalled();
    expect(result.rejected).toBe("disabled");
    expect(event.defaultPrevented).toBe(false);
  });

  it("re-reads handlers and contexts on every event", () => {
    const split = vi.fn();
    const { press, setHandlers, setContexts } = setup();

    expect(press(keyEvent("e")).rejected).toBe("no_match");

    setHandlers({ "arrangement.split_clip": { run: split } });
    setContexts(["arrangement"]);

    expect(press(keyEvent("e")).ran).toBe(true);
    expect(split).toHaveBeenCalledTimes(1);
  });

  it("ignores auto-repeat unless the mapping is held-key friendly", () => {
    const play = vi.fn();
    const zoom = vi.fn();
    const { press } = setup({
      handlers: {
        "transport.play_stop": { run: play },
        "view.zoom_in": { run: zoom },
      },
      contexts: ["editor", "timeline"],
    });

    expect(press(keyEvent(" ", { repeat: true })).rejected).toBe("repeat");
    expect(play).not.toHaveBeenCalled();
    expect(press(keyEvent("+", { repeat: true })).ran).toBe(true);
    expect(zoom).toHaveBeenCalledTimes(1);
  });

  it("still suppresses the default of an ignored repeat of a shortcut that would run (#961)", () => {
    const audition = vi.fn();
    const insert = vi.fn();
    const { press, transport } = setup({
      handlers: {
        "library.audition": { run: audition },
        "library.insert_and_return": { run: insert },
      },
      contexts: ["library"],
    });

    // Held Space/Enter: the first press runs, every auto-repeat is ignored but
    // must not fall through to the focused button's click.
    const space = keyEvent(" ");
    const spaceRepeat = keyEvent(" ", { repeat: true });
    const enterRepeat = keyEvent("Enter", { repeat: true });

    expect(press(space).ran).toBe(true);
    expect(press(spaceRepeat).rejected).toBe("repeat");
    expect(press(enterRepeat).rejected).toBe("repeat");

    expect(spaceRepeat.defaultPrevented).toBe(true);
    expect(enterRepeat.defaultPrevented).toBe(true);
    expect(audition).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(
      transport.events.filter((event) => event.name === "shortcut_used"),
    ).toHaveLength(1);
  });

  it("leaves the default of a repeat alone when the first press would not have run", () => {
    const { press, setHandlers } = setup({ contexts: ["library"] });

    const unhandled = keyEvent(" ", { repeat: true });
    expect(press(unhandled).rejected).toBe("no_handler");
    expect(unhandled.defaultPrevented).toBe(false);

    setHandlers({ "library.audition": { run: vi.fn(), isEnabled: () => false } });
    const disabled = keyEvent(" ", { repeat: true });
    expect(press(disabled).rejected).toBe("disabled");
    expect(disabled.defaultPrevented).toBe(false);
  });

  it("keeps suppressing a held key's repeats after its action closed the surface (#961)", () => {
    const insert = vi.fn();
    const { press, setHandlers, setContexts, transport } = setup({
      handlers: { "library.insert_and_return": { run: insert } },
      contexts: ["library"],
    });

    // Enter inserts and closes the library; focus returns to the slot button,
    // where nothing maps Enter any more.
    expect(press(keyEvent("Enter")).ran).toBe(true);
    setHandlers({});
    setContexts(["editor"]);

    const repeat = keyEvent("Enter", { repeat: true });
    expect(press(repeat).rejected).toBe("repeat");
    expect(repeat.defaultPrevented).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(
      transport.events.filter((event) => event.name === "shortcut_used"),
    ).toHaveLength(1);

    // A fresh press is the browser's again.
    const fresh = keyEvent("Enter");
    expect(press(fresh).rejected).toBe("no_match");
    expect(fresh.defaultPrevented).toBe(false);
    const freshRepeat = keyEvent("Enter", { repeat: true });
    expect(press(freshRepeat).rejected).toBe("no_match");
    expect(freshRepeat.defaultPrevented).toBe(false);
  });

  it("only claims the repeats of the key that ran", () => {
    const { press } = setup({
      handlers: { "library.insert": { run: vi.fn() } },
      contexts: ["library"],
    });

    press(keyEvent("Enter"));
    const other = keyEvent("j", { repeat: true });
    expect(press(other).rejected).toBe("no_match");
    expect(other.defaultPrevented).toBe(false);
  });

  it("leaves the default of a repeat alone in a typing target", () => {
    const { press } = setup({
      handlers: { "library.audition": { run: vi.fn() } },
      contexts: ["library"],
      isTextEntry: () => true,
    });

    const repeat = keyEvent(" ", { repeat: true });
    expect(press(repeat).rejected).toBe("text_entry");
    expect(repeat.defaultPrevented).toBe(false);
  });
});

describe("text entry", () => {
  it("never leaks a single-letter or Space shortcut into a typing target", () => {
    const play = vi.fn();
    const quantize = vi.fn();
    const { press } = setup({
      handlers: {
        "transport.play_stop": { run: play },
        "clip.quantize": { run: quantize },
      },
      contexts: ["editor", "step_editor"],
      isTextEntry: () => true,
    });

    const space = keyEvent(" ");
    const q = keyEvent("q");

    expect(press(space).rejected).toBe("text_entry");
    expect(press(q).rejected).toBe("text_entry");
    expect(play).not.toHaveBeenCalled();
    expect(quantize).not.toHaveBeenCalled();
    // The keystroke must reach the field unchanged.
    expect(space.defaultPrevented).toBe(false);
    expect(q.defaultPrevented).toBe(false);
  });

  it("lets Escape through text entry, because a modal has to close from its search box", () => {
    const close = vi.fn();
    const { press } = setup({
      handlers: { "view.close_surface": { run: close } },
      contexts: ["dialog"],
      isTextEntry: () => true,
    });

    expect(press(keyEvent("Escape")).ran).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses a real input element by default", () => {
    const run = vi.fn();
    const controller = new ShortcutController({
      handlers: () => ({ "transport.play_stop": { run } }),
      contexts: () => ["editor"],
      platform: "other",
    });
    const input = document.createElement("input");
    const slider = document.createElement("input");
    slider.type = "range";

    controller.handleKeyDown(
      keyEvent(" ", { target: input }) as unknown as KeyboardEvent,
    );
    expect(run).not.toHaveBeenCalled();

    controller.handleKeyDown(
      keyEvent(" ", { target: slider }) as unknown as KeyboardEvent,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("contexts", () => {
  it("does not fire an editor shortcut while a modal is open", () => {
    const play = vi.fn();
    const close = vi.fn();
    const { press } = setup({
      handlers: {
        "transport.play_stop": { run: play },
        "view.close_surface": { run: close },
      },
      contexts: ["dialog"],
    });

    expect(press(keyEvent(" ")).rejected).toBe("no_match");
    expect(play).not.toHaveBeenCalled();
    expect(press(keyEvent("Escape")).ran).toBe(true);
  });

  it("fires library keys only while the library is open beside its dialog", () => {
    const like = vi.fn();
    const play = vi.fn();
    const handlers = {
      "library.like": { run: like },
      "transport.play_stop": { run: play },
    };
    const inLibrary = setup({ handlers, contexts: ["dialog", "library"] });
    expect(inLibrary.press(keyEvent("l")).ran).toBe(true);
    expect(like).toHaveBeenCalledTimes(1);
    expect(inLibrary.press(keyEvent(" ")).ran).toBe(false);
    expect(play).not.toHaveBeenCalled();

    // Any other modal is plain `dialog`: the same key does nothing there.
    const inOtherDialog = setup({ handlers, contexts: ["dialog"] });
    expect(inOtherDialog.press(keyEvent("l")).rejected).toBe("no_match");
    expect(like).toHaveBeenCalledTimes(1);
  });

  it("keeps a library letter for the search field, but lets Down leave it", () => {
    const like = vi.fn();
    const next = vi.fn();
    const { press } = setup({
      handlers: { "library.like": { run: like }, "library.select_next": { run: next } },
      contexts: ["dialog", "library"],
      isTextEntry: () => true,
    });
    expect(press(keyEvent("l")).rejected).toBe("text_entry");
    expect(press(keyEvent("ArrowDown")).ran).toBe(true);
    expect(like).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reports whether an action is enabled, for tooltips and the guide", () => {
    const { controller } = setup({
      handlers: {
        "edit.undo": { run() {}, isEnabled: () => false },
        "edit.redo": { run() {} },
      },
    });

    expect(controller.isEnabled("edit.undo")).toBe(false);
    expect(controller.isEnabled("edit.redo")).toBe(true);
    expect(controller.isEnabled("clip.quantize")).toBe(false);
  });
});

describe("analytics", () => {
  it("logs shortcut_used with the registry's action ID, not the handler's", () => {
    const { press, transport } = setup({
      handlers: { "edit.undo": { run() {} } },
    });

    press(keyEvent("z", { ctrlKey: true }));

    const events = transport.events.filter((event) => event.name === "shortcut_used");
    expect(events).toHaveLength(1);
    expect(events[0]?.params.action_id).toBe("edit.undo");
  });

  it("logs once per press, and not at all when nothing ran", () => {
    const { press, transport } = setup({
      handlers: {
        "edit.undo": { run() {}, isEnabled: () => false },
        "transport.play_stop": { run() {} },
      },
    });

    press(keyEvent("z", { ctrlKey: true }));
    press(keyEvent("j"));
    press(keyEvent(" "));
    press(keyEvent(" "));

    expect(
      transport.events.filter((event) => event.name === "shortcut_used"),
    ).toHaveLength(2);
  });

  it("sends nothing while the user has opted out of analytics", () => {
    const transport = createRecordingTransport();
    const consent = new ConsentStore(memoryStorage());
    consent.set({ productAnalytics: false });
    const analytics = new Analytics({
      transport,
      consent,
      storage: memoryStorage(),
    });
    const run = vi.fn();
    const controller = new ShortcutController({
      handlers: () => ({ "transport.play_stop": { run } }),
      contexts: () => ["editor"],
      platform: "other",
      analytics,
      isTextEntry: () => false,
    });

    controller.handleKeyDown(keyEvent(" ") as unknown as KeyboardEvent);

    expect(run).toHaveBeenCalledTimes(1);
    expect(transport.events).toHaveLength(0);
  });

  // #835: Select all reaches the arrangement context, with or without analytics.
  it("logs edit.select_all once per press in the arrangement, and runs it opted out too", () => {
    const run = vi.fn();
    const handlers = { "edit.select_all": { run } };
    const on = setup({ handlers, contexts: ["editor", "arrangement"] });
    const pressed = keyEvent("a", { ctrlKey: true });
    expect(on.press(pressed).ran).toBe(true);
    expect(pressed.defaultPrevented).toBe(true);
    const uses = on.transport.events.filter((event) => event.name === "shortcut_used");
    expect(uses.map((event) => event.params.action_id)).toEqual(["edit.select_all"]);

    const transport = createRecordingTransport();
    const consent = new ConsentStore(memoryStorage());
    consent.set({ productAnalytics: false });
    const off = new ShortcutController({
      handlers: () => handlers,
      contexts: () => ["editor", "arrangement"],
      platform: "other",
      analytics: new Analytics({ transport, consent, storage: memoryStorage() }),
      isTextEntry: () => false,
    });
    const offPress = keyEvent("a", { ctrlKey: true });
    off.handleKeyDown(offPress as unknown as KeyboardEvent);
    expect(run).toHaveBeenCalledTimes(2);
    expect(offPress.defaultPrevented).toBe(true);
    expect(transport.events).toHaveLength(0);
  });
});

describe("attach", () => {
  it("listens until detached", () => {
    const run = vi.fn();
    const controller = new ShortcutController({
      handlers: () => ({ "transport.play_stop": { run } }),
      contexts: () => ["editor"],
      platform: "other",
    });
    const detach = controller.attach(window);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(run).toHaveBeenCalledTimes(1);

    detach();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
