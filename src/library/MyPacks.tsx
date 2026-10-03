import { For, type JSX, Show } from "@solidjs/web";
import {
  HiOutlineArrowUpTray,
  HiOutlinePencil,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineXMark,
} from "solid-icons/hi";
import { createMemo, createSignal, onCleanup } from "solid-js";
import UpgradeAccountPrompt from "../components/UpgradeAccountPrompt";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";
import { ariaBool } from "../shared/aria";
import { formatBytes, IMPORT_EXTENSIONS, importContentType } from "../userData/userData";
import {
  MAX_PACK_NAME_LENGTH,
  MAX_SOUND_NAME_LENGTH,
  type UserPack,
  userPackAssets,
} from "../userLibrary/userPacks";
import type { ImportMethod, ImportRow, UserLibrary } from "../userLibrary/useUserLibrary";
import { writeLibrarySampleDrag } from "./assetDrag";
import type { LibraryAsset } from "./manifest";
import { lengthLabel } from "./SoundRow";
import "./MyPacks.css";

/**
 * **My packs** (#282): the producer's own packs, in the library's rail above
 * the factory packs.
 *
 * "Add pack" makes one and puts its name in an input; Return keeps what was
 * typed, and clicking away keeps the name it already has. Renaming a pack or
 * one of its sounds is the same input. Audio files dragged from the
 * desktop import into the pack they are dropped on, or into "My Sounds" when
 * dropped on the space around the packs, and every file shows its own row —
 * its progress, then its sound, or why it failed. Opening a pack lists its
 * sounds, which audition through the library like any other. The file picker
 * ("Add sounds") is the same import for anyone who cannot drag.
 *
 * A guest sees the same controls, and using any of them offers the
 * upgrade-account path, since sounds are stored under an account.
 */
export interface MyPacksProps {
  readonly library: UserLibrary;
  /** The sound being heard, which its row shows pressed. */
  readonly selectedId: string | null;
  /** Whether the header search is narrowing the library: the list shows results then. */
  readonly searching: boolean;
  /** Hear a sound, through the library's own audition. */
  onAudition(asset: LibraryAsset): void;
  /** Whether the open project uses a sound, so deleting it warns harder. */
  isInUse?(asset: LibraryAsset): boolean;
}

/** Whether a drag carries files, and whether any of them is audio we take. */
function dragVerdict(event: DragEvent): "none" | "accepted" | "refused" {
  const transfer = event.dataTransfer;
  if (!transfer || !Array.from(transfer.types ?? []).includes("Files")) return "none";
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === "file");
  // Some browsers hide the types until the drop; give those the benefit of the doubt.
  if (items.length === 0 || items.every((item) => item.type === "")) return "accepted";
  return items.some((item) => importContentType({ name: "", type: item.type }) !== null)
    ? "accepted"
    : "refused";
}

/** How long a refused drop's "not audio" stays up after the files are let go. */
const REFUSED_DROP_MS = 2500;

/**
 * Handlers that make an element a drop target for audio files. `state` is
 * what the affordance shows: nothing, "drop here", or "not audio". A drop
 * with no audio in it at all is refused outright and imports nothing; one
 * with some audio imports every file, and each one we cannot take says why.
 */
function useFileDrop(onFiles: (files: File[]) => void) {
  const [state, setState] = createSignal<"none" | "accepted" | "refused">("none");
  let depth = 0;
  let refusedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(refusedTimer));
  const handlers = {
    onDragEnter(event: DragEvent) {
      const verdict = dragVerdict(event);
      if (verdict === "none") return;
      clearTimeout(refusedTimer);
      event.preventDefault();
      event.stopPropagation();
      depth += 1;
      setState(verdict);
    },
    onDragOver(event: DragEvent) {
      const verdict = dragVerdict(event);
      if (verdict === "none") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = verdict === "accepted" ? "copy" : "none";
      }
      setState(verdict);
    },
    onDragLeave(event: DragEvent) {
      if (dragVerdict(event) === "none") return;
      event.stopPropagation();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState("none");
    },
    onDrop(event: DragEvent) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      if (!files.some((file) => importContentType(file) !== null)) {
        setState("refused");
        clearTimeout(refusedTimer);
        refusedTimer = setTimeout(() => setState("none"), REFUSED_DROP_MS);
        return;
      }
      setState("none");
      onFiles(files);
    },
  };
  return { state, handlers };
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

/**
 * A name being typed: a form, so Return submits it and nothing listens for
 * keys itself (the shortcut registry owns those). Leaving the field does not
 * submit: clicking away keeps the name it already has.
 */
