import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS } from "./capabilities";
import { audioStartFailureMessage, CAPABILITY_MESSAGES } from "./capabilityMessages";

describe("CAPABILITY_MESSAGES", () => {
  it.each(CAPABILITY_IDS)(
    "says what is wrong, what it costs, and what to do: %s",
    (id) => {
      const message = CAPABILITY_MESSAGES[id];
      expect(message.title.length).toBeGreaterThan(0);
      expect(message.detail.length).toBeGreaterThan(0);
      // Actionable (#75): the action names a supported browser or a setting to
      // change, never only that something is broken.
      expect(message.action).toMatch(/Chrome, Edge or Firefox|settings/);
    },
  );
});

describe("audioStartFailureMessage", () => {
  it("tells a producer whose browser blocked sound to press Play again or allow sound", () => {
    const message = audioStartFailureMessage("autoplay_blocked");
    expect(message.title).toBe("The browser blocked sound");
    expect(message.action).toMatch(/Press Play again/);
    expect(message.action).toMatch(/allow sound for this site/);
  });

  it("explains a missing audio engine as the missing-Web-Audio capability", () => {
    expect(audioStartFailureMessage("not_supported")).toBe(CAPABILITY_MESSAGES.web_audio);
    expect(audioStartFailureMessage("context_unavailable")).toBe(
      CAPABILITY_MESSAGES.web_audio,
    );
  });

  it("falls back to a retry for any other failure", () => {
    expect(audioStartFailureMessage("unknown").action).toMatch(/Press Play to try again/);
  });
});
