import {
  createInMemoryTranscriptStore,
  type InMemoryTranscriptStore,
} from "./inMemoryTranscriptStore";
import { describeTranscriptStoreContract } from "./transcriptStoreContract";
import type { RetentionPreference } from "./transcripts";

let current: InMemoryTranscriptStore = createInMemoryTranscriptStore();

describeTranscriptStoreContract("in memory", {
  store: async () => {
    current = createInMemoryTranscriptStore();
    return current;
  },
  records: async () => current.records(),
  rawPreference: async (uid, value) =>
    current.setPreference(uid, value as RetentionPreference),
});
