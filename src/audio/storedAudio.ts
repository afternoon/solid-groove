/**
 * Audio a project names by where it is stored rather than by a URL (#282).
 *
 * A factory sound plays from a public URL. A producer's own sound has none:
 * a download URL is a bearer token, and a project carrying one would hand the
 * owner's audio to every collaborator who can read it. Such a sound is named
 * only by its `storageRef` (`users/{uid}/packs/…`), and its bytes are read as
 * the signed-in user, so the storage rules decide who hears it.
 *
 * The audio layer does not know how that read is done — that is the personal
 * library's repository, behind its own boundary, and Firebase never enters
 * `src/audio`. The app installs a {@link StoredAudioSource} once
 * ({@link provideStoredAudio}); the buffer loader and the library's audition
 * engine call {@link readStoredAudio} for any asset that has no URL.
 */

/** Reads the bytes stored at a `storageRef`, as the signed-in user. */
export type StoredAudioSource = (storageRef: string) => Promise<ArrayBuffer>;

/** No source is installed, or it refused: the asset has nothing to decode. */
export class StoredAudioUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoredAudioUnavailableError";
  }
}

let source: StoredAudioSource | null = null;

/**
 * Install the source stored audio is read from. Returns a function that
 * removes it again, if it is still the installed one.
 */
export function provideStoredAudio(next: StoredAudioSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

/** The bytes of the audio stored at `storageRef`. */
export async function readStoredAudio(storageRef: string): Promise<ArrayBuffer> {
  if (!source) {
    throw new StoredAudioUnavailableError("No stored-audio source is installed");
  }
  try {
    return await source(storageRef);
  } catch (error) {
    throw new StoredAudioUnavailableError("Stored audio could not be read", {
      cause: error,
    });
  }
}
