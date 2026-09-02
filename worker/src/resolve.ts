import type { Env, QuestionRow, Side } from './types'

/*
 * Resolution. For each question past its resolve time, fetch the open
 * and close USD prices from CoinGecko's public history endpoint
 * (snapshots at 00:00 UTC). Strictly greater close than open means YES,
 * anything else means NO, so ties count as NO. One retry per price
 * fetch. If a price source fails, the question is flagged for retry on
 * the next cron pass instead of guessing.
 */

const COINGECKO_ASSET_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  NIM: 'nimiq-2',
}

interface PickSideRow {
  wallet_address: string
  side: Side
}

async function fetchPriceAtUtcMidnight(coinId: string, date: Date): Promise<number | null> {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dd}-${mm}-${yyyy}&localization=false`

  let res: Response
  try {
    res = await fetch(url, {
      // workerd sends no User-Agent by default and CoinGecko rejects
      // such requests with 403, so identify ourselves.
      headers: {
        accept: 'application/json',
        'user-agent': 'NimPulse-API/1.0 (https://nimpulse.vercel.app)',
      },
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
  }
  catch (error) {
    console.error(JSON.stringify({
      event: 'coingecko_fetch_throw',
      asset: url,
      error: error instanceof Error ? error.message : String(error),
    }))
    return null
  }
  if (!res.ok) {
    console.error(JSON.stringify({ event: 'coingecko_status', status: res.status, url }))
    return null
  }

  const body: unknown = await res.json()
  const usd = (body as { market_data?: { current_price?: { usd?: unknown } } })
    ?.market_data?.current_price?.usd
  if (typeof usd !== 'number' || !(usd > 0)) {
    console.error(JSON.stringify({ event: 'coingecko_shape', url }))
  }
  return typeof usd === 'number' && usd > 0 ? usd : null
}

async function fetchPriceWithRetry(coinId: string, date: Date): Promise<number | null> {
  const first = await fetchPriceAtUtcMidnight(coinId, date)
  if (first !== null) return first
  await new Promise(resolve => setTimeout(resolve, 1_500))
  return fetchPriceAtUtcMidnight(coinId, date)
}

export async function resolveDueQuestions(env: Env, now: Date): Promise<{ resolved: number, retryFlagged: number }> {
  const due = await env.DB.prepare(
    `SELECT * FROM questions
     WHERE resolves_at <= ? AND outcome IS NULL
     ORDER BY resolves_at ASC
     LIMIT 20`,
  )
    .bind(now.toISOString())
    .all<QuestionRow>()

  let resolved = 0
  let retryFlagged = 0

  for (const question of due.results) {
    const coinId = COINGECKO_ASSET_IDS[question.asset]
    const resolveDate = new Date(question.resolves_at)
    const openDate = new Date(resolveDate.getTime() - 86_400_000)

    const [openPrice, closePrice] = await Promise.all([
      fetchPriceWithRetry(coinId, openDate),
      fetchPriceWithRetry(coinId, resolveDate),
    ])

    if (openPrice === null || closePrice === null) {
      retryFlagged++
      await env.DB.prepare('UPDATE questions SET needs_retry = 1 WHERE id = ?')
        .bind(question.id)
        .run()
      console.error(JSON.stringify({
        event: 'resolution_price_failure',
        questionId: question.id,
        asset: question.asset,
      }))
      continue
    }

    const outcome: Side = closePrice > openPrice ? 'yes' : 'no'

    await env.DB.prepare(
      `UPDATE questions
       SET open_price = ?, close_price = ?, outcome = ?, needs_retry = 0, resolved_at = ?
       WHERE id = ?`,
    )
      .bind(openPrice, closePrice, outcome, now.toISOString(), question.id)
      .run()

    await applyResolutionToPlayers(env, question.id, outcome)
    await applyResolutionToDuels(env, question.id, outcome, now)
    resolved++
  }

  return { resolved, retryFlagged }
}

/**
 * Duel resolution from the same real outcome:
 * - open duels with no opponent become expired
 * - locked duels become resolved with winner_wallet set
 * Idempotent: terminal statuses never match the WHERE clauses again.
 * No NIM moves, no settled or paid status, no payout records.
 */
async function applyResolutionToDuels(env: Env, questionId: number, outcome: Side, now: Date): Promise<void> {
  const resolvedAt = now.toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE duels SET status = 'expired', resolved_at = ?
       WHERE question_id = ? AND status = 'open'`,
    ).bind(resolvedAt, questionId),
    env.DB.prepare(
      `UPDATE duels SET status = 'resolved', resolved_at = ?,
         winner_wallet = CASE WHEN creator_side = ? THEN creator_wallet ELSE opponent_wallet END
       WHERE question_id = ? AND status = 'locked'`,
    ).bind(resolvedAt, outcome, questionId),
  ])
}

/**
 * Correct picks extend the streak and the settled record, wrong picks
 * reset the streak. Runs for every pick on the resolved question.
 */
async function applyResolutionToPlayers(env: Env, questionId: number, outcome: Side): Promise<void> {
  const picks = await env.DB.prepare(
    'SELECT wallet_address, side FROM picks WHERE question_id = ?',
  )
    .bind(questionId)
    .all<PickSideRow>()

  if (picks.results.length === 0) return

  const statements = picks.results.map(pick =>
    env.DB.prepare(
      `UPDATE players SET
         current_streak = CASE WHEN ?1 = ?2 THEN current_streak + 1 ELSE 0 END,
         best_streak = CASE WHEN ?1 = ?2 THEN max(best_streak, current_streak + 1) ELSE best_streak END,
         total_correct = total_correct + CASE WHEN ?1 = ?2 THEN 1 ELSE 0 END,
         settled_wins = settled_wins + CASE WHEN ?1 = ?2 THEN 1 ELSE 0 END,
         settled_losses = settled_losses + CASE WHEN ?1 = ?2 THEN 0 ELSE 1 END
       WHERE wallet_address = ?3`,
    ).bind(pick.side, outcome, pick.wallet_address),
  )

  await env.DB.batch(statements)
}
