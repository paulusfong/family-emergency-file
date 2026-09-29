/**
 * A save that fails after its editor has unmounted (the flush sent when the
 * person leaves the page) has no editor left to show the error. The editor
 * reports it here, and LostSaveNotice in the /app layout, which outlives the
 * editor across client navigation, shows it until dismissed.
 */
export type LostSave = { message: string; href: string | null };

let current: LostSave | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function reportLostSave(lost: LostSave) {
  current = lost;
  notify();
}

export function dismissLostSave() {
  current = null;
  notify();
}

export function getLostSave() {
  return current;
}

export function subscribeLostSave(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
