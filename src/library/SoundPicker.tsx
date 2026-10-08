import type { JSX } from "@solidjs/web";
import { IMPORT_EXTENSIONS } from "../userData/userData";

/**
 * The file picker behind "Add sounds" (#282): the same import as a drop, for
 * anyone who cannot drag. Hidden; `onOpener` hands over what opens it.
 */
export default function SoundPicker(props: {
  onOpener(open: () => void): void;
  onFiles(files: File[]): void;
}): JSX.Element {
  return (
    <input
      ref={(element) => {
        props.onOpener(() => {
          element.value = "";
          element.click();
        });
      }}
      type="file"
      class="my-packs-picker"
      aria-label="Choose sound files"
      tabindex={-1}
      hidden
      multiple
      accept={["audio/*", ...IMPORT_EXTENSIONS].join(",")}
      onChange={(event) => {
        const input = event.currentTarget;
        const files = Array.from(input.files ?? []);
        input.value = "";
        if (files.length > 0) props.onFiles(files);
      }}
    />
  );
}
