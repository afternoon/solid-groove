import { describe, expect, it } from "vitest";
import { SITE_ORIGIN } from "../../site.config.mjs";
import { LANDING_FAQ } from "./landingCopy";
import {
  faqPageJsonLd,
  jsonLdScript,
  softwareApplicationJsonLd,
} from "./landingStructuredData";

describe("the home page's structured data (#1135)", () => {
  it("describes Groove as a web application at the site's origin", () => {
    expect(softwareApplicationJsonLd()).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Groove",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web browser",
      url: `${SITE_ORIGIN}/`,
    });
  });

  it("claims no price, offer or rating", () => {
    const keys = Object.keys(softwareApplicationJsonLd());
    for (const key of ["offers", "aggregateRating", "price"]) {
      expect(keys).not.toContain(key);
    }
  });

  it("publishes the FAQ the page shows, word for word", () => {
    const data = faqPageJsonLd() as {
      "@type": string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(data["@type"]).toBe("FAQPage");
    expect(LANDING_FAQ).toHaveLength(6);
    expect(
      data.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]),
    ).toEqual(LANDING_FAQ.map((item) => [item.question, item.answer]));
  });

  it("serialises to JSON that cannot close its script element", () => {
    const text = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