function NameForm(props: {
  label: string;
  value: string;
  maxLength: number;
  onCommit(name: string): void;
  onCancel(): void;
}): JSX.Element {
  let committed = false;
  return (
    <form
      class="my-packs-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("name");
        if (!(input instanceof HTMLInputElement)) return;
        committed = true;
        props.onCommit(input.value);
      }}
    >
      <input
        name="name"
        class={["my-packs-name-input", MASK_CONTENT]}
        aria-label={props.label}
        value={props.value}
        maxlength={props.maxLength}
        ref={(element) => {
          committed = false;
          queueMicrotask(() => {
            element.focus();
            element.select();
          });
        }}
        onBlur={() => {
          if (!committed) props.onCancel();
        }}
      />
    </form>
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

function PackItem(props: {
  pack: UserPack;
  open: boolean;
  editing: boolean;
  shared: MyPacksProps;
  onToggle(): void;
  onEdit(editing: boolean): void;
  onFiles(files: File[]): void;
  /** Open the file picker for this pack. */
  onPick(): void;
}): JSX.Element {
  const library = () => props.shared.library;
  const drop = useFileDrop((files) => props.onFiles(files));
  const [confirming, setConfirming] = createSignal(false);
  const assets = createMemo(() => userPackAssets(props.pack));
  const rows = createMemo(() =>
    library()
      .imports()
      .filter((row) => row.packId === props.pack.id),
  );
  function commit(name: string): void {
    void library().renamePack(props.pack.id, name);
    props.onEdit(false);
  }

  return (
    <li
      class="my-packs-pack"
      data-drop={drop.state()}
      onDragEnter={drop.handlers.onDragEnter}
      onDragOver={drop.handlers.onDragOver}
      onDragLeave={drop.handlers.onDragLeave}
      onDrop={drop.handlers.onDrop}
    >
      <div class="my-packs-pack-head">
        <Show
          when={props.editing}
          fallback={
            <button
              type="button"
              class="library-modal-rail-item my-packs-pack-name"
              aria-expanded={ariaBool(props.open)}
              onClick={() => props.onToggle()}
            >
              <span class={MASK_CONTENT}>{props.pack.name}</span>
              <small>{props.pack.assets.length}</small>
            </button>
          }
        >
          <NameForm
            label="Pack name"
            value={props.pack.name}
            maxLength={MAX_PACK_NAME_LENGTH}
            onCommit={commit}
            onCancel={() => props.onEdit(false)}
          />
        </Show>
        <Show when={!props.editing}>
          <span class="my-packs-pack-tools">
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Add sounds"
              title="Add sounds from your computer"
              onClick={() => props.onPick()}
            >
              <HiOutlineArrowUpTray size={13} />
            </button>
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Rename pack"
              title="Rename pack"
              onClick={() => props.onEdit(true)}
            >
              <HiOutlinePencil size={13} />
            </button>
            <button
              type="button"
              class="my-packs-icon"
              aria-label="Delete pack"
              title="Delete pack"
              onClick={() => setConfirming(true)}
            >
              <HiOutlineTrash size={13} />
            </button>
          </span>
        </Show>
      </div>
      <Show when={confirming()}>
        <div class="my-packs-confirm" role="alert">
          <p>
            {props.pack.assets.length === 0
              ? "Delete this empty pack?"
              : `Delete this pack and its ${props.pack.assets.length === 1 ? "sound" : `${props.pack.assets.length} sounds`}? Any project that uses them will report them missing.`}
          </p>
          <div class="my-packs-confirm-actions">
            <button
              type="button"
              class="my-packs-danger"
              onClick={() => void library().deletePack(props.pack.id)}
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      </Show>
      <Show when={drop.state() === "refused"}>
        <output class="my-packs-hint">Only audio files can go in a pack.</output>
      </Show>
      <Show when={(props.open && !props.shared.searching) || rows().length > 0}>
        <ul class="my-packs-sounds" aria-label="Sounds in this pack">
          <Show when={props.open && !props.shared.searching}>
            <For each={assets()} keyed={(asset) => asset.id}>
              {(asset) => (
                <SoundItem
                  asset={asset()}
                  selected={props.shared.selectedId === asset().id}
                  inUse={props.shared.isInUse?.(asset()) ?? false}
                  onAudition={() => props.shared.onAudition(asset())}
                  onRename={(name) =>
                    void library().renameSound(props.pack.id, asset().id, name)
                  }
                  onDelete={() => void library().deleteSound(props.pack.id, asset().id)}
                />
              )}
            </For>
            <Show when={assets().length === 0 && rows().length === 0}>
              <li class="my-packs-empty">Drop audio files here.</li>
            </Show>
          </Show>
          <For each={rows()} keyed={(row) => row.id}>
            {(row) => <ImportRowView row={row()} library={library()} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

export default function MyPacks(props: MyPacksProps): JSX.Element {
  const library = () => props.library;
  const [open, setOpen] = createSignal<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = createSignal<string | null>(null);

  function setPackOpen(packId: string, value: boolean): void {
    setOpen((current) => {
      const next = new Set(current);
      if (value) next.add(packId);
      else next.delete(packId);
      return next;
    });
  }

  function addPack(): void {
    const id = library().createPack("button");
    if (id) setEditing(id);
  }

  function importInto(packId: string | null, files: File[], method: ImportMethod): void {
    if (packId) setPackOpen(packId, true);
    void library().importFiles(packId, files, method);
  }

  // "Add sounds" on a pack opens the one file picker for that pack: the same
  // import as a drop, for anyone who cannot drag, and reported as the picker.
  let picker: HTMLInputElement | undefined;
  let pickingFor: string | null = null;
  function openPicker(packId: string): void {
    pickingFor = packId;
    if (picker) picker.value = "";
    picker?.click();
  }
  function picked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    const packId = pickingFor;
    pickingFor = null;
    input.value = "";
    if (packId && files.length > 0) importInto(packId, files, "picker");
  }

  // Files dropped beside the packs, not on one, make "My Sounds".
  const emptySpace = useFileDrop((files) => importInto(null, files, "drop"));
  const usageLine = createMemo(() => {
    const usage = library().usage();
    return `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.capBytes)} used`;
  });

  return (
    <section
      class="my-packs"
      aria-label="My packs"
      data-drop={emptySpace.state()}
      onDragEnter={emptySpace.handlers.onDragEnter}
      onDragOver={emptySpace.handlers.onDragOver}
      onDragLeave={emptySpace.handlers.onDragLeave}
      onDrop={emptySpace.handlers.onDrop}
    >
      <h3 class="library-modal-label library-modal-rule">My packs</h3>
      <input
        ref={(element) => {
          picker = element;
        }}
        type="file"
        class="my-packs-picker"
        aria-label="Choose sound files"
        tabindex={-1}
        hidden
        multiple
        accept={["audio/*", ...IMPORT_EXTENSIONS].join(",")}
        onChange={(event) => picked(event.currentTarget)}
      />
      <button
        type="button"
        class="library-modal-rail-item my-packs-add"
        // Until the packs have loaded there is nowhere to put a new one.
        disabled={library().status() === "loading"}
        onClick={addPack}
      >
        <HiOutlinePlus size={14} />
        <span>Add pack</span>
      </button>
      <Show when={library().upgradeAsked()}>
        <div class="my-packs-upgrade">
          <p>Your own sounds are kept in your account.</p>
          <UpgradeAccountPrompt />
        </div>
      </Show>
      <ul class="my-packs-list">
        {/* Keyed by ID: every snapshot brings new pack objects, and remounting
            a pack would drop a name half typed into it. */}
        <For each={library().packs()} keyed={(pack) => pack.id}>
          {(pack) => (
            <PackItem
              pack={pack()}
              open={open().has(pack().id)}
              editing={editing() === pack().id}
              shared={props}
              onToggle={() => setPackOpen(pack().id, !open().has(pack().id))}
              onEdit={(value) => setEditing(value ? pack().id : null)}
              onFiles={(files) => importInto(pack().id, files, "drop")}
              onPick={() => openPicker(pack().id)}
            />
          )}
        </For>
      </ul>
      <Show when={library().status() === "ready" || library().status() === "guest"}>
        <p class="my-packs-hint">
          {emptySpace.state() === "refused"
            ? "Only audio files can go in a pack."
            : "Drop audio files here to make a pack."}
        </p>
      </Show>
      <Show when={library().status() === "error"}>
        <p class="my-packs-hint" role="alert">
          Your packs couldn't load.
        </p>
      </Show>
      <Show when={library().status() === "ready" && library().packs().length > 0}>
        <p class="my-packs-usage">{usageLine()}</p>
      </Show>
      <Show when={library().notice()}>
        <output class="my-packs-notice">{library().notice()}</output>
      </Show>
    </section>
  );
}
