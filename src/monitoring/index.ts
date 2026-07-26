// Public surface of the error-monitoring layer (PRD `OPS-03`, ADR 0001).
//
// `sentrySink.ts` is deliberately absent. It is the only module that imports
// `@sentry/*`, and ADR 0001 decision 1 requires that "application code does
// not call the Sentry SDK directly" — leaving it out of the barrel is what
// makes that a structural fact rather than a review convention.
// `src/telemetry.ts` imports it dynamically as the composition root.

export {
	BROWSER_NAMES,
	currentBrowserInfo,
	ENGINE_NAMES,
	parseBrowserInfo,
	UNKNOWN_BROWSER,
} from "./browserInfo";
export type { BrowserInfo, BrowserName, EngineName } from "./browserInfo";
export {
	CodedError,
	codeFor,
	ErrorReporter,
	errorReporter,
	reportError,
} from "./errorReporting";
export type {
	ErrorReport,
	ErrorReporterOptions,
	ErrorSink,
	ReportOptions,
} from "./errorReporting";
export { installGlobalErrorHandlers } from "./globalHandlers";
export type { GlobalHandlerOptions } from "./globalHandlers";
export {
	ALLOWED_CONTEXTS,
	ALLOWED_TAGS,
	MAX_MESSAGE_LENGTH,
	pathOnly,
	redactText,
	scrubBreadcrumb,
	scrubFramePath,
	scrubSelector,
	scrubSentryEvent,
} from "./scrub";
export type {
	ScrubbableBreadcrumb,
	ScrubbableEvent,
	ScrubbableException,
	ScrubbableFrame,
} from "./scrub";
