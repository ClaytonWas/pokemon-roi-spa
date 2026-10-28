// Per-viewer settings in localStorage. Every access is wrapped: storage can
// be unavailable (private mode, blocked site data) and the app must still work.

const KEY = 'pokeroi.settings.v1';

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the in-memory value still applies for this page view.
  }
  return next;
}
