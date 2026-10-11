/**
 * One producer's profile, loaded for whoever is signed in and saved whole
 * (GRV-25): what the editor's memory cards and the Memory page read and
 * change. Every change is a function of the profile as last saved, so two
 * changes in a row never lose one another.
 */
import { type Accessor, createEffect, createSignal } from "solid-js";
import { emptyProfile, type ProducerProfile } from "../persistence/profileDocuments";
import type { ProfileRepository } from "../persistence/profileRepository";
import { getProfileRepository } from "../profileRepositoryClient";
import { type Clock, systemClock } from "../shared/clock";

export interface ProducerProfileStore {
  /** The profile, or null before it loads (or for someone with none yet). */
  readonly profile: Accessor<ProducerProfile | null>;
  /** Whether the first read has finished, either way. */
  readonly loaded: Accessor<boolean>;
  /** Whether the first read failed. */
  readonly failed: Accessor<boolean>;
  /** The profile as it stands now, past any change not yet drawn. */
  current(): ProducerProfile | null;
  /**
   * Saves `change` applied to the profile as it stands (an empty one for
   * someone with none). Resolves with the saved profile, or null when the
   * save failed and nothing changed.
   */
  update(
    change: (profile: ProducerProfile) => ProducerProfile,
  ): Promise<ProducerProfile | null>;
}

export interface UseProducerProfileOptions {
  readonly uid: Accessor<string | null>;
  readonly repository?: () => Promise<ProfileRepository>;
  readonly clock?: Clock;
}

export function useProducerProfile(
  options: UseProducerProfileOptions,
): ProducerProfileStore {
  const repository = options.repository ?? getProfileRepository;
  const clock = options.clock ?? systemClock;
  const [profile, setProfile] = createSignal<ProducerProfile | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  // A plain copy: Solid 2 batches writes, so a read straight after one would
  // still see the profile from before it.
  let now: ProducerProfile | null = null;
  let owner: string | null = null;

  createEffect(
    () => options.uid(),
    (uid) => {
      owner = uid;
      now = null;
      setProfile(null);
      setLoaded(false);
      setFailed(false);
      if (!uid) return;
      let cancelled = false;
      repository()
        .then((store) => store.loadProfile(uid))
        .then(
          (result) => {
            if (cancelled) return;
            if (result.ok) {
              now = result.profile;
              setProfile(result.profile);
            } else {
              setFailed(true);
            }
            setLoaded(true);
          },
          () => {
            if (cancelled) return;
            setFailed(true);
            setLoaded(true);
          },
        );
      return () => {
        cancelled = true;
      };
    },
  );

  async function update(
    change: (current: ProducerProfile) => ProducerProfile,
  ): Promise<ProducerProfile | null> {
    const uid = owner;
    if (!uid) return null;
    const next = change(now ?? emptyProfile(clock.now()));
    try {
      const result = await (await repository()).saveProfile(uid, next);
      if (!result.ok || owner !== uid) return null;
      now = result.profile;
      setProfile(result.profile);
      return result.profile;
    } catch {
      return null;
    }
  }

  return { profile, loaded, failed, current: () => now, update };
}
