import type { DrumPad } from "./entities";

/** The first "Pad N" no pad on the machine is already called. */
export function nextPadName(existing: readonly DrumPad[]): string {
  const taken = new Set(existing.map((pad) => pad.name));
  let n = existing.length + 1;
  while (taken.has(`Pad ${n}`)) n++;
  return `Pad ${n}`;
}

/** Whether a name is one {@link nextPadName} produced, rather than one a person typed. */
export function isAutoPadName(name: string): boolean {
  return /^Pad [1-9]\d*$/.test(name);
}
