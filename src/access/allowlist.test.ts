import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_COLLECTION,
  ALLOWLIST_ENTRY_FIELDS,
  type AllowlistEntry,
  type AllowlistWriter,
  ApprovalIncompleteError,
  allowlistDocPath,
  approvalChunks,
  approveEmails,
  isNotOnAllowlistError,
  isValidEmail,
  MAX_BATCH_WRITES,
  NOT_ON_ALLOWLIST,
  normaliseEmail,
  parseEmailBatch,
  SIGN_IN_ATTEMPTS_COLLECTION,
  signInAttemptDocPath,
} from "./allowlist";

describe("normaliseEmail", () => {
  it("trims and lower-cases, so one person is one document", () => {
    expect(normaliseEmail("  Ada.Lovelace@Example.COM \n")).toBe(
      "ada.lovelace@example.com",
    );
    expect(allowlistDocPath(" Ada@Example.com")).toBe("allowlist/ada@example.com");
    expect(signInAttemptDocPath("ADA@example.com")).toBe(
      "signInAttempts/ada@example.com",
    );
  });
});

describe("isValidEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isValidEmail("ada.lovelace+groove@example.co.uk")).toBe(true);
  });

  it("refuses what cannot be a Firestore document ID, so the path it builds is never broken", () => {
    for (const email of [
      "a/b@example.com",
      "ada@exa/mple.com",
      "ada@example.c/om",
      "__ada@example.com__",
    ]) {
      expect(isValidEmail(email), email).toBe(false);
    }
  });
});

