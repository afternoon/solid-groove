import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { requestAccessUrl } from "../../site.config.mjs";
import NotOnAllowlist from "./NotOnAllowlist";

afterEach(() => cleanup());

function renderPage() {
  render(() => <NotOnAllowlist />);
}

describe("NotOnAllowlist (#854)", () => {
  it("says the visitor is not on the alpha list yet, in words rather than an error code", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "You're not on the alpha list yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/isn't on the list/)).toBeInTheDocument();
  });

  it("leads with Request access, to the request-access form", () => {
    renderPage();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAccessibleName("Request access");
    expect(links[0]).toHaveAttribute("href", requestAccessUrl);
    expect(requestAccessUrl).toBe("https://tally.so/r/Zjqyea");
  });

  it("offers a way back to the home page", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "Back to the home page" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
