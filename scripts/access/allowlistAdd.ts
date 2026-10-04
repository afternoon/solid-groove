/**
 * `bun run allowlist:add -- <file.csv|emails…>` (#854): approve a batch of
 * addresses from a terminal.
 *
 * Each argument is either a file (a `.csv` or `.txt`, the Tally export
 * included) or an address. Everything is read with the same parser the admin
 * page uses, so a file approves the same addresses here as pasted there, and
 * each address's blocked sign-in attempt is cleared with it.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  ApprovalIncompleteError,
  approveEmails,
  parseEmailBatch,
} from "../../src/access/allowlist";
import { adminAllowlistWriter, adminServices, fail } from "./adminApp";
import { printReport } from "./report";

const args = process.argv.slice(2);
if (args.length === 0) {
  fail("Usage: bun run allowlist:add -- <file.csv|email…>");
}

const text = args
  .map((arg) => (existsSync(arg) ? readFileSync(arg, "utf8") : arg))
  .join("\n");

const { db } = adminServices();
try {
  const report = await approveEmails(
    adminAllowlistWriter(db),
    parseEmailBatch(text),
    Date.now(),
  );
  printReport(report);
  if (report.added.length + report.alreadyListed.length === 0) process.exit(1);
} catch (error) {
  if (!(error instanceof ApprovalIncompleteError)) throw error;
  printReport(error.written);
  console.error(`Not approved, after an error: ${error.unwritten.length}`);
  for (const email of error.unwritten) console.error(`  ? ${email}`);
  console.error(error.cause);
  process.exit(1);
}
