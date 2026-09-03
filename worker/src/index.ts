import { json, preflight, readJson, withCors } from './http'
import { buildPickMessage, maskWalletAddress, normalizeWalletAddress, verifyWalletSignature } from './verify'
import {
  countQuestions,
  ensureQuestions,
  findMostRecentResolved,
  findOpenQuestion,
  findQuestionById,
  lastResolutionTime,
} from './questions'
import { resolveDueQuestions } from './resolve'
import {
  buildDuelCreateMessage,
  buildDuelJoinMessage,
  buildDuelState,
  findDuelByMemoBase,
  findDuelById,
  findPickSide,
  listDuelsForWallet,
  MEMO_BASE_PATTERN,
} from './duels'
import { findPlayer, findPick } from './projections'
import type { Env, PlayerRow, Side } from './types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    try {
      const response = await routeRequest(request, env, url, ctx)
      return withCors(response, request)
    }
    catch (error) {
      console.error(JSON.stringify({
        event: 'request_error',
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }))
      return json({ error: 'Unexpected server error.' }, 500)
    }
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const now = new Date()
    if (event.cron === '5 0 * * *') {
      await ensureQuestions(env, now)
      console.log(JSON.stringify({ event: 'question_generation', at: now.toISOString() }))
      return
    }
    // 00:10 UTC resolution pass. Question generation runs as a safety
    // net too; it is idempotent.
    await ensureQuestions(env, now)
    const result = await resolveDueQuestions(env, now)
    console.log(JSON.stringify({ event: 'resolution_pass', at: now.toISOString(), ...result }))
  },
}

async function routeRequest(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return preflight(request)
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return handleHealth(env)
  }

  if (request.method === 'GET' && url.pathname === '/api/today') {
    return handleToday(env, url, ctx)
  }

  if (request.method === 'POST' && url.pathname === '/api/pick') {
    return handlePick(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
    return handleLeaderboard(env)
  }

  if (request.method === 'GET' && url.pathname === '/api/duels') {
    return handleListDuels(env, url, ctx)
  }

  if (request.method === 'POST' && url.pathname === '/api/duels') {
    return handleCreateDuel(request, env)
  }

  const duelMatch = url.pathname.match(/^\/api\/duels\/(\d+)$/)
  if (request.method === 'GET' && duelMatch) {
    return handleGetDuel(env, Number(duelMatch[1]), url, ctx)
  }

  const duelJoinMatch = url.pathname.match(/^\/api\/duels\/(\d+)\/join$/)
  if (request.method === 'POST' && duelJoinMatch) {
    return handleJoinDuel(request, env, Number(duelJoinMatch[1]))
  }

  const predictionMatch = url.pathname.match(/^\/api\/predictions\/(\d+)$/)
  if (request.method === 'GET' && predictionMatch) {
    return handlePrediction(env, Number(predictionMatch[1]), url, ctx)
  }

  return json({ error: 'Route not found.' }, 404)
}

async function handleListDuels(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const wallet = normalizeWalletAddress(url.searchParams.get('wallet'))
  if (!wallet) {
    return json({ error: 'A valid wallet address is required.' }, 400)
  }
  const now = new Date()
  // Same self-healing sweep as the single-duel read, so stale statuses
  // are repaired from real price data before listing.
  await maybeSweepResolution(env, ctx, now)
  const duels = await listDuelsForWallet(env, wallet, now)
  return json({ duels })
}

async function handlePrediction(env: Env, predictionId: number, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (!Number.isInteger(predictionId) || predictionId < 1) {
    return json({ error: 'A valid prediction id is required.' }, 400)
  }
  const now = new Date()
  await maybeSweepResolution(env, ctx, now)
  const question = await findQuestionById(env, predictionId)
  if (!question) {
    return json({ error: 'Prediction not found.' }, 404)
  }

  const wallet = normalizeWalletAddress(url.searchParams.get('wallet'))
  const [pick, player] = wallet
    ? await Promise.all([
        findPick(env, question.id, wallet),
        findPlayer(env, wallet),
      ])
    : [null, null]

  return json({
    prediction: {
      id: question.id,
      asset: question.asset,
      question: question.question,
      opensAt: question.opens_at,
      resolvesAt: question.resolves_at,
      outcome: question.outcome,
      openPrice: question.open_price,
      closePrice: question.close_price,
      priceSource: question.price_source,
      myPick: pick ? pick.side : null,
      correct: pick && question.outcome !== null ? pick.side === question.outcome : null,
      secondsRemaining: Math.max(0, Math.floor((new Date(question.resolves_at).getTime() - now.getTime()) / 1000)),
    },
    me: player
      ? {
          currentStreak: player.current_streak,
          bestStreak: player.best_streak,
          totalCorrect: player.total_correct,
          totalPicks: player.total_picks,
        }
      : null,
  })
}

