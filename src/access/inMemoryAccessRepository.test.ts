import type { AccessRepository } from "./accessRepository";
import { describeAccessRepositoryContract } from "./accessRepositoryContract";
import {
  createInMemoryAccessRepository,
  type InMemoryAccessRepository,
} from "./inMemoryAccessRepository";

describeAccessRepositoryContract("in-memory", {
  repository: async () => createInMemoryAccessRepository(),
  seedAttempt: async (repository: AccessRepository, attempt) =>
    (repository as InMemoryAccessRepository).recordAttempt(attempt),
  seedAccount: async (repository: AccessRepository, email) =>
    (repository as InMemoryAccessRepository).recordAccount(email),
});
