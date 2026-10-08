import type { JSX } from "@solidjs/web";
import { MASK_CONTENT } from "../monitoring/replayPrivacy";

/**
 * A personal pack's or sound's name being typed (#282): a form, so Return
 * submits it and nothing listens for keys itself (the shortcut registry owns
 * those). Leaving the field does not submit: clicking away keeps the name it
 * already has.
 */
export default function NameForm(props: {
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