async function handleHealth(env: Env): Promise<Response> {
  const [questions, lastResolutionAt] = await Promise.all([
    countQuestions(env),
    lastResolutionTime(env),
  ])
  return json({
    ok: true,
    service: 'nimpulse-api',
    questions,
    lastResolutionAt,
    now: new Date().toISOString(),
  })
}

/**
 * Self-healing resolution fallback. The cron stays the primary resolver,
 * but if a question is past its resolve time and still unresolved (for
 * example a transient CoinGecko failure flagged needs_retry), a normal
 * page load sweeps it in the background. Real CoinGecko prices only.
 */
async function maybeSweepResolution(env: Env, ctx: ExecutionContext, now: Date): Promise<void> {
  const due = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM questions WHERE resolves_at <= ? AND outcome IS NULL',
  )
    .bind(now.toISOString())
    .first<{ count: number }>()
  if (Number(due?.count ?? 0) === 0) return
  ctx.waitUntil(
    resolveDueQuestions(env, now).catch(error => {
      console.error(JSON.stringify({
        event: 'sweep_resolution_error',
        error: error instanceof Error ? error.message : String(error),
      }))
    }),
  )
}

async function handleToday(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const now = new Date()
  await maybeSweepResolution(env, ctx, now)
  let open = await findOpenQuestion(env, now)
  if (!open) {
    // First run after deploy: seed today's and tomorrow's question.
    await ensureQuestions(env, now)
    open = await findOpenQuestion(env, now)
  }
  const recent = await findMostRecentResolved(env, now)

  const wallet = normalizeWalletAddress(url.searchParams.get('wallet'))
  const [todayPick, recentPick, me] = wallet
    ? await Promise.all([
        open ? findPick(env, open.id, wallet) : null,
        recent ? findPick(env, recent.id, wallet) : null,
        findPlayer(env, wallet),
      ])
    : [null, null, null]

  return json({
    today: open
      ? {
          id: open.id,
          asset: open.asset,
          question: open.question,
          opensAt: open.opens_at,
          resolvesAt: open.resolves_at,
          secondsRemaining: Math.max(0, Math.floor((new Date(open.resolves_at).getTime() - now.getTime()) / 1000)),
          myPick: todayPick ? { side: todayPick.side } : null,
        }
      : null,
    recent: recent
      ? {
          id: recent.id,
          asset: recent.asset,
          question: recent.question,
          resolvesAt: recent.resolves_at,
          outcome: recent.outcome,
          openPrice: recent.open_price,
          closePrice: recent.close_price,
          myPick: recentPick
            ? { side: recentPick.side, correct: recentPick.side === recent.outcome }
            : null,
        }
      : null,
    me: me
      ? {
          currentStreak: me.current_streak,
          bestStreak: me.best_streak,
          totalCorrect: me.total_correct,
          totalPicks: me.total_picks,
        }
      : null,
  })
}

async function handlePick(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)

  const questionId = body.questionId
  const side = body.side
  const wallet = body.wallet
  const expiresAt = body.expiresAt
  const publicKey = body.publicKey
  const signature = body.signature

  if (!Number.isInteger(questionId) || (questionId as number) < 1) {
    return json({ error: 'A valid question id is required.' }, 400)
  }
  if (side !== 'yes' && side !== 'no') {
    return json({ error: 'Side must be yes or no.' }, 400)
  }
  if (typeof wallet !== 'string' || typeof expiresAt !== 'string') {
    return json({ error: 'Wallet and expiry are required.' }, 400)
  }
  if (typeof publicKey !== 'string' || typeof signature !== 'string') {
    return json({ error: 'Public key and signature are required.' }, 400)
  }

  const question = await findQuestionById(env, questionId as number)
  if (!question) {
    return json({ error: 'Question not found.' }, 404)
  }

  const now = new Date()
  if (now.toISOString() < question.opens_at) {
    return json({ error: 'Question is not open yet.' }, 400)
  }
  if (now.toISOString() >= question.resolves_at) {
    return json({ error: 'Question is closed for picks.' }, 400)
  }
  if (expiresAt !== question.resolves_at) {
    return json({ error: 'Expiry does not match the question.' }, 400)
  }

  // The canonical message is rebuilt from the stored question. The wallet
  // string is used exactly as the client signed it.
  const message = buildPickMessage(question.id, side as Side, wallet, question.resolves_at)
  const proof = await verifyWalletSignature({ wallet, publicKey, signature, message })
  if (!proof.ok || !proof.walletAddress) {
    return json({ error: proof.error }, 401)
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO picks (question_id, wallet_address, side, signature, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(question.id, proof.walletAddress, side, signature.toLowerCase(), now.toISOString()),
      env.DB.prepare(
        `INSERT INTO players (wallet_address, total_picks) VALUES (?, 1)
         ON CONFLICT(wallet_address) DO UPDATE SET total_picks = total_picks + 1`,
      ).bind(proof.walletAddress),
    ])
  }
  catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    if (messageText.includes('UNIQUE constraint failed')) {
      return json({ error: 'This wallet already picked this question.' }, 409)
    }
    throw error
  }

  return json({
    ok: true,
    pick: { questionId: question.id, side, createdAt: now.toISOString() },
  }, 201)
}

