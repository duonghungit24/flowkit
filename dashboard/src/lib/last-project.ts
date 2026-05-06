// Tracks the most recently opened project so the Library page knows
// which project to drop the user into when they click "Run in chat".
const KEY = 'flowkit-last-project'

export function getLastProjectId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLastProjectId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* localStorage unavailable — silently no-op */
  }
}

export function clearLastProjectId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
