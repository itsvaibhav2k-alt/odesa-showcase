'use client';

import { useState, useCallback } from 'react';

type EditorPreference = 'quick' | 'full';

const STORAGE_KEY = 'knowledge-editor-preference';
const DEFAULT_PREFERENCE: EditorPreference = 'quick';

function readPreference(): EditorPreference {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'quick' || stored === 'full') return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_PREFERENCE;
}

export function useEditorPreference() {
  const [preference, setPreferenceState] = useState<EditorPreference>(
    readPreference,
  );

  const setPreference = useCallback((value: EditorPreference) => {
    setPreferenceState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // localStorage unavailable
    }
  }, []);

  return {
    preference,
    setPreference,
    isQuickAdd: preference === 'quick',
  } as const;
}
