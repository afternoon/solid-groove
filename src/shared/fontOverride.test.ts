import { beforeEach, describe, expect, it } from "vitest";
import {
  FONT_OVERRIDE_STORAGE_KEY,
  googleFontsHref,
  parseFontParam,
  syncFontOverride,
} from "./fontOverride";

const at = (search: string) => ({ search });
const fontVar = () => document.documentElement.style.getPropertyValue("--font-family");
const link = () => document.getElementById("sg-font-override") as HTMLLinkElement | null;

describe("parseFontParam", () => {
  it("reads a family, a clear, or no claim", () => {
    expect(parseFontParam(null)).toBeUndefined();
    expect(parseFontParam("  IBM   Plex Sans ")).toBe("IBM Plex Sans");
    expect(parseFontParam("off")).toBeNull();
    expect(parseFontParam("")).toBeNull();
    expect(parseFontParam('Inter"></link><script>')).toBeUndefined();
  });
});

describe("googleFontsHref", () => {
  it("builds a css2 URL with + for spaces", () => {
    expect(googleFontsHref("JetBrains Mono")).toBe(
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap",
    );
  });
});

describe("syncFontOverride", () => {
  beforeEach(() => {
    localStorage.clear();
    link()?.remove();
    document.documentElement.style.removeProperty("--font-family");
  });

  it("does nothing by default", () => {
    expect(syncFontOverride(at(""), localStorage)).toBeNull();
    expect(link()).toBeNull();
    expect(fontVar()).toBe("");
  });

  it("loads, applies and remembers a family, then clears it", () => {
    expect(syncFontOverride(at("?font=Inter"), localStorage)).toBe("Inter");
    expect(link()?.href).toBe(googleFontsHref("Inter"));
    expect(fontVar()).toBe('"Inter", system-ui, sans-serif');
    expect(localStorage.getItem(FONT_OVERRIDE_STORAGE_KEY)).toBe("Inter");

    expect(syncFontOverride(at(""), localStorage)).toBe("Inter");
    expect(document.querySelectorAll("#sg-font-override")).toHaveLength(1);

    expect(syncFontOverride(at("?font=off"), localStorage)).toBeNull();
    expect(link()).toBeNull();
    expect(fontVar()).toBe("");
    expect(localStorage.getItem(FONT_OVERRIDE_STORAGE_KEY)).toBeNull();
  });
});
