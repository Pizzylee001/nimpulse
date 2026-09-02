/**
 * A safe, bounded client nonce for duel memos. Prefers crypto.randomUUID
 * and falls back to getRandomValues hex, which also works on plain HTTP
 * LAN origins where some secure-context APIs are unavailable.
 */
export function createMemoBase(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
