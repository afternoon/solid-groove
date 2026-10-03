/**
 * Makes everything outside the open modal `inert` (#876).
 *
 * A modal that only moves focus in on open still lets Tab, Shift+Tab and the
 * pointer reach whatever it covers, and a screen reader still reads it. One
 * `inert` attribute shuts all three off at once, so that is what this does
 * rather than intercepting Tab by hand.
 *
 * A modal renders where its surface renders, not at the top of the document,
 * so "everything else" is every sibling of the modal and of each of its
 * ancestors up to `<body>`. The ancestors themselves stay live: `inert`
 * inherits, and making one inert would take the modal with it.
 *
 * Modals stack. The newest one wins, so opening a second one over the first
 * makes the first inert too, and closing it hands the first one back. `inert`
 * comes off the app only when the last modal closes. A modal that closes out
 * of order just leaves the stack.
 *
 * Only elements this module made inert are restored: one that was already
 * inert for its own reasons stays that way.
 */

interface ModalEntry {
  readonly root: Element;
}

const stack: ModalEntry[] = [];
let applied: Element[] = [];

/** Every element outside `root` that has to go inert for `root` to be modal. */
function outside(root: Element): Element[] {
  const elements: Element[] = [];
  let node: Element | null = root;
  while (node?.parentElement && node !== document.body) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node) elements.push(sibling);
    }
    node = node.parentElement;
  }
  return elements;
}

function release(): void {
  for (const element of applied) element.removeAttribute("inert");
  applied = [];
}

function applyTop(): void {
  release();
  const top = stack.at(-1);
  if (!top) return;
  for (const element of outside(top.root)) {
    if (element.hasAttribute("inert")) continue;
    element.setAttribute("inert", "");
    applied.push(element);
  }
}

/**
 * Makes `root` the one interactive part of the document until the returned
 * function is called. Calling that function more than once is harmless.
 */
export function holdModal(root: Element): () => void {
  const entry: ModalEntry = { root };
  stack.push(entry);
  applyTop();
  return () => {
    const index = stack.indexOf(entry);
    if (index === -1) return;
    stack.splice(index, 1);
    applyTop();
  };
}
