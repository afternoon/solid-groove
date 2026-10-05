/**
 * `bun run admin:grant -- <email>` (#854): make an account an admin.
 *
 * Sets the `admin: true` custom claim the admin page and `firestore.rules`
 * read, keeping any other claims the account has, and puts the address on the
 * allowlist so the admin can sign in at all. The account has to exist, which
 * means it has signed in once: an address that has not is allowlisted and
 * asked to sign in first, then this is run again.
 *
 * A claim reaches the browser with the account's next ID token, so a signed-in
 * admin sees the page after signing out and in again (or within the hour).
 */
import {
  approveEmails,
  normaliseEmail,
  parseEmailBatch,
} from "../../src/access/allowlist";
import { adminAllowlistWriter, adminServices, fail } from "./adminApp";

const [raw] = process.argv.slice(2);
if (!raw) fail("Usage: bun run admin:grant -- <email>");

const batch = parseEmailBatch(raw);
if (batch.emails.length !== 1) fail(`Not an email address: ${raw}`);
const email = normaliseEmail(batch.emails[0]);

const { auth, db } = adminServices();
await approveEmails(adminAllowlistWriter(db), batch, Date.now());

let user: Awaited<ReturnType<typeof auth.getUserByEmail>>;
try {
  user = await auth.getUserByEmail(email);
} catch (error) {
  if ((error as { code?: string }).code === "auth/user-not-found") {
    fail(
      `${email} is on the allowlist now but has no account yet. ` +
        "Sign in with it once, then run this again.",
    );
  }
  throw error;
}

await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
console.log(`${email} is an admin. Sign out and in again to see /admin.`);
