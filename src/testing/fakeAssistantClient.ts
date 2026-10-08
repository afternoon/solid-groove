/**
 * A fake {@link AssistantClient} for component tests (GRV-26): it records
 * every turn it is sent, and the test plays each turn's events by hand, so a
 * reply can be held mid-stream, stopped, or failed exactly where it wants.
 */
import type { AssistantClient, AssistantStreamEvent } from "../assistant/assistantClient";
import type { AssistantErrorDetails, AssistantTurnRequest } from "../assistant/protocol";

export interface FakeTurn {
  readonly request: AssistantTurnRequest;
  /** Whether the browser stopped it. */
  readonly stopped: boolean;
  /** Plays one event to the conversation, as the gateway would. */
  emit(event: AssistantStreamEvent): void;
  text(text: string): void;
  done(): void;
  fail(error: AssistantErrorDetails): void;
}

export interface FakeAssistantClient extends AssistantClient {
  readonly turns: FakeTurn[];
  /** The latest turn, or a failure that names the missing one. */
  last(): FakeTurn;
}

export function createFakeAssistantClient(): FakeAssistantClient {
  const turns: FakeTurn[] = [];
  return {
    turns,
    last() {
      const turn = turns.at(-1);
      if (!turn) throw new Error("no turn has been sent");
      return turn;
    },
    send(request, onEvent) {
      let stopped = false;
      let settled = false;
      const emit = (event: AssistantStreamEvent) => {
        if (settled) return;
        if (event.type === "done" || event.type === "error") settled = true;
        onEvent(event);
      };
      turns.push({
        request,
        get stopped() {
          return stopped;
        },
        emit,
        text: (text) => emit({ type: "text", text }),
        done: () =>
          emit({
            type: "done",
            stopped: false,
            stopReason: "end_turn",
            requestsRemaining: 99,
          }),
        fail: (error) => emit({ type: "error", error }),
      });
      return {
        stop() {
          if (settled) return;
          stopped = true;
          emit({
            type: "done",
            stopped: true,
            stopReason: null,
            requestsRemaining: null,
          });
        },
      };
    },
  };
}
