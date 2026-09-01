import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'

export type { NimiqProvider }

/** How long init() waits for Nimiq Pay to inject the provider. */
export const PROVIDER_INIT_TIMEOUT_MS = 10_000

/** How long a wallet action waits before the UI gives up. */
export const ACTION_TIMEOUT_MS = 60_000

/** How long the success pulse stays on a card. Matches --pulse-duration. */
export const PULSE_DURATION_MS = 400

/** Wait for Nimiq Pay to inject the Nimiq provider, then return it. */
export function initProvider(): Promise<NimiqProvider> {
  return init({ timeout: PROVIDER_INIT_TIMEOUT_MS })
}

/** Shape the Nimiq provider returns when the wallet reports an error. */
export interface ProviderErrorResponse {
  error: {
    type: string
    message: string
  }
}

export function isProviderErrorResponse(value: unknown): value is ProviderErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }
  const candidate = (value as ProviderErrorResponse).error
  return typeof candidate?.type === 'string' && typeof candidate?.message === 'string'
}

/**
 * Normalize every response shape the 0.1.0 SDK and the Nimiq Pay host
 * can produce:
 * - plain values (string[], SignatureResult, hash string), passed through
 * - JSON serialized payloads, parsed back into values
 * - { result: ... } envelopes, unwrapped
 * - { error: { type, message } } wrappers, thrown for the caller to map
 */
export function unwrapProviderResult<T>(raw: unknown): T {
  let value = raw
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        value = JSON.parse(trimmed)
      }
      catch {
        // Plain string result, for example a transaction hash.
        return value as T
      }
    }
    else {
      return value as T
    }
  }
  if (isProviderErrorResponse(value)) throw value
  if (typeof value === 'object' && value !== null && 'result' in value) {
    value = (value as { result: unknown }).result
    if (isProviderErrorResponse(value)) throw value
  }
  return value as T
}

/** Race a provider call against a timeout so the UI can never freeze. */
export async function withTimeout<T>(call: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })
  try {
    return await Promise.race([call, timeout])
  }
  finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

/** Map any provider failure to a short, human readable message. */
export function describeWalletError(error: unknown): string {
  if (isProviderErrorResponse(error)) {
    if (error.error.type.includes('PermissionDenied')) {
      return 'Request declined in Nimiq Pay.'
    }
    return `Nimiq Pay reported: ${error.error.message}`
  }
  if (error instanceof Error) {
    if (error.name.includes('PermissionDenied') || error.message.includes('PermissionDenied')) {
      return 'Request declined in Nimiq Pay.'
    }
    return error.message
  }
  return String(error)
}

/** Truncate a long string in the middle, keeping both ends readable. */
export function truncateMiddle(value: string, head = 11, tail = 4): string {
  const text = typeof value === 'string' ? value : String(value)
  if (text.length <= head + tail + 1) {
    return text
  }
  return `${text.slice(0, head)}…${text.slice(-tail)}`
}

/** Read the language Nimiq Pay injects, falling back to the device locale. */
export function detectLanguage(): { language: string, source: 'nimiqPay' | 'navigator' } {
  const hostLanguage = window.nimiqPay?.language
  if (hostLanguage) {
    return { language: hostLanguage, source: 'nimiqPay' }
  }
  return { language: navigator.language, source: 'navigator' }
}

/*
 * Foundation screen snapshot, kept in sessionStorage.
 * If the Nimiq Pay confirmation dialog ever causes the WebView to reload,
 * the boot counter increments and the cards restore their results instead
 * of silently resetting to Idle.
 */
const STATE_STORAGE_KEY = 'nimpulse:foundation'

export interface FoundationSnapshot {
  boots: number
  address: string | null
  publicKey: string | null
  signature: string | null
  hash: string | null
}

const EMPTY_SNAPSHOT: FoundationSnapshot = {
  boots: 0,
  address: null,
  publicKey: null,
  signature: null,
  hash: null,
}

export function loadFoundationSnapshot(): FoundationSnapshot {
  try {
    const raw = sessionStorage.getItem(STATE_STORAGE_KEY)
    if (!raw) return { ...EMPTY_SNAPSHOT }
    const parsed = JSON.parse(raw) as Partial<FoundationSnapshot>
    return {
      boots: typeof parsed.boots === 'number' ? parsed.boots : 0,
      address: typeof parsed.address === 'string' ? parsed.address : null,
      publicKey: typeof parsed.publicKey === 'string' ? parsed.publicKey : null,
      signature: typeof parsed.signature === 'string' ? parsed.signature : null,
      hash: typeof parsed.hash === 'string' ? parsed.hash : null,
    }
  }
  catch {
    return { ...EMPTY_SNAPSHOT }
  }
}

export function saveFoundationSnapshot(snapshot: FoundationSnapshot): void {
  try {
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(snapshot))
  }
  catch {
    // Storage unavailable, the screen still works without persistence.
  }
}
