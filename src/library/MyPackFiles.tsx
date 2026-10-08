import { For, type JSX, Show } from "@solidjs/web";
import {
  HiOutlineArrowUpTray,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineXMark,
  HiSolidXMark,
} from "solid-icons/hi";
import { createMemo, createSignal } from "solid-js";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import {
  MAX_SOUND_NAME_LENGTH,
  type UserPack,
  userPackAssets,
} from "../userLibrary/userPacks";
import type { ImportMethod, ImportRow, UserLibrary } from "../userLibrary/useUserLibrary";
import { writeLibrarySampleDrag } from "./assetDrag";
import { useFileDrop } from "./fileDrop";
import type { LibraryAsset } from "./manifest";
import NameForm from "./NameForm";
import SoundPicker from "./SoundPicker";
import { lengthLabel } from "./SoundRow";
import "./PackBanner.css";
import "./MyPacks.css";

/**
 * A personal pack, opened (GRV-52): its sounds in the library's main region,
 * the way an opened factory pack's sounds are, while the rail keeps the list
 * of packs. Every file dropped here imports into this pack and shows its own
 * row (its progress, then its sound, or why it failed), as it does dropped on
 * the pack's name in the rail. Each sound auditions through the library,
 * drags onto the arrangement, and renames or deletes in place.
 */
export interface MyPackFilesProps {
  readonly library: UserLibrary;
  readonly pack: UserPack;
  /** The sound being heard, which its row shows pressed. */
  readonly selectedId: string | null;
  /** Hear a sound, through the library's own audition. */
  onAudition(asset: LibraryAsset): void;
  /** Whether the open project uses a sound, so deleting it warns harder. */
  isInUse?(asset: LibraryAsset): boolean;
  /** Leave the pack for all sounds. */
  onClose(): void;
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
  inUse: boolean;
  onAudition(): void;
  onRename(name: string): void;
  onDelete(): void;
}): JSX.Element {
  const [confirming, setConfirming] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  return (
    <li
      class={[
        "my-packs-sound",
        { "my-packs-sound-selected": props.selected && !confirming() && !editing() },
      ]}
      draggable={editing() ? "false" : "true"}
      onDragStart={(event) => {
        if (!writeLibrarySampleDrag(event.dataTransfer, props.asset)) {
          event.preventDefault();
        }
      }}
    >
      <Show
        when={confirming()}
        fallback={
          <Show
            when={!editing()}
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
            <button
              type="button"
              class="my-packs-sound-main"
              aria-label={`Audition ${props.asset.name}`}
              aria-pressed={ariaBool(props.selected)}
              onClick={() => props.onAudition()}
            >
              <span class={["my-packs-sound-name", MASK_CONTENT]}>
                {props.asset.name}
              </span>
              <small>{lengthLabel(props.asset)}</small>
            </button>
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Rename sound"
              title="Rename sound"
              onClick={() => setEditing(true)}
            >
              <HiOutlinePencil size={13} />
            </button>
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Delete sound"
              title="Delete sound"
              onClick={() => setConfirming(true)}
            >
              <HiOutlineTrash size={13} />
            </button>
          </Show>
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
  );
}

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
      <ul class="my-packs-sounds my-pack-files-list" aria-label="Sounds in this pack">
        <For each={assets()} keyed={(asset) => asset.id}>
          {(asset) => (
            <SoundItem
              asset={asset()}
              selected={props.selectedId === asset().id}
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
