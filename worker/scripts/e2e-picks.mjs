/*
 * Throwaway local validation script. Generates a real Ed25519 keypair,
 * derives its Nimiq address with the same scheme the worker uses, and
 * exercises the pick endpoints. Not part of the deployed worker.
 */
import { blake2b } from '@noble/hashes/blake2.js'

const API = process.env.API_BASE_URL || 'http://localhost:8787'

const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

function encodeNimiqSignedMessage(message) {
  const messageBytes = new TextEncoder().encode(message)
  const prefixBytes = new TextEncoder().encode(`${SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}`)
  const payload = new Uint8Array(prefixBytes.byteLength + messageBytes.byteLength)
  payload.set(prefixBytes)
  payload.set(messageBytes, prefixBytes.byteLength)
  return payload
}

function encodeNimiqBase32(bytes) {
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
  if (bits > 0) output += NIMIQ_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function ibanChecksum(iban) {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
  let checksum = 0
  for (const character of rearranged) {
    const numeric = /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55)
    for (const digit of numeric) checksum = (checksum * 10 + Number(digit)) % 97
  }
  return checksum
}

function publicKeyToNimiqAddress(publicKeyBytes) {
  const addressBytes = blake2b(publicKeyBytes, { dkLen: 32 }).slice(0, 20)
  const base32 = encodeNimiqBase32(addressBytes)
  const checksum = 98 - ibanChecksum(`NQ00${base32}`)
  return `NQ${String(checksum).padStart(2, '0')}${base32}`.match(/.{1,4}/g).join(' ')
}

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

async function makeWallet() {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const address = publicKeyToNimiqAddress(publicKey)
  const sign = async message => {
    const digest = await crypto.subtle.digest('SHA-256', encodeNimiqSignedMessage(message))
    return new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, digest))
  }
  return { address, publicKey, sign }
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function get(path) {
  const res = await fetch(`${API}${path}`)
  return { status: res.status, body: await res.json() }
}

const args = process.argv.slice(2)
const command = args[0] || 'picks'

if (command === 'picks') {
  const questionId = Number(args[1])
  if (!Number.isInteger(questionId)) throw new Error('Usage: e2e-picks.mjs picks <questionId>')

  const wallet = await makeWallet()
  const other = await makeWallet()
  const { body: todayBody } = await get(`/api/today?wallet=${encodeURIComponent(wallet.address)}`)
  const question = todayBody.today
  if (!question) throw new Error('No open question found')
  console.log('question:', question.id, question.asset, 'resolves', question.resolvesAt)
  console.log('wallet:', wallet.address)

  // The expiresAt override lets the test target a non-today question.
  const expiresAt = args[2] || question.resolvesAt
  const side = args[3] || 'yes'
  const message = `NimPulse pick: ${questionId} ${side} ${wallet.address} ${expiresAt}`

  // 1. Corrupted signature must be rejected.
  const goodSignature = await wallet.sign(message)
  const flipped = new Uint8Array(goodSignature)
  flipped[3] ^= 0xff
  const badSig = await post('/api/pick', {
    questionId, side, wallet: wallet.address, expiresAt,
    publicKey: toHex(wallet.publicKey), signature: toHex(flipped),
  })
  console.log('bad signature      =>', badSig.status, badSig.body.error)

  // 2. Signature from a different wallet than the claimed one must be rejected.
  const otherSignature = await other.sign(message)
  const wrongWallet = await post('/api/pick', {
    questionId, side, wallet: wallet.address, expiresAt,
    publicKey: toHex(other.publicKey), signature: toHex(otherSignature),
  })
  console.log('wrong key          =>', wrongWallet.status, wrongWallet.body.error)

  // 3. Stale expiry must be rejected.
  const stale = await post('/api/pick', {
    questionId, side: 'yes', wallet: wallet.address, expiresAt: '2000-01-01T00:00:00.000Z',
    publicKey: toHex(wallet.publicKey), signature: toHex(goodSignature),
  })
  console.log('stale expiry       =>', stale.status, stale.body.error)

  // 4. Valid pick must be accepted.
  const valid = await post('/api/pick', {
    questionId, side, wallet: wallet.address, expiresAt,
    publicKey: toHex(wallet.publicKey), signature: toHex(goodSignature),
  })
  console.log('valid pick         =>', valid.status, JSON.stringify(valid.body))

  // 5. Duplicate pick must be rejected.
  const duplicate = await post('/api/pick', {
    questionId, side, wallet: wallet.address, expiresAt,
    publicKey: toHex(wallet.publicKey), signature: toHex(await wallet.sign(message)),
  })
  console.log('duplicate pick     =>', duplicate.status, duplicate.body.error)

  // 6. State after picking.
  const after = await get(`/api/today?wallet=${encodeURIComponent(wallet.address)}`)
  console.log('today myPick       =>', JSON.stringify(after.body.today.myPick))
  console.log('me                 =>', JSON.stringify(after.body.me))

  // Save wallet for the resolution phase.
  console.log('WALLET=' + wallet.address)
}
else if (command === 'check') {
  const walletAddress = args[1]
  if (!walletAddress) throw new Error('Usage: e2e-picks.mjs check <walletAddress>')
  const after = await get(`/api/today?wallet=${encodeURIComponent(walletAddress)}`)
  console.log('today              =>', JSON.stringify(after.body.today))
  console.log('recent             =>', JSON.stringify(after.body.recent))
  console.log('me                 =>', JSON.stringify(after.body.me))
  const board = await get('/api/leaderboard')
  console.log('leaderboard        =>', JSON.stringify(board.body.leaderboard))
  const health = await get('/api/health')
  console.log('health             =>', JSON.stringify(health.body))
}
