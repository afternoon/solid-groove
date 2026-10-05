// Lists the tests a Playwright JSON report marks "flaky": failed at least once,
// then passed on a retry. CI's retries otherwise hide them. Prints one
// "file › title" line per flaky test; prints nothing when there are none.
//
//   node scripts/list-flaky-tests.mjs playwright-results.json
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "playwright-results.json";
if (!existsSync(file)) process.exit(0);
const report = JSON.parse(readFileSync(file, "utf8"));

const flaky = [];
function walk(suite, titles) {
  const path = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === "flaky") {
        flaky.push(
          `${spec.file} › ${[...path.slice(1), spec.title].join(" › ")} [${test.projectName}]`,
        );
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, path);
}
for (const suite of report.suites ?? []) walk(suite, []);
for (const line of [...new Set(flaky)]) console.log(line);
