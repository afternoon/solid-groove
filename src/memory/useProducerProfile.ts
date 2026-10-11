/**
 * One producer's profile, loaded for whoever is signed in and saved whole
 * (GRV-25): what the editor's memory cards and the Memory page read and
 * change. Changes run one at a time, each applied to the profile the change
 * before it saved, so two in flight together never lose one another; and none
 * runs until the profile has loaded, so a change can never write an empty
 * profile over one that could not be read.
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
   * Saves `change` applied to the profile as it stands, after any change
   * already on its way (an empty profile for someone with none). Resolves
   * with the saved profile, or null when nothing changed: the save failed, or
   * the profile has not loaded, or failed to.
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
  /** Whether `now` is the stored profile: the load finished and succeeded. */
  let ready = false;
  /** Bumped on every sign-in change, so a change queued before it lapses. */
  let generation = 0;
  /** The last change queued: the next one waits for it to settle. */
  let queue: Promise<unknown> = Promise.resolve();

  createEffect(
    () => options.uid(),
    (uid) => {
      owner = uid;
      now = null;
      ready = false;
      generation += 1;
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
              ready = true;
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

  async function apply(
    uid: string,
    since: number,
    change: (current: ProducerProfile) => ProducerProfile,
  ): Promise<ProducerProfile | null> {
    if (!ready || since !== generation) return null;
    const next = change(now ?? emptyProfile(clock.now()));
    try {
      const result = await (await repository()).saveProfile(uid, next);
      if (!result.ok || since !== generation) return null;
      now = result.profile;
      setProfile(result.profile);
      return result.profile;
    } catch {
      return null;
    }
  }

  function update(
    change: (current: ProducerProfile) => ProducerProfile,
  ): Promise<ProducerProfile | null> {
    const uid = owner;
    if (!uid || !ready) return Promise.resolve(null);
    const since = generation;
    const run = queue.then(() => apply(uid, since, change));
    queue = run;
    return run;
  }

  return { profile, loaded, failed, current: () => now, update };
}
