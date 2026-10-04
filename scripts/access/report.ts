import type { ApprovalReport } from "../../src/access/allowlist";

/** What an approval did, in the same three groups the admin page shows. */
export function printReport(report: ApprovalReport): void {
  console.log(`Added: ${report.added.length}`);
  for (const email of report.added) console.log(`  + ${email}`);
  console.log(`Already listed: ${report.alreadyListed.length}`);
  for (const email of report.alreadyListed) console.log(`  = ${email}`);
  console.log(`Invalid: ${report.invalid.length}`);
  for (const token of report.invalid) console.log(`  ! ${token}`);
}