describe("parseEmailBatch", () => {
  it("reads one address per line", () => {
    expect(parseEmailBatch("a@example.com\nb@example.com\r\nc@example.com\n")).toEqual({
      emails: ["a@example.com", "b@example.com", "c@example.com"],
      invalid: [],
    });
  });

  it("reads addresses separated by commas or semicolons", () => {
    expect(parseEmailBatch("a@example.com, b@example.com;c@example.com").emails).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("reads a column pasted from the Tally export, heading and quotes included", () => {
    const pasted = 'Email\n"Ada@Example.com"\n"grace@example.com"\n';
    expect(parseEmailBatch(pasted)).toEqual({
      emails: ["ada@example.com", "grace@example.com"],
      invalid: [],
    });
  });

  it("reads every cell of a tab-separated row and reports the ones that are not addresses", () => {
    expect(parseEmailBatch("Ada Lovelace\tada@example.com\t2026-10-01")).toEqual({
      emails: ["ada@example.com"],
      invalid: ["Ada Lovelace", "2026-10-01"],
    });
  });

  it("reads Name <address>", () => {
    expect(parseEmailBatch("Ada <ada@example.com>").emails).toEqual(["ada@example.com"]);
  });

  it("normalises, then keeps each address once", () => {
    expect(
      parseEmailBatch("ada@example.com\nADA@example.com\n ada@example.com ").emails,
    ).toEqual(["ada@example.com"]);
  });

  it("reports what is not an address, each once, as written", () => {
    expect(
      parseEmailBatch("nope\nada@\n@example.com\nnope\nada@example").invalid,
    ).toEqual(["nope", "ada@", "@example.com", "ada@example"]);
  });

  it("reports an address with a slash as invalid instead of failing the batch on it", () => {
    expect(parseEmailBatch("ada@example.com\nev/il@example.com")).toEqual({
      emails: ["ada@example.com"],
      invalid: ["ev/il@example.com"],
    });
  });

  it("comes to nothing for an empty paste", () => {
    expect(parseEmailBatch("  \n\n , ")).toEqual({ emails: [], invalid: [] });
  });
});

/** A writer over a map, recording what each commit did. */
function memoryWriter(listed: string[] = []) {
  const entries = new Map<string, AllowlistEntry>(
    listed.map((email) => [email, { email, addedAt: 0 }]),
  );
  const commits: { entries: AllowlistEntry[]; clearAttempts: string[] }[] = [];
  const writer: AllowlistWriter = {
    async listed(emails) {
      return new Set(emails.filter((email) => entries.has(email)));
    },
    async commit(added, clearAttempts) {
      commits.push({ entries: [...added], clearAttempts: [...clearAttempts] });
      for (const entry of added) entries.set(entry.email, entry);
    },
  };
  return { writer, entries, commits };
}

describe("approveEmails", () => {
  it("adds every address not yet listed in one commit, and reports the rest", async () => {
    const { writer, commits } = memoryWriter(["b@example.com"]);
    const report = await approveEmails(
      writer,
      parseEmailBatch("a@example.com\nb@example.com\nnope\nc@example.com"),
      42,
    );
    expect(report).toEqual({
      added: ["a@example.com", "c@example.com"],
      alreadyListed: ["b@example.com"],
      invalid: ["nope"],
    });
    expect(commits).toEqual([
      {
        entries: [
          { email: "a@example.com", addedAt: 42 },
          { email: "c@example.com", addedAt: 42 },
        ],
        clearAttempts: ["a@example.com", "b@example.com", "c@example.com"],
      },
    ]);
  });

  it("writes a paste longer than one batch in several commits", async () => {
    const { writer, commits } = memoryWriter();
    const emails = Array.from({ length: 300 }, (_, i) => `p${i}@example.com`);
    const report = await approveEmails(writer, parseEmailBatch(emails.join("\n")), 1);
    expect(report.added).toEqual(emails);
    expect(commits.map((commit) => commit.clearAttempts.length)).toEqual([250, 50]);
  });

  it("rethrows a failure that wrote nothing as it is", async () => {
    const { writer } = memoryWriter();
    const offline = new Error("offline");
    writer.commit = async () => {
      throw offline;
    };
    await expect(approveEmails(writer, parseEmailBatch("a@example.com"), 1)).rejects.toBe(
      offline,
    );
  });

  it("says what was written when a later batch fails", async () => {
    const { writer, entries } = memoryWriter(["p1@example.com"]);
    const commit = writer.commit;
    let calls = 0;
    writer.commit = async (added, clearAttempts) => {
      calls += 1;
      if (calls === 2) throw new Error("offline");
      await commit(added, clearAttempts);
    };
    const emails = Array.from({ length: 300 }, (_, i) => `p${i}@example.com`);
    const failure = await approveEmails(
      writer,
      parseEmailBatch([...emails, "nope"].join("\n")),
      1,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApprovalIncompleteError);
    const { written, unwritten } = failure as ApprovalIncompleteError;
    expect(written.added).toHaveLength(249);
    expect(written.alreadyListed).toEqual(["p1@example.com"]);
    expect(written.invalid).toEqual(["nope"]);
    expect(unwritten).toEqual(emails.slice(250));
    expect(entries.size).toBe(250);
  });

  it("writes nothing for a paste with no addresses", async () => {
    const { writer, commits } = memoryWriter();
    expect(await approveEmails(writer, parseEmailBatch("nope"), 1)).toEqual({
      added: [],
      alreadyListed: [],
      invalid: ["nope"],
    });
    expect(commits).toEqual([]);
  });
});

describe("approvalChunks", () => {
  it("keeps each chunk's writes, an entry and an attempt per address, inside one batch", () => {
    const emails = Array.from({ length: 600 }, (_, i) => `p${i}@example.com`);
    const chunks = approvalChunks(emails);
    expect(chunks.map((chunk) => chunk.length)).toEqual([250, 250, 100]);
    expect(Math.max(...chunks.map((chunk) => chunk.length * 2))).toBeLessThanOrEqual(
      MAX_BATCH_WRITES,
    );
  });
});

describe("isNotOnAllowlistError", () => {
  it("recognises the blocking function's refusal inside Firebase's generic error", () => {
    const error = Object.assign(
      new Error(
        `Firebase: {"error":{"code":403,"message":"BLOCKING_FUNCTION_ERROR_RESPONSE : ((${NOT_ON_ALLOWLIST}))"}} (auth/internal-error).`,
      ),
      { code: "auth/internal-error" },
    );
    expect(isNotOnAllowlistError(error)).toBe(true);
  });

  it("does not mistake any other failure for it", () => {
    expect(isNotOnAllowlistError(new Error("auth/popup-closed-by-user"))).toBe(false);
    expect(isNotOnAllowlistError({ code: "auth/internal-error", message: "boom" })).toBe(
      false,
    );
    expect(isNotOnAllowlistError(null)).toBe(false);
    expect(isNotOnAllowlistError("nope")).toBe(false);
  });
});

describe("firestore.rules", () => {
  const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

  it("guards both collections by the names this module writes to", () => {
    expect(rules).toContain(`match /${ALLOWLIST_COLLECTION}/{email}`);
    expect(rules).toContain(`match /${SIGN_IN_ATTEMPTS_COLLECTION}/{email}`);
  });

  it("accepts exactly the allowlist entry's fields", () => {
    const fields = ALLOWLIST_ENTRY_FIELDS.map((field) => `'${field}'`).join(", ");
    expect(rules).toContain(`data.keys().hasOnly([${fields}])`);
    expect(rules).toContain(`data.keys().hasAll([${fields}])`);
  });
});