async function handleLeaderboard(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT * FROM players
     WHERE total_picks > 0
     ORDER BY best_streak DESC, settled_wins DESC, total_correct DESC, wallet_address ASC
     LIMIT 20`,
  ).all<PlayerRow>()

  return json({
    leaderboard: result.results.map((player, index) => ({
      rank: index + 1,
      wallet: maskWalletAddress(player.wallet_address),
      currentStreak: player.current_streak,
      bestStreak: player.best_streak,
      totalCorrect: player.total_correct,
      totalPicks: player.total_picks,
      settledWins: player.settled_wins,
      settledLosses: player.settled_losses,
    })),
  })
}

async function handleGetDuel(env: Env, duelId: number, url: URL, ctx: ExecutionContext): Promise<Response> {
  if (!Number.isInteger(duelId) || duelId < 1) {
    return json({ error: 'A valid duel id is required.' }, 400)
  }
  await maybeSweepResolution(env, ctx, new Date())
  const duel = await findDuelById(env, duelId)
  if (!duel) {
    return json({ error: 'Duel not found.' }, 404)
  }
  const question = await findQuestionById(env, duel.question_id)
  if (!question) {
    return json({ error: 'Duel question not found.' }, 404)
  }
  const wallet = normalizeWalletAddress(url.searchParams.get('wallet'))
  return json(buildDuelState(duel, question, wallet, new Date()))
}

async function handleCreateDuel(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)

  const questionId = body.questionId
  const side = body.side
  const walletRaw = body.wallet
  const memoBase = body.memoBase
  const publicKey = body.publicKey
  const signature = body.signature

  if (!Number.isInteger(questionId) || (questionId as number) < 1) {
    return json({ error: 'A valid question id is required.' }, 400)
  }
  if (side !== 'yes' && side !== 'no') {
    return json({ error: 'Side must be yes or no.' }, 400)
  }
  if (typeof walletRaw !== 'string') {
    return json({ error: 'A valid wallet address is required.' }, 400)
  }
  if (typeof memoBase !== 'string' || !MEMO_BASE_PATTERN.test(memoBase)) {
    return json({ error: 'A valid memo base is required.' }, 400)
  }
  if (typeof publicKey !== 'string' || typeof signature !== 'string') {
    return json({ error: 'Public key and signature are required.' }, 400)
  }

  const wallet = normalizeWalletAddress(walletRaw)
  if (!wallet) {
    return json({ error: 'A valid Nimiq wallet address is required.' }, 400)
  }

  const question = await findQuestionById(env, questionId as number)
  if (!question) {
    return json({ error: 'Question not found.' }, 404)
  }

  const now = new Date()
  if (now.toISOString() < question.opens_at) {
    return json({ error: 'Question is not open yet.' }, 400)
  }
  if (now.toISOString() >= question.resolves_at) {
    return json({ error: 'Question is closed for duels.' }, 400)
  }

  // A duel is fought with the creator's locked daily side.
  const pickedSide = await findPickSide(env, question.id, wallet)
  if (pickedSide === null) {
    return json({ error: 'Pick your daily side before creating a duel.' }, 400)
  }
  if (pickedSide !== side) {
    return json({ error: 'You can only duel with your picked side.' }, 400)
  }

  // The canonical message is rebuilt from stored values only.
  const message = buildDuelCreateMessage(question.id, side as Side, wallet, memoBase, question.resolves_at)
  const proof = await verifyWalletSignature({ wallet, publicKey, signature, message })
  if (!proof.ok || !proof.walletAddress) {
    return json({ error: proof.error }, 401)
  }

  // Idempotent resubmission: the same memo base returns the same duel.
  const existing = await findDuelByMemoBase(env, memoBase)
  if (existing) {
    if (existing.creator_wallet !== proof.walletAddress) {
      return json({ error: 'This memo base is already used.' }, 409)
    }
    const existingQuestion = await findQuestionById(env, existing.question_id)
    if (existingQuestion) {
      return json({ ok: true, duel: buildDuelState(existing, existingQuestion, proof.walletAddress, now) })
    }
  }

  const createdAt = now.toISOString()
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO duels (question_id, creator_wallet, creator_side, stake_luna, status,
                            opponent_wallet, opponent_side, winner_wallet, memo_base, created_at, resolved_at)
         VALUES (?, ?, ?, 0, 'open', NULL, NULL, NULL, ?, ?, NULL)`,
      ).bind(question.id, proof.walletAddress, side, memoBase, createdAt),
      env.DB.prepare(
        `INSERT INTO duel_proofs (duel_id, wallet_address, role, side, public_key, signature, created_at)
         SELECT id, ?, 'creator', ?, ?, ?, ?
         FROM duels WHERE memo_base = ?`,
      ).bind(proof.walletAddress, side, publicKey.toLowerCase(), signature.toLowerCase(), createdAt, memoBase),
    ])
  }
  catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    if (messageText.includes('UNIQUE constraint failed')) {
      return json({ error: 'This memo base is already used.' }, 409)
    }
    throw error
  }

  const duel = await findDuelByMemoBase(env, memoBase)
  if (!duel) {
    throw new Error('Duel was not persisted.')
  }
  return json({ ok: true, duel: buildDuelState(duel, question, proof.walletAddress, now) }, 201)
}

