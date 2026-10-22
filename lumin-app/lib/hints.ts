// One-time hints: each id is shown until dismissed once on this device.
// Storage can throw or be empty (private windows, blocked site data), so
// every access is wrapped and a failure just means the hint shows again.
export type HintId = 'twin-step' | 'twin-ask' | 'twin-words' | 'circle-demo';

const key = (id: HintId) => `lumin:hint:${id}`;

export function hintSeen(id: HintId): boolean {
  try {
    return window.localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

export function markHintSeen(id: HintId): void {
  try {
    window.localStorage.setItem(key(id), '1');
  } catch {
    /* ignore */
  }
}
