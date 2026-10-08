import { For, type JSX, Show } from "@solidjs/web";
import {
  HiOutlineArrowUpTray,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineXMark,
  HiSolidXMark,
} from "solid-icons/hi";
import { createEffect, createMemo, createSignal, onSettled } from "solid-js";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import {
  MAX_SOUND_NAME_LENGTH,
  type UserPack,
  userPackAssets,
} from "../userLibrary/userPacks";
import type { ImportMethod, ImportRow, UserLibrary } from "../userLibrary/useUserLibrary";
import type { FavouriteMarks, SoundKey } from "./favourites";
import { useFileDrop } from "./fileDrop";
import type { LibraryAsset } from "./manifest";
import NameForm from "./NameForm";
import SoundPicker from "./SoundPicker";
import SoundRow from "./SoundRow";
import type { SoundsKeyAction } from "./soundKeys";
import { nextIn, previousIn, revealSelectedRow, tabStopId } from "./stepping";
import "./PackBanner.css";
import "./MyPacks.css";

/**
 * A personal pack, opened (GRV-52): its sounds in the library's main region,
 * the way an opened factory pack's sounds are, while the rail keeps the list
 * of packs. Every file dropped here imports into this pack and shows its own
 * row (its progress, then its sound, or why it failed), as it does dropped on
 * the pack's name in the rail. Each sound is the row every other pack's sounds
 * are (GRV-75): it auditions through the library, favourites, opens similar
 * sounds and drags onto the arrangement, and renames or deletes in place.
 * The library's keys reach it too (GRV-76): the arrows walk the pack's sounds,
 * auditioning each as it is selected, Space hears the selected one again and
 * S opens its similar sounds — exactly as they do in every other list.
 */
export interface MyPackFilesProps {
  readonly library: UserLibrary;
  readonly pack: UserPack;
  /** The sound being heard, which its row shows pressed. */
  readonly selectedId: string | null;
  /** The sound playing, whose row shows the stop mark, as in every other list. */
  readonly playingId?: string | null;
  /** Why a sound could not load, as the library's audition found it. */
  errorOf?(assetId: string): string | null;
  /** The slot's track colour: the selected row's waveform is drawn in it. */
  readonly trackColor?: string;
  /** The hearts' state and toggle. Unset leaves every heart disabled. */
  readonly favourites?: FavouriteMarks;
  /** Hear a sound, through the library's own audition. */
  onAudition(asset: LibraryAsset): void;
  /** Open similar sounds for a sound. */
  onSimilar(asset: LibraryAsset): void;
  /** Whether the open project uses a sound, so deleting it warns harder. */
  isInUse?(asset: LibraryAsset): boolean;
  /** Leave the pack for all sounds. */
  onClose(): void;
  /** Hands the modal this view's key handler, and takes it back when unmounted. */
  onKeys(handler: ((action: SoundsKeyAction) => void) | null): void;
}

function ImportRowView(props: { row: ImportRow; library: UserLibrary }): JSX.Element {
  return (
    <li
      class={["my-packs-import", `my-packs-import-${props.row.state}`]}
      data-state={props.row.state}
    >
      <span class={["my-packs-import-name", MASK_CONTENT]}>{props.row.fileName}</span>
      <Show
        when={props.row.state === "uploading"}
        fallback={
          <>
            <output class="my-packs-import-message">{props.row.message}</output>
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={() => props.library.dismissImport(props.row.id)}
            >
              <HiOutlineXMark size={13} />
            </button>
          </>
        }
      >
        <progress
          class="my-packs-progress"
          aria-label="Upload progress"
          max={1}
          value={props.row.progress}
        />
        <button
          type="button"
          class="my-packs-icon"
          aria-label="Cancel upload"
          title="Cancel upload"
          onClick={() => props.library.cancelImport(props.row.id)}
        >
          <HiOutlineXMark size={13} />
        </button>
      </Show>
    </li>
  );
}

