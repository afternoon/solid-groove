import { For, type JSX, Show } from "@solidjs/web";
import { createSignal, onSettled } from "solid-js";
import type { AccessRepository } from "../../access/accessRepository";
import {
  type AllowlistEntry,
  type ApprovalReport,
  approveEmails,
  parseEmailBatch,
  type SignInAttempt,
} from "../../access/allowlist";
import { getAccessRepository } from "../../accessRepositoryClient";
import { type Analytics, analytics as defaultAnalytics } from "../../analytics/analytics";
import DataTable from "../DataTable";
import TapeLoader from "../TapeLoader";
import "./AllowlistAdmin.css";

export interface AllowlistAdminProps {
  /** Overridden in tests; defaults to the app's access repository. */
  repository?: () => Promise<AccessRepository>;
  /** Overridden in tests; defaults to the app-wide analytics boundary. */
  analytics?: Analytics;
  /** Overridden in tests; the time an approval is stamped with. */
  now?: () => number;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const formatTime = (ms: number) => dateFormat.format(new Date(ms));

/**
 * The admin page's body (#854): approve any number of addresses in one go,
 * approve a refused sign-in in one click, and take an address off the list.
 *
 * Every approval goes through `approveEmails`, the same function the
 * `allowlist:add` script runs, so a paste here and a file there come to the
 * same addresses. Analytics carries counts only, never an address.
 */
export default function AllowlistAdmin(props: AllowlistAdminProps): JSX.Element {
  const repository = props.repository ?? getAccessRepository;
  const analytics = props.analytics ?? defaultAnalytics;
  const now = props.now ?? Date.now;

  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal(false);
  const [allowlist, setAllowlist] = createSignal<AllowlistEntry[]>([]);
  const [attempts, setAttempts] = createSignal<SignInAttempt[]>([]);
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [report, setReport] = createSignal<ApprovalReport | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);

  const refresh = async () => {
    const store = await repository();
    const [entries, refused] = await Promise.all([
      store.listAllowlist(),
      store.listAttempts(),
    ]);
    setAllowlist(entries);
    setAttempts(refused);
  };

  const load = () => {
    setLoading(true);
    setLoadError(false);
    refresh()
      .catch((error: unknown) => {
        console.error("Error loading the allowlist:", error);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  };

  onSettled(() => load());

  const approve = async (source: "paste" | "attempt", input: string) => {
    if (busy()) return;
    setBusy(true);
    setActionError(null);
    try {
      const store = await repository();
      const result = await approveEmails(store, parseEmailBatch(input), now());
      setReport(result);
      analytics.log("allowlist_approved", {
        source,
        added_count: result.added.length,
        already_listed_count: result.alreadyListed.length,
        invalid_count: result.invalid.length,
      });
      analytics.logFeatureFirstUse("allowlist_admin");
      if (source === "paste") setText(result.invalid.join("\n"));
      await refresh();
    } catch (error) {
      console.error("Error approving addresses:", error);
      setActionError("Couldn't approve those addresses. Nothing was changed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (email: string) => {
    if (busy()) return;
    setBusy(true);
    setActionError(null);
    try {
      await (await repository()).remove(email);
      await refresh();
    } catch (error) {
      console.error("Error removing an address:", error);
      setActionError("Couldn't remove that address. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    void approve("paste", text());
  };

  return (
    <div class="allowlist-admin">
      <section class="allowlist-section" aria-labelledby="allowlist-approve-heading">
        <h2 id="allowlist-approve-heading" class="allowlist-section-title">
          Approve addresses
        </h2>
        <form class="allowlist-approve" onSubmit={onSubmit}>
          <label class="allowlist-label" for="allowlist-emails">
            Email addresses
          </label>
          <p class="allowlist-hint" id="allowlist-emails-hint">
            One per line or separated by commas. A column pasted from the Tally export
            works too.
          </p>
          <textarea
            id="allowlist-emails"
            class="allowlist-textarea"
            rows={8}
            aria-describedby="allowlist-emails-hint"
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
          />
          <div class="allowlist-actions">
            <button
              type="submit"
              class="allowlist-primary"
              disabled={busy() || text().trim() === ""}
            >
              Approve
            </button>
          </div>
        </form>
        <Show when={report()}>{(result) => <ApprovalSummary report={result()} />}</Show>
        <Show when={actionError()}>
          <p class="allowlist-error" role="alert">
            {actionError()}
          </p>
        </Show>
      </section>

      <Show when={!loading()} fallback={<TapeLoader label="Loading the allowlist" />}>
        <Show
          when={!loadError()}
          fallback={
            <div class="allowlist-error" role="alert">
              <p>Couldn't load the allowlist.</p>
              <button type="button" onClick={load}>
                Try again
              </button>
            </div>
          }
        >
          <section class="allowlist-section" aria-labelledby="allowlist-blocked-heading">
            <h2 id="allowlist-blocked-heading" class="allowlist-section-title">
              Blocked sign-ins
            </h2>
            <Show
              when={attempts().length > 0}
              fallback={<p class="allowlist-empty">Nobody has been turned away.</p>}
            >
              <DataTable
                label="Blocked sign-ins"
                class="allowlist-table"
                columns={[
                  { label: "Email" },
                  { label: "Attempts", width: "96px" },
                  { label: "Last tried", width: "200px" },
                  { label: "Action", width: "120px", hideLabel: true },
                ]}
              >
                <For each={attempts()} keyed={(attempt) => attempt.email}>
                  {(attempt) => (
                    <tr>
                      <td class="allowlist-email">{attempt().email}</td>
                      <td>{attempt().count}</td>
                      <td>{formatTime(attempt().lastAttemptAt)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={busy()}
                          aria-label={`Approve ${attempt().email}`}
                          onClick={() => void approve("attempt", attempt().email)}
                        >
                          Approve
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </DataTable>
            </Show>
          </section>

          <section class="allowlist-section" aria-labelledby="allowlist-listed-heading">
            <h2 id="allowlist-listed-heading" class="allowlist-section-title">
              On the allowlist ({allowlist().length})
            </h2>
            <Show
              when={allowlist().length > 0}
              fallback={<p class="allowlist-empty">Nobody is on the allowlist yet.</p>}
            >
              <DataTable
                label="Allowlist"
                class="allowlist-table"
                columns={[
                  { label: "Email" },
                  { label: "Added", width: "200px" },
                  { label: "Action", width: "120px", hideLabel: true },
                ]}
              >
                <For each={allowlist()} keyed={(entry) => entry.email}>
                  {(entry) => (
                    <tr>
                      <td class="allowlist-email">{entry().email}</td>
                      <td>{formatTime(entry().addedAt)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={busy()}
                          aria-label={`Remove ${entry().email}`}
                          onClick={() => void remove(entry().email)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </DataTable>
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  );
}

/** What the last approval did: added, already listed, and what was not an address. */
function ApprovalSummary(props: { report: ApprovalReport }): JSX.Element {
  return (
    <output class="allowlist-report">
      <p class="allowlist-counts">
        <span>Added {props.report.added.length}</span>
        <span>Already listed {props.report.alreadyListed.length}</span>
        <span>Invalid {props.report.invalid.length}</span>
      </p>
      <Show when={props.report.invalid.length > 0}>
        <p class="allowlist-invalid">
          Not an address, left in the box to fix: {props.report.invalid.join(", ")}
        </p>
      </Show>
    </output>
  );
}
