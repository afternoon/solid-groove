// The app, its accounts and the browser it runs in: the analytics events and
// value sets that are about Groove itself rather than a project in it.

import { ERROR_AREAS, ERROR_CODES } from "../errorCodes";
import { type AnalyticsEventDefinition, boolParam, enumParam } from "./params";

/**
 * The surfaces the app can log from. Attached to every event automatically
 * (see `AUTOMATIC_PARAMS`), so no event declares it.
 */
export const SURFACES = ["landing", "dashboard", "editor"] as const;
export type Surface = (typeof SURFACES)[number];

/** Non-identifying account facts, logged as a GA4 user property. */
export const ACCOUNT_TYPES = ["anonymous", "registered", "unknown"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * The browser capabilities Groove feature-detects (PRD section 10, #75), as
 * `browser_capability_missing`'s `capability`. Pinned here like
 * `SHORTCUT_ACTION_IDS`: `catalog.test.ts` asserts it equals
 * `CAPABILITY_IDS` in `src/browser/capabilities.ts` exactly, so a new probe has
 * to be given an analytics decision in the same change.
 */
export const BROWSER_CAPABILITY_IDS = [
  "web_audio",
  "audio_decoding",
  "offline_audio",
  "site_storage",
  "canvas_2d",
  "file_download",
] as const;

/** The app's `feature_first_use` keys (see `FEATURE_KEYS`). */
export const APP_FEATURE_KEYS = [
  // The in-app account controls (#951): logging a guest in to an existing
  // account, and signing out.
  "log_in",
  "sign_out",
] as const;

export const APP_EVENTS = {
  app_opened: {
    phase: 0,
    owners: ["FND-001c"],
    params: {},
  },

  landing_cta_click: {
    phase: 1,
    owners: ["LOOP-001b"],
    params: { cta_id: enumParam(["start_free", "log_in"]) },
  },

  anon_session_created: {
    phase: 1,
    owners: ["LOOP-001"],
    params: {},
  },

  account_upgraded: {
    phase: 1,
    owners: ["LOOP-001"],
    // The alpha's only upgrade path is linking an anonymous account to a
    // Google identity (see src/auth/authService.ts). A second provider adds
    // its key here with the sign-in method itself.
    params: { method: enumParam(["google"]) },
  },

  browser_capability_missing: {
    phase: 1,
    owners: ["#75"],
    // The editor opened in a browser that lacks a capability Groove depends
    // on, so the producer was shown what it costs and what to do (PRD section
    // 10, #75). Once per capability per browser: a missing API is a property
    // of the browser, not of a session. `is_required` separates "no sound at
    // all" from one feature being unavailable.
    params: {
      capability: enumParam(BROWSER_CAPABILITY_IDS),
      is_required: boolParam(),
    },
  },

  exception: {
    phase: 0,
    owners: ["FND-001c"],
    params: {
      fatal: boolParam(),
      area: enumParam(ERROR_AREAS),
      error_code: enumParam(ERROR_CODES),
    },
  },
} as const satisfies Record<string, AnalyticsEventDefinition>;
