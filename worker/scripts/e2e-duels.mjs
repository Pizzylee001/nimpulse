/*
 * Throwaway local/live validation script for the Phase 2b duel API.
 * Generates real Ed25519 keypairs, derives Nimiq addresses, and signs
 * the exact canonical messages the worker rebuilds.
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

function randomMemo() {
  return crypto.randomUUID()
}

async function pickSide(wallet, questionId, side, resolvesAt) {
  const message = `NimPulse pick: ${questionId} ${side} ${wallet.address} ${resolvesAt}`
  return await post('/api/pick', {
    questionId, side, wallet: wallet.address, expiresAt: resolvesAt,
    publicKey: toHex(wallet.publicKey), signature: toHex(await wallet.sign(message)),
  })
}

async function createDuel(wallet, questionId, side, resolvesAt, memoBase) {
  const message = `NimPulse duel create: ${questionId} ${side} ${wallet.address} ${memoBase} ${resolvesAt}`
  return await post('/api/duels', {
    questionId, side, wallet: wallet.address, memoBase,
    publicKey: toHex(wallet.publicKey), signature: toHex(await wallet.sign(message)),
  })
}

async function joinDuel(wallet, duelId, questionId, side, resolvesAt) {
  const message = `NimPulse duel join: ${duelId} ${questionId} ${side} ${wallet.address} ${resolvesAt}`
  return await post(`/api/duels/${duelId}/join`, {
    side, wallet: wallet.address,
    publicKey: toHex(wallet.publicKey), signature: toHex(await wallet.sign(message)),
  })
}

const args = process.argv.slice(2)
const command = args[0]

if (command === 'duelapi') {
  const questionId = Number(args[1])
  const resolvesAt = args[2]
  if (!Number.isInteger(questionId) || !resolvesAt) throw new Error('Usage: e2e-duels.mjs duelapi <questionId> <resolvesAt>')

  const creator = await makeWallet()
  const opponent = await makeWallet()
  const stranger = await makeWallet()
  console.log('creator :', creator.address)
  console.log('opponent:', opponent.address)
  console.log('stranger:', stranger.address)

  // Creator locks a daily YES pick first.
  const pick = await pickSide(creator, questionId, 'yes', resolvesAt)
  console.log('creator pick       =>', pick.status)

  // 1. Invalid creator signature rejected.
  const goodMessage = `NimPulse duel create: ${questionId} yes ${creator.address} test-memo-1 ${resolvesAt}`
  const goodSig = await creator.sign(goodMessage)
  const flipped = new Uint8Array(goodSig)
  flipped[5] ^= 0xff
  const bad = await post('/api/duels', {
    questionId, side: 'yes', wallet: creator.address, memoBase: 'test-memo-1',
    publicKey: toHex(creator.publicKey), signature: toHex(flipped),
  })
  console.log('bad signature      =>', bad.status, bad.body.error)

  // 2. Create without a daily pick rejected.
  const noPick = await createDuel(stranger, questionId, 'yes', resolvesAt, 'test-memo-2')
  console.log('no daily pick      =>', noPick.status, noPick.body.error)

  // 3. Duel side must match the picked side.
  const wrongSide = await createDuel(creator, questionId, 'no', resolvesAt, 'test-memo-3')
  console.log('wrong side         =>', wrongSide.status, wrongSide.body.error)

  // 4. Valid creation.
  const memoBase = randomMemo()
  const created = await createDuel(creator, questionId, 'yes', resolvesAt, memoBase)
  console.log('valid create       =>', created.status, JSON.stringify(created.body.duel ? { id: created.body.duel.id, status: created.body.duel.status, role: created.body.duel.role } : created.body))
  const duelId = created.body.duel.id

  // 5. Same memo base is idempotent.
  const resubmit = await createDuel(creator, questionId, 'yes', resolvesAt, memoBase)
  console.log('same memo resubmit =>', resubmit.status, 'id:', resubmit.body.duel.id)

  // 6. GET as creator / stranger.
  const asCreator = await get(`/api/duels/${duelId}?wallet=${encodeURIComponent(creator.address)}`)
  console.log('GET as creator     =>', asCreator.status, JSON.stringify({ role: asCreator.body.role, mySide: asCreator.body.mySide, status: asCreator.body.status }))
  const asStranger = await get(`/api/duels/${duelId}?wallet=${encodeURIComponent(stranger.address)}`)
  console.log('GET as stranger    =>', asStranger.status, JSON.stringify({ role: asStranger.body.role, mySide: asStranger.body.mySide }))

  // 7. Self-join rejected.
  const selfJoin = await joinDuel(creator, duelId, questionId, 'no', resolvesAt)
  console.log('self join          =>', selfJoin.status, selfJoin.body.error)

  // 8. Same-side join rejected.
  const sameSide = await joinDuel(opponent, duelId, questionId, 'yes', resolvesAt)
  console.log('same side join     =>', sameSide.status, sameSide.body.error)

  // 9. Bad join signature rejected.
  const joinMessage = `NimPulse duel join: ${duelId} ${questionId} no ${opponent.address} ${resolvesAt}`
  const joinSig = new Uint8Array(await opponent.sign(joinMessage))
  joinSig[9] ^= 0xff
  const badJoin = await post(`/api/duels/${duelId}/join`, {
    side: 'no', wallet: opponent.address,
    publicKey: toHex(opponent.publicKey), signature: toHex(joinSig),
  })
  console.log('bad join signature =>', badJoin.status, badJoin.body.error)

  // 10. Valid join with the opposite side.
  const joined = await joinDuel(opponent, duelId, questionId, 'no', resolvesAt)
  console.log('valid join         =>', joined.status, JSON.stringify({ status: joined.body.duel.status, role: joined.body.duel.role, mySide: joined.body.duel.mySide, opponent: joined.body.duel.opponent }))

  // 11. Duplicate join rejected.
  const dupJoin = await joinDuel(opponent, duelId, questionId, 'no', resolvesAt)
  console.log('duplicate join     =>', dupJoin.status, dupJoin.body.error)

  // 12. Third wallet cannot join a locked duel.
  const lateJoin = await joinDuel(stranger, duelId, questionId, 'no', resolvesAt)
  console.log('join locked duel   =>', lateJoin.status, lateJoin.body.error)

  // 13. GET as opponent and as anonymous spectator.
  const asOpponent = await get(`/api/duels/${duelId}?wallet=${encodeURIComponent(opponent.address)}`)
  console.log('GET as opponent    =>', asOpponent.status, JSON.stringify({ role: asOpponent.body.role, mySide: asOpponent.body.mySide, status: asOpponent.body.status }))
  const anonymous = await get(`/api/duels/${duelId}`)
  console.log('GET anonymous      =>', anonymous.status, JSON.stringify({ role: anonymous.body.role, creator: anonymous.body.creator, opponent: anonymous.body.opponent }))

  console.log('DUEL_ID=' + duelId)
  console.log('CREATOR=' + creator.address)
  console.log('OPPONENT=' + opponent.address)
}
else if (command === 'short') {
  // Create two duels on a shortened question: one stays open, one gets joined.
  const questionId = Number(args[1])
  const resolvesAt = args[2]
  if (!Number.isInteger(questionId) || !resolvesAt) throw new Error('Usage: e2e-duels.mjs short <questionId> <resolvesAt>')

  const creator = await makeWallet()
  const opponent = await makeWallet()
  console.log('creator :', creator.address)
  console.log('opponent:', opponent.address)

  const pickA = await pickSide(creator, questionId, 'yes', resolvesAt)
  const pickB = await pickSide(opponent, questionId, 'no', resolvesAt)
  console.log('picks              =>', pickA.status, pickB.status)

  const openDuel = await createDuel(creator, questionId, 'yes', resolvesAt, randomMemo())
  console.log('open duel          =>', openDuel.status, 'id:', openDuel.body.duel.id)

  const lockedDuel = await createDuel(creator, questionId, 'yes', resolvesAt, randomMemo())
  console.log('second duel        =>', lockedDuel.status, 'id:', lockedDuel.body.duel.id)
  const joined = await joinDuel(opponent, lockedDuel.body.duel.id, questionId, 'no', resolvesAt)
  console.log('joined second      =>', joined.status, joined.body.duel.status)

  console.log('OPEN_DUEL=' + openDuel.body.duel.id)
  console.log('LOCKED_DUEL=' + lockedDuel.body.duel.id)
}
else if (command === 'check') {
  const openId = Number(args[1])
  const lockedId = Number(args[2])
  const creator = args[3]
  const opponent = args[4]
  if (!openId || !lockedId || !creator || !opponent) throw new Error('Usage: e2e-duels.mjs check <openId> <lockedId> <creator> <opponent>')

  const open = await get(`/api/duels/${openId}`)
  console.log('open duel now      =>', JSON.stringify({ status: open.body.status, winnerRole: open.body.winnerRole }))
  const locked = await get(`/api/duels/${lockedId}?wallet=${encodeURIComponent(creator)}`)
  console.log('locked duel now    =>', JSON.stringify({ status: locked.body.status, winnerRole: locked.body.winnerRole, role: locked.body.role, outcome: locked.body.question.outcome }))
  const asOpponent = await get(`/api/duels/${lockedId}?wallet=${encodeURIComponent(opponent)}`)
  console.log('as opponent        =>', JSON.stringify({ role: asOpponent.body.role, mySide: asOpponent.body.mySide }))
}
else {
  throw new Error('Unknown command: ' + command)
}
