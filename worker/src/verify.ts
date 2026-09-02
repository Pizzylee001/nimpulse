import { blake2b } from '@noble/hashes/blake2.js'

/*
 * Server-side verification of Nimiq Pay wallet signatures.
 *
 * The browser library @nimiq/core cannot run inside a Cloudflare Worker:
 * its builds spin up web workers or worker_threads and fail in workerd
 * (verified during development). This module implements the same
 * verification with WebCrypto Ed25519 and @noble/hashes, following the
 * pattern proven in production by the nimquest mini app:
 *
 * 1. The signed payload is the Nimiq signed message envelope:
 *    "\x16Nimiq Signed Message:\n" + byteLength + message, hashed with
 *    SHA-256, then signed with Ed25519.
 * 2. The wallet address is derived from the public key:
 *    blake2b(publicKey) truncated to 20 bytes, base32 encoded with the
 *    Nimiq alphabet, prefixed with NQ and an IBAN-style mod-97 checksum.
 */

const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const WALLET_PATTERN = /^NQ[0-9]{2}(?:\s?[A-Z0-9]{4}){8}$/

export function normalizeWalletAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(/\s+/g, ' ').toUpperCase()
  return WALLET_PATTERN.test(normalized) ? normalized : null
}

export function compactWalletAddress(value: string): string {
  return value.replace(/\s+/g, '')
}

export function maskWalletAddress(value: string): string {
  const compact = compactWalletAddress(value)
  return `${compact.slice(0, 6)}…${compact.slice(-4)}`
}

export function buildPickMessage(questionId: number, side: string, wallet: string, expiresAt: string): string {
  return `NimPulse pick: ${questionId} ${side} ${wallet} ${expiresAt}`
}

export interface VerificationResult {
  ok: boolean
  walletAddress?: string
  error?: string
}

export async function verifyWalletSignature(params: {
  wallet: string
  publicKey: string
  signature: string
  message: string
}): Promise<VerificationResult> {
  const wallet = normalizeWalletAddress(params.wallet)
  if (!wallet) {
    return { ok: false, error: 'A valid Nimiq wallet address is required.' }
  }

  if (!isHex(params.publicKey, 64) || !isHex(params.signature, 128)) {
    return { ok: false, error: 'Public key or signature has an invalid format.' }
  }

  try {
    const publicKeyBytes = fromHex(params.publicKey)
    const derivedAddress = publicKeyToNimiqAddress(publicKeyBytes)

    if (compactWalletAddress(derivedAddress) !== compactWalletAddress(wallet)) {
      return { ok: false, error: 'Public key does not belong to this wallet.' }
    }

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      fromHex(params.signature),
      await crypto.subtle.digest('SHA-256', encodeNimiqSignedMessage(params.message)),
    )

    if (!valid) {
      return { ok: false, error: 'Wallet signature is invalid.' }
    }

    return { ok: true, walletAddress: wallet }
  }
  catch {
    return { ok: false, error: 'Wallet proof could not be verified.' }
  }
}

function encodeNimiqSignedMessage(message: string): Uint8Array {
  const messageBytes = new TextEncoder().encode(message)
  const prefixBytes = new TextEncoder().encode(
    `${SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}`,
  )
  const payload = new Uint8Array(prefixBytes.byteLength + messageBytes.byteLength)
  payload.set(prefixBytes)
  payload.set(messageBytes, prefixBytes.byteLength)
  return payload
}

function publicKeyToNimiqAddress(publicKeyBytes: Uint8Array): string {
  if (publicKeyBytes.length !== 32) {
    throw new TypeError('Nimiq public keys must contain 32 bytes.')
  }
  const addressBytes = blake2b(publicKeyBytes, { dkLen: 32 }).slice(0, 20)
  const base32 = encodeNimiqBase32(addressBytes)
  const checksum = 98 - ibanChecksum(`NQ00${base32}`)
  const compact = `NQ${String(checksum).padStart(2, '0')}${base32}`
  return compact.match(/.{1,4}/g)!.join(' ')
}

function encodeNimiqBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += NIMIQ_ALPHABET[(value >>> bits) & 31]
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0) {
    output += NIMIQ_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function ibanChecksum(iban: string): number {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
  let checksum = 0
  for (const character of rearranged) {
    const numeric = /[0-9]/.test(character)
      ? character
      : String(character.charCodeAt(0) - 55)
    for (const digit of numeric) {
      checksum = (checksum * 10 + Number(digit)) % 97
    }
  }
  return checksum
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g)!, byte => Number.parseInt(byte, 16))
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string'
    && value.length === length
    && /^[a-fA-F0-9]+$/.test(value)
}
