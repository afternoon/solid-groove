import { flush } from "solid-js";
import { vi } from "vitest";
import {
  type exportStemsBatch,
  type StemsBatchRequest,
  type StemsExportFile,
  stemsBatchFileName,
} from "../editor/export/stemsExport";

/**
 * A stand-in for the Export dialog's `exportStemsBatch` seam: every call waits
 * until the test settles it, and is recorded with the request it was made with,
 * so a test can walk a batched export one ZIP at a time.
 */

export interface BatchCall {
  readonly request: StemsBatchRequest;
  /** Finishes this ZIP, with a file named as the real export would name it. */
  resolve(file?: StemsExportFile): Promise<void>;
  reject(error: unknown): Promise<void>;
}

/** Lets the dialog's awaiting loop run to its next call. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

export function fakeStemsBatch(projectName = "Song") {
  const calls: BatchCall[] = [];
  const fake = vi.fn(
    (_project: unknown, request: StemsBatchRequest) =>
      new Promise<StemsExportFile>((resolve, reject) => {
        calls.push({
          request,
          resolve: async (file) => {
            resolve(
              file ?? {
                blob: new Blob([new Uint8Array([1])], { type: "application/zip" }),
                fileName: stemsBatchFileName(
                  projectName,
                  request.date ?? new Date(),
                  request.batch.index,
                  request.count,
                ),
              },
            );
            await settle();
          },
          reject: async (error) => {
            reject(error);
            await settle();
          },
        });
      }),
  );
  return { exportStemsBatch: fake as unknown as typeof exportStemsBatch, calls };
}