function SoundItem(props: {
  asset: LibraryAsset;
  selected: boolean;
  /** Whether this row is the list's one Tab stop, its own controls included. */
  tabbable: boolean;
  playing: boolean;
  error: string | null;
  color?: string;
  favourite: boolean;
  onFavourite?: () => void;
  inUse: boolean;
  onAudition(): void;
  onSimilar(): void;
  onRename(name: string): void;
  onDelete(): void;
}): JSX.Element {
  const [confirming, setConfirming] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  // Held once: the row reads it three times, and a pack can hold 500 sounds,
  // so reading the list's shared Tab stop straight through would subscribe
  // every one of those reads to it.
  const tabbable = createMemo(() => props.tabbable);
  return (
    <Show
      when={confirming() || editing()}
      fallback={
        // The row every other pack's sounds use (GRV-75), with this sound's
        // own rename and delete slotted in left of the heart.
        <SoundRow
          asset={props.asset}
          selected={props.selected}
          playing={props.playing}
          error={props.error}
          color={props.color}
          // The arrows move between rows (GRV-76), so the list is one Tab stop.
          tabbable={tabbable()}
          favourite={props.favourite}
          onFavourite={props.onFavourite}
          onSelect={() => props.onAudition()}
          onSimilar={() => props.onSimilar()}
          actions={
            // Rename and delete belong to the row, so they share its Tab stop:
            // the arrows choose a sound, then Tab reaches that sound's controls.
            <>
              <button
                type="button"
                class="sound-row-icon"
                tabindex={tabbable() ? 0 : -1}
                aria-label="Rename sound"
                title="Rename sound"
                onClick={() => setEditing(true)}
              >
                <HiOutlinePencil size={14} />
              </button>
              <button
                type="button"
                class="sound-row-icon"
                tabindex={tabbable() ? 0 : -1}
                aria-label="Delete sound"
                title="Delete sound"
                onClick={() => setConfirming(true)}
              >
                <HiOutlineTrash size={14} />
              </button>
            </>
          }
        />
      }
    >
      <li class="my-packs-sound">
        <Show
          when={confirming()}
          fallback={
            <NameForm
              label="Sound name"
              value={props.asset.name}
              maxLength={MAX_SOUND_NAME_LENGTH}
              onCommit={(name) => {
                props.onRename(name);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          }
        >
          <div class="my-packs-confirm" role="alert">
            <p>
              {props.inUse
                ? "This project uses this sound. Deleting it leaves it missing here and in any other project that uses it."
                : "Delete this sound? Any project that uses it will report it missing."}
            </p>
            <div class="my-packs-confirm-actions">
              <button
                type="button"
                class="my-packs-danger"
                onClick={() => props.onDelete()}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </div>
          </div>
        </Show>
      </li>
    </Show>
  );
}

const keyOf = (asset: LibraryAsset): SoundKey => ({
  packId: asset.packId,
  assetId: asset.id,
});

export default function MyPackFiles(props: MyPackFilesProps): JSX.Element {
  const library = () => props.library;
  const assets = createMemo(() => userPackAssets(props.pack));
  const rows = createMemo(() =>
    library()
      .imports()
      .filter((row) => row.packId === props.pack.id),
  );
  const importHere = (files: File[], method: ImportMethod) =>
    void library().importFiles(props.pack.id, files, method);
  const drop = useFileDrop((files) => importHere(files, "drop"));
  let openPicker: (() => void) | undefined;
  const count = () =>
    props.pack.assets.length === 1 ? "1 sound" : `${props.pack.assets.length} sounds`;

  let list: HTMLUListElement | undefined;
  const current = () => assets().find((asset) => asset.id === props.selectedId) ?? null;
  // The list is one Tab stop (#880): the selected sound, or the first.
  const tabStop = createMemo(() =>
    tabStopId(
      assets().map((asset) => asset.id),
      props.selectedId,
    ),
  );

  // Set by a step, so the selection it makes takes focus with it (#880).
  let focusFollows = false;

  /** Select the neighbouring sound, which auditions it; the ends hold. */
  function step(direction: 1 | -1): void {
    const from = current();
    const target = (direction === 1 ? nextIn : previousIn)(assets(), from);
    if (!target) return;
    if (target === from) {
      // At an end there is nothing new to hear, but focus still joins the row.
      revealSelectedRow(list, true);
      return;
    }
    focusFollows = true;
    props.onAudition(target);
  }

  // The library's keys arrive from the modal, as they do for the Sounds list
  // (GRV-76). Only the ones a pack's own list can answer are here; the shelf,
  // genre and tempo keys belong to views that have those filters.
  function press(action: SoundsKeyAction): void {
    const sound = current();
    if (action === "library.select_next") step(1);
    else if (action === "library.select_previous") step(-1);
    else if (action === "library.audition" && sound) props.onAudition(sound);
    else if (action === "library.similar" && sound) props.onSimilar(sound);
  }

  onSettled(() => {
    props.onKeys(press);
    return () => props.onKeys(null);
  });

  // Keep the heard row on screen, and focused when a step chose it.
  createEffect(
    () => props.selectedId,
    () => {
      revealSelectedRow(list, focusFollows);
      focusFollows = false;
    },
  );

  return (
    <section
      class="my-pack-files"
      aria-label="Pack sounds"
      data-drop={drop.state()}
      onDragEnter={drop.handlers.onDragEnter}
      onDragOver={drop.handlers.onDragOver}
      onDragLeave={drop.handlers.onDragLeave}
      onDrop={drop.handlers.onDrop}
    >
      <div class="pack-banner">
        <div class="pack-banner-text">
          <h3 class={["pack-banner-name", MASK_CONTENT]}>{props.pack.name}</h3>
          <p>Your pack · {count()}. Drop audio files here to add them.</p>
        </div>
        <SoundPicker
          onOpener={(open) => {
            openPicker = open;
          }}
          onFiles={(files) => importHere(files, "picker")}
        />
        <button
          type="button"
          class="library-modal-ghost my-pack-files-add"
          title="Add sounds from your computer"
          onClick={() => openPicker?.()}
        >
          <HiOutlineArrowUpTray size={14} />
          <span>Add sounds</span>
        </button>
        <button
          type="button"
          class="pack-banner-close"
          aria-label="Back to all sounds"
          onClick={() => props.onClose()}
        >
          <HiSolidXMark size={15} />
        </button>
      </div>
      <Show when={drop.state() === "refused"}>
        <output class="my-packs-hint">Only audio files can go in a pack.</output>
      </Show>
      <ul class="sounds-list" aria-label="Sounds in this pack" ref={list}>
        <For each={assets()} keyed={(asset) => asset.id}>
          {(asset) => (
            <SoundItem
              asset={asset()}
              selected={props.selectedId === asset().id}
              tabbable={tabStop() === asset().id}
              playing={props.playingId === asset().id}
              error={props.errorOf?.(asset().id) ?? null}
              color={props.trackColor}
              favourite={props.favourites?.isFavourite(keyOf(asset())) ?? false}
              onFavourite={
                props.favourites && (() => props.favourites?.toggle(keyOf(asset())))
              }
              onSimilar={() => props.onSimilar(asset())}
              inUse={props.isInUse?.(asset()) ?? false}
              onAudition={() => props.onAudition(asset())}
              onRename={(name) =>
                void library().renameSound(props.pack.id, asset().id, name)
              }
              onDelete={() => void library().deleteSound(props.pack.id, asset().id)}
            />
          )}
        </For>
        <For each={rows()} keyed={(row) => row.id}>
          {(row) => <ImportRowView row={row()} library={library()} />}
        </For>
        <Show when={assets().length === 0 && rows().length === 0}>
          <li class="my-packs-empty">
            Nothing in this pack yet. Drop audio files here, or choose Add sounds.
          </li>
        </Show>
      </ul>
    </section>
  );
}
