/**
 * The home page's copy that two places have to agree on (#1135).
 *
 * The FAQ is shown on the page and also published as `FAQPage` structured
 * data in the document head (`landingStructuredData.ts`). Search engines only
 * honour that markup when it matches what a visitor can read, so both are
 * rendered from this one list rather than kept in step by hand.
 *
 * Plain data with no imports, so the prerendered document shell can read it
 * without pulling anything browser-only into the Node build (ADR 0008).
 *
 * ## Honesty is a requirement here, not a tone
 *
 * PRD `PRJ-06`: the page does not advertise capabilities the alpha has not
 * shipped. The AI producer is the one thing on the page that is still being
 * built, and every mention of it says when it arrives. Everything else here
 * is in the studio today.
 */

/**
 * When the AI producer arrives. Every claim the page makes about it carries
 * this, so moving the date is one edit; the assistant's own closing issue
 * removes it when the panel ships.
 */
export const AI_PRODUCER_ARRIVES = "October";

/**
 * Browsers the alpha is tested in (PRD section 10, "Supported environment").
 * Chrome, Edge, and Firefox gate the release; Safari is best-effort and is
 * described as such rather than listed alongside them.
 */
export const GATING_BROWSERS = "Chrome, Edge and Firefox";

export interface LandingFaq {
  question: string;
  answer: string;
}

/** Section 8 of the page, in the order the spec lists them. */
export const LANDING_FAQ: readonly LandingFaq[] = [
  {
    question: "Do I need to install anything?",
    answer: `No. Groove runs in your browser on a desktop or laptop. We test every release in ${GATING_BROWSERS}; Safari should work, but it is not covered by those tests yet. Your projects save as you work.`,
  },
  {
    question: "Does the AI make the music for me?",
    answer: `No. The AI producer, arriving in ${AI_PRODUCER_ARRIVES}, works inside your project: it suggests a change, you hear it before you keep it, and it explains why it works. You keep, tweak or undo every change, so the track stays yours.`,
  },
  {
    question: "Can I take my track into another DAW?",
    answer:
      "Yes. Export a stereo WAV of the whole song, or DAW-ready stems: one WAV per track, lined up at bar 1, ready to mix in Ableton Live, Logic Pro or any other DAW.",
  },
  {
    question: "Who is it for?",
    answer:
      "Producers who can make a loop but rarely finish a track. If you have used a sampler, a groovebox, a beat app or an entry-level DAW, and want to learn arrangement, sound design and mixing by doing them on your own music, it is for you.",
  },
  {
    question: "How do I get in?",
    answer:
      "Request an invite. Groove is an invite-only alpha, and we're letting producers in in small batches. Once you're invited, sign in with that Google account.",
  },
  {
    question: "Does it work on my phone?",
    answer:
      "Not for making music yet. The studio is built for a desktop or laptop screen and a keyboard. You can request an invite from your phone and open Groove on your computer once you're in.",
  },
];
