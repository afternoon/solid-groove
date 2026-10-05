/**
 * `bun run allowlist:seed [-- --before <ISO>]` (#854): grandfather every
 * existing account.
 *
 * Run it before the blocking `beforeSignIn` function is deployed, so nobody
 * who already signs in with Google is locked out when enforcement ships. Every
 * account with an email address and a sign-in provider is added; guests (no
 * provider, no address) are not, because guest sessions keep working without
 * signing in again. Before the gate deploys, running it twice is harmless.
 *
 * After the gate deploys it is not: a refused sign-in still creates its Auth
 * account, so "every account" includes everyone the gate turned away. The
 * decision is `planGrandfathering` (`src/access/grandfather.ts`): a refused
 * address is never seeded, and once `signInAttempts` holds anything the script
 * stops unless `--before` names when the gate was deployed, in which case only
 * accounts created before then are seeded.
 */
import {
  approveEmails,
  parseEmailBatch,
  SIGN_IN_ATTEMPTS_COLLECTION,
} from "../../src/access/allowlist";
import {
  parseCreatedBefore,
  planGrandfathering,
  type SeedCandidate,
} from "../../src/access/grandfather";
import { adminAllowlistWriter, adminServices, fail } from "./adminApp";
import { printReport } from "./report";

const cutoff = parseCreatedBefore(process.argv.slice(2));
if (!cutoff.ok) fail(cutoff.error);

const { auth, db } = adminServices();

const accounts: SeedCandidate[] = [];
let pageToken: string | undefined;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    accounts.push({
      email: user.email,
      hasProvider: user.providerData.length > 0,
      createdAt: Date.parse(user.metadata.creationTime),
    });
  }
  pageToken = page.pageToken;
} while (pageToken);

const attempts = await db.collection(SIGN_IN_ATTEMPTS_COLLECTION).select().get();
const plan = planGrandfathering({
  accounts,
  refusedEmails: attempts.docs.map((doc) => doc.id),
  createdBefore: cutoff.createdBefore,
});

if (!plan.ok) {
  fail(
    `The allowlist gate has already refused ${plan.refusedCount} sign-in(s), and a refused ` +
      "sign-in still creates an account, so seeding now would approve those people.\n" +
      "Seeding is meant to run before the gate deploys. To seed anyway, pass the time it " +
      "deployed and only older accounts are added:\n" +
      "  bun run allowlist:seed -- --before 2026-10-01T12:00:00Z",
  );
}

console.log(`Found ${plan.emails.length} account(s) to grandfather.`);
if (plan.skippedRefused.length > 0) {
  console.log(`Skipped, refused by the gate: ${plan.skippedRefused.length}`);
  for (const email of plan.skippedRefused) console.log(`  - ${email}`);
}
if (plan.skippedAfterCutoff.length > 0) {
  console.log(`Skipped, created after --before: ${plan.skippedAfterCutoff.length}`);
  for (const email of plan.skippedAfterCutoff) console.log(`  - ${email}`);
}
const report = await approveEmails(
  adminAllowlistWriter(db),
  parseEmailBatch(plan.emails.join("\n")),
  Date.now(),
);
printReport(report);
