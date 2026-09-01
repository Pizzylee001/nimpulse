import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'

export type { NimiqProvider }

/** How long init() waits for Nimiq Pay to inject the provider. */
export const PROVIDER_INIT_TIMEOUT_MS = 10_000

/** How long a wallet action waits before the UI gives up. */
export const ACTION_TIMEOUT_MS = 60_000

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
  if (value.length <= head + tail + 1) {
    return value
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** Read the language Nimiq Pay injects, falling back to the device locale. */
export function detectLanguage(): { language: string, source: 'nimiqPay' | 'navigator' } {
  const hostLanguage = window.nimiqPay?.language
  if (hostLanguage) {
    return { language: hostLanguage, source: 'nimiqPay' }
  }
  return { language: navigator.language, source: 'navigator' }
}
