/**
 * Where Groove's Cloud Functions run, written down once: the functions
 * themselves (`functions/src/index.ts`'s `setGlobalOptions`) and every browser
 * call to one (`firebase/functions`' `getFunctions(app, region)`) read it, so
 * the two cannot disagree. A Storage trigger has to run in the default
 * bucket's location, and production's bucket is in `us-east1`.
 */
export const CLOUD_FUNCTIONS_REGION = "us-east1";
