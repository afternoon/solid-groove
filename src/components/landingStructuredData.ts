import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from "../../site.config.mjs";
import { LANDING_FAQ } from "./landingCopy";

/**
 * The home page's structured data (#1135): JSON-LD for a `SoftwareApplication`
 * and a `FAQPage`, rendered into the prerendered document head by
 * `src/Document.tsx`.
 *
 * Built here rather than inline so it can be tested as data, and so the FAQ is
 * the one the page shows (`LANDING_FAQ`). No price, rating or offer: the alpha
 * is invite-only and has none, and structured data that claims one is the
 * kind search engines penalise.
 */

export function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Music production",
    operatingSystem: "Web browser",
    url: `${SITE_ORIGIN}/`,
  };
}

export function faqPageJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: LANDING_FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/**
 * Serialises JSON-LD for a `<script>` body.
 *
 * `<` is escaped so no string in the data can close the script element early.
 * The data is this module's own constants, not input, but the rule costs
 * nothing and keeps it safe if that ever changes.
 */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
