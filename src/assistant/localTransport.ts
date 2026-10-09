/**
 * A transport that runs the gateway in the page (GRV-26), for the mock
 * backend (`bun run dev:mock`), which has no Functions emulator to call. It
 * is the same `runAssistantTurn` the Cloud Function runs, over in-memory
 * guards and the emulator's scripted provider, so the conversation behaves
 * as it does against the emulator: streamed replies, Stop, and the
 * `[hang]`/`[flaky]`/`[propose]` markers (`emulatorProvider.ts`).
 *
 * A failure rejects in the callable error's shape (`details` carrying the
 * gateway's code), which is what {@link assistantErrorFrom} reads.
 */
import type { AssistantTurnStream, AssistantTurnTransport } from "./assistantClient";
import {
  type AssistantCaller,
  type AssistantGatewayDeps,
  runAssistantTurn,
} from "./gateway";
import { AssistantGatewayError, type AssistantStreamChunk } from "./protocol";

/** An async iterable fed by pushes, ended once. */
function chunkQueue(): {
  readonly iterable: AsyncIterable<AssistantStreamChunk>;
  push(chunk: AssistantStreamChunk): void;
  end(): void;
} {
  const queued: AssistantStreamChunk[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = queued.shift();
          if (next) {
            yield next;
            continue;
          }
          if (ended) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
    push(chunk) {
      queued.push(chunk);
      notify();
    },
    end() {
      ended = true;
      notify();
    },
  };
}

export function createLocalAssistantTransport(
  deps: AssistantGatewayDeps,
  caller: AssistantCaller,
): AssistantTurnTransport {
  return async (request, { signal }): Promise<AssistantTurnStream> => {
    const queue = chunkQueue();
    const result = runAssistantTurn(deps, caller, request, {
      signal,
      onChunk: (chunk) => queue.push(chunk),
    }).then(
      (turn) => {
        queue.end();
        return turn;
      },
      (error: unknown) => {
        queue.end();
        throw error instanceof AssistantGatewayError
          ? { code: "functions/unknown", details: error.details }
          : { code: "functions/internal" };
      },
    );
    return { chunks: queue.iterable, result };
  };
}
