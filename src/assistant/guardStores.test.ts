import { describeGuardStoresContract } from "./guardStoresContract";
import {
  createInMemoryGuardStores,
  type InMemoryGuardStores,
} from "./inMemoryGuardStores";

let current: InMemoryGuardStores = createInMemoryGuardStores();

describeGuardStoresContract("in memory", {
  stores: async () => {
    current = createInMemoryGuardStores();
    return current;
  },
  setEnabled: async (enabled) => current.setEnabled(enabled),
});
