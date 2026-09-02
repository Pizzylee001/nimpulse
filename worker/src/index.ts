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
import type { Env, PlayerRow, Side } from './types'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    try {
      const response = await routeRequest(request, env, url)
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

async function routeRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return preflight(request)
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return handleHealth(env)
  }

  if (request.method === 'GET' && url.pathname === '/api/today') {
    return handleToday(env, url)
  }

  if (request.method === 'POST' && url.pathname === '/api/pick') {
    return handlePick(request, env)
  }

  if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
    return handleLeaderboard(env)
  }

  return json({ error: 'Route not found.' }, 404)
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

async function handleToday(env: Env, url: URL): Promise<Response> {
  const now = new Date()
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

async function findPick(env: Env, questionId: number, wallet: string): Promise<{ side: Side } | null> {
  return await env.DB.prepare(
    'SELECT side FROM picks WHERE question_id = ? AND wallet_address = ?',
  )
    .bind(questionId, wallet)
    .first<{ side: Side }>()
}

async function findPlayer(env: Env, wallet: string): Promise<PlayerRow | null> {
  return await env.DB.prepare('SELECT * FROM players WHERE wallet_address = ?')
    .bind(wallet)
    .first<PlayerRow>()
}
