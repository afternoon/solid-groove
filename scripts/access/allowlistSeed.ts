/**
 * `bun run allowlist:seed` (#854): grandfather every existing account.
 *
 * Run once, before the blocking `beforeSignIn` function is deployed, so
 * nobody who already signs in with Google is locked out when enforcement
 * ships. Every account with an email address and at least one sign-in
 * provider is added; guests (no provider, no address) are not, because guest
 * sessions keep working without signing in again. Running it twice is
 * harmless: an address already on the list is reported and left alone.
 */
import { approveEmails, parseEmailBatch } from "../../src/access/allowlist";
import { adminAllowlistWriter, adminServices } from "./adminApp";
import { printReport } from "./report";

const { auth, db } = adminServices();

const emails: string[] = [];
let pageToken: string | undefined;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    if (user.email && user.providerData.length > 0) emails.push(user.email);
  }
  pageToken = page.pageToken;
} while (pageToken);

console.log(`Found ${emails.length} signed-up account(s).`);
const report = await approveEmails(
  adminAllowlistWriter(db),
  parseEmailBatch(emails.join("\n")),
  Date.now(),
);
printReport(report);