async function handleJoinDuel(request: Request, env: Env, duelId: number): Promise<Response> {
  if (!Number.isInteger(duelId) || duelId < 1) {
    return json({ error: 'A valid duel id is required.' }, 400)
  }

  const body = await readJson(request)
  const side = body.side
  const walletRaw = body.wallet
  const publicKey = body.publicKey
  const signature = body.signature

  if (side !== 'yes' && side !== 'no') {
    return json({ error: 'Side must be yes or no.' }, 400)
  }
  if (typeof walletRaw !== 'string') {
    return json({ error: 'A valid wallet address is required.' }, 400)
  }
  if (typeof publicKey !== 'string' || typeof signature !== 'string') {
    return json({ error: 'Public key and signature are required.' }, 400)
  }

  const wallet = normalizeWalletAddress(walletRaw)
  if (!wallet) {
    return json({ error: 'A valid Nimiq wallet address is required.' }, 400)
  }

  const duel = await findDuelById(env, duelId)
  if (!duel) {
    return json({ error: 'Duel not found.' }, 404)
  }

  const question = await findQuestionById(env, duel.question_id)
  if (!question) {
    return json({ error: 'Duel question not found.' }, 404)
  }

  const now = new Date()
  if (duel.opponent_wallet !== null) {
    return json({ error: 'This duel already has an opponent.' }, 409)
  }
  if (question.outcome !== null || now.toISOString() >= question.resolves_at) {
    return json({ error: 'This duel is closed for joins.' }, 400)
  }
  if (duel.creator_wallet === wallet) {
    return json({ error: 'You cannot join your own duel.' }, 400)
  }

  const opposite: Side = duel.creator_side === 'yes' ? 'no' : 'yes'
  if (side !== opposite) {
    return json({ error: 'You must take the opposite side.' }, 400)
  }

  // The canonical message is rebuilt from stored values only.
  const message = buildDuelJoinMessage(duel.id, question.id, side, wallet, question.resolves_at)
  const proof = await verifyWalletSignature({ wallet, publicKey, signature, message })
  if (!proof.ok || !proof.walletAddress) {
    return json({ error: proof.error }, 401)
  }

  const createdAt = now.toISOString()
  let changes = 0
  try {
    // Both statements are guarded by the same condition inside one atomic
    // batch, so a duplicate or racing join cannot partially modify the duel.
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO duel_proofs (duel_id, wallet_address, role, side, public_key, signature, created_at)
         SELECT ?1, ?2, 'opponent', ?3, ?4, ?5, ?6
         WHERE EXISTS (SELECT 1 FROM duels WHERE id = ?1 AND status = 'open' AND opponent_wallet IS NULL)`,
      ).bind(duel.id, proof.walletAddress, side, publicKey.toLowerCase(), signature.toLowerCase(), createdAt),
      env.DB.prepare(
        `UPDATE duels SET opponent_wallet = ?, opponent_side = ?, status = 'locked'
         WHERE id = ? AND status = 'open' AND opponent_wallet IS NULL`,
      ).bind(proof.walletAddress, side, duel.id),
    ])
    changes = Number(results[1].meta.changes ?? 0)
  }
  catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    if (messageText.includes('UNIQUE constraint failed')) {
      return json({ error: 'You already joined this duel.' }, 409)
    }
    throw error
  }

  if (changes !== 1) {
    return json({ error: 'This duel already has an opponent.' }, 409)
  }

  const updated = await findDuelById(env, duelId)
  if (!updated) {
    throw new Error('Duel was not persisted.')
  }
  return json({ ok: true, duel: buildDuelState(updated, question, proof.walletAddress, now) }, 201)
}
