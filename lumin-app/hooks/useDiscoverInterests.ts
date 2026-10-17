'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'lumin:discover-interests';

// undefined = still reading localStorage (or genuinely first-ever visit)
// null      = user skipped/cancelled — treat as "show everything"
// string[]  = the specific topic ids they picked
type StoredInterests = string[] | null | undefined;

export function useDiscoverInterests() {
  const [interests, setInterests] = useState<StoredInterests>(undefined);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return; // key was never set — genuinely first time
    try {
      setInterests(JSON.parse(raw));
    } catch {
      setInterests(null);
    }
  }, []);

  // Distinguishes "never answered" from "answered with skip" — JSON.parse
  // of a stored `null` is a real null, not the same as the key being
  // absent, so this only stays false before the very first choice is made.
  const hasOnboarded = interests !== undefined;

  const complete = (selected: string[] | null) => {
    setInterests(selected);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  };

  return { hasOnboarded, interests, complete };
}
