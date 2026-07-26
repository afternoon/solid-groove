// Public surface of the analytics layer (PRD `OPS-02`).
//
// `firebaseTransport.ts` is deliberately absent: it is the only module that
// imports `firebase/analytics`, and application code must reach analytics
// through the boundary rather than through a vendor SDK. `src/telemetry.ts`
// imports it directly to wire it up, the same way `src/persistence`'s Firestore
// repository is imported only by its composition root.

export { Analytics, analytics, isDeclaredEvent } from "./analytics";
export type { AnalyticsOptions } from "./analytics";
export {
	BUCKET_SCALES,
	bucketLabels,
	bucketOf,
	projectAgeBucket,
} from "./buckets";
export type { BucketLabel, BucketScaleName, BucketUnit } from "./buckets";
export {
	ACCOUNT_TYPES,
	ANALYTICS_EVENT_NAMES,
	ANALYTICS_EVENTS,
	COMMAND_IDS,
	declaredValues,
	FEATURE_KEYS,
	PARAM_KINDS,
	sampleRateKey,
	SAMPLE_RATE_KEYS,
	SURFACES,
	validateEventPayload,
} from "./catalog";
export type {
	AccountType,
	AnalyticsEventName,
	AnalyticsEventPayload,
	AnalyticsParam,
	AnalyticsParamValue,
	CommandId,
	FeatureKey,
	SampleRateKey,
	Surface,
} from "./catalog";
export {
	CONSENT_ALL_OFF,
	CONSENT_DEFAULT,
	CONSENT_STORAGE_KEY,
	ConsentStore,
	consentStore,
} from "./consent";
export type { ConsentState } from "./consent";
export {
	ERROR_AREAS,
	ERROR_CODES,
	isErrorArea,
	isErrorCode,
	toErrorCode,
} from "./errorCodes";
export type { ErrorArea, ErrorCode } from "./errorCodes";
export {
	createFailingTransport,
	createRecordingTransport,
	noopTransport,
} from "./transport";
export type { AnalyticsTransport, RecordingTransport } from "./transport";
