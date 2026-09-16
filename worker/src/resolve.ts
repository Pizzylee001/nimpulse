import type { Env, QuestionRow, Side } from './types'

/*
 * Resolution. For each question past its resolve time, fetch the open
 * and close USD prices (00:00 UTC snapshots) and compute the outcome.
 * Strictly greater close than open means YES, anything else means NO,
 * so ties count as NO.
 *
 * Sources, in order:
 * 1. CoinGecko history (primary, per the product spec)
 * 2. Exchange fallback per asset: Coinbase daily candles for BTC,
 *    ETH, SOL, XRP, and DOGE, KuCoin daily candles for NIM. Keyless
 *    public market data.
 *
 * Both prices for one question always come from the same source so the
 * open/close comparison stays internally consistent. One retry per
 * attempt. If every source fails, the question is flagged for retry on
 * the next pass instead of guessing. Resolution is claimed atomically
 * (WHERE outcome IS NULL), so the daily cron and the background request
 * sweep can never double-apply effects.
 *
 * Duel statuses update on the same resolution: open duels without an
 * opponent become expired, locked duels become resolved with
 * winner_wallet set. Idempotent. No NIM moves in Phase 2b.
 */

const COINGECKO_ASSET_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  NIM: 'nimiq-2',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
}

const EXCHANGE_FALLBACKS: Record<string, { source: string, symbol: string }> = {
  BTC: { source: 'coinbase', symbol: 'BTC-USD' },
  ETH: { source: 'coinbase', symbol: 'ETH-USD' },
  NIM: { source: 'kucoin', symbol: 'NIM-USDT' },
  SOL: { source: 'coinbase', symbol: 'SOL-USD' },
  XRP: { source: 'coinbase', symbol: 'XRP-USD' },
  DOGE: { source: 'coinbase', symbol: 'DOGE-USD' },
}

interface PickSideRow {
  wallet_address: string
  side: Side
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      // workerd sends no User-Agent by default and public price APIs
      // reject such requests with 403, so identify ourselves.
      headers: {
        accept: 'application/json',
        'user-agent': 'NimPulse-API/1.0 (https://nimpulse.vercel.app)',
      },
    })
    if (!res.ok) return null
    return await res.json()
  }
  catch {
    // A network level throw becomes a normal source failure.
    return null
  }
}

async function fetchCoinGeckoPrice(coinId: string, date: Date): Promise<number | null> {
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const body = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dd}-${mm}-${yyyy}&localization=false`,
  ) as { market_data?: { current_price?: { usd?: unknown } } } | null
  const usd = body?.market_data?.current_price?.usd
  return typeof usd === 'number' && usd > 0 ? usd : null
}

/** Coinbase Exchange daily candle open is the price at 00:00 UTC of the date. */
async function fetchCoinbasePrice(symbol: string, date: Date): Promise<number | null> {
  const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  // The API accepts millisecond start and end bounds but returns candle
  // times in seconds, so the row match is done in seconds.
  const startSeconds = startMs / 1000
  const body = await fetchJson(
    `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=86400&start=${startMs}&end=${startMs + 86_400_000}`,
  ) as number[][] | null
  const row = body?.find(candle => Array.isArray(candle) && candle[0] === startSeconds)
  const open = row ? row[3] : null
  return typeof open === 'number' && open > 0 ? open : null
}

/** KuCoin 1day candle open is the price at 00:00 UTC of the date. */
async function fetchKucoinPrice(symbol: string, date: Date): Promise<number | null> {
  const startAt = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000)
  const body = await fetchJson(
    `https://api.kucoin.com/api/v1/market/candles?type=1day&symbol=${symbol}&startAt=${startAt}&endAt=${startAt + 86_400}`,
  ) as { data?: unknown[][] } | null
  const row = body?.data?.find(candle => Number(candle[0]) === startAt)
  const open = row ? row[1] : null
  return typeof open === 'string' && Number(open) > 0 ? Number(open) : null
}

interface SourcedPrices {
  openPrice: number
  closePrice: number
  source: string
}

async function trySource(source: string, coinId: string, symbol: string, openDate: Date, closeDate: Date): Promise<SourcedPrices | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1_500))
    }
    if (source === 'coingecko') {
      const [openPrice, closePrice] = await Promise.all([
        fetchCoinGeckoPrice(coinId, openDate),
        fetchCoinGeckoPrice(coinId, closeDate),
      ])
      if (openPrice !== null && closePrice !== null) return { openPrice, closePrice, source }
    }
    else if (source === 'coinbase') {
      const [openPrice, closePrice] = await Promise.all([
        fetchCoinbasePrice(symbol, openDate),
        fetchCoinbasePrice(symbol, closeDate),
      ])
      if (openPrice !== null && closePrice !== null) return { openPrice, closePrice, source }
    }
    else if (source === 'kucoin') {
      const [openPrice, closePrice] = await Promise.all([
        fetchKucoinPrice(symbol, openDate),
        fetchKucoinPrice(symbol, closeDate),
      ])
      if (openPrice !== null && closePrice !== null) return { openPrice, closePrice, source }
    }
  }
  return null
}

async function fetchPricesForQuestion(question: QuestionRow, resolveDate: Date): Promise<SourcedPrices | null> {
  const openDate = new Date(resolveDate.getTime() - 86_400_000)
  const coinId = COINGECKO_ASSET_IDS[question.asset]
  const fallback = EXCHANGE_FALLBACKS[question.asset]

  // Primary: CoinGecko. Fallback: per-asset exchange. Both prices for
  // one question always come from the same source.
  const fromCoinGecko = await trySource('coingecko', coinId, fallback?.symbol ?? '', openDate, resolveDate)
  if (fromCoinGecko) return fromCoinGecko

  if (fallback) {
    const fromExchange = await trySource(fallback.source, coinId, fallback.symbol, openDate, resolveDate)
    if (fromExchange) return fromExchange
  }
  return null
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
    try {
      const resolveDate = new Date(question.resolves_at)
      const prices = await fetchPricesForQuestion(question, resolveDate)

      if (prices === null) {
        retryFlagged++
        await env.DB.prepare('UPDATE questions SET needs_retry = 1 WHERE id = ? AND outcome IS NULL')
          .bind(question.id)
          .run()
        console.error(JSON.stringify({
          event: 'resolution_price_failure',
          questionId: question.id,
          asset: question.asset,
        }))
        continue
      }

      const outcome: Side = prices.closePrice > prices.openPrice ? 'yes' : 'no'

      // Atomic claim: only one invocation can flip outcome, so a racing
      // cron and request sweep cannot double-apply player or duel effects.
      const claim = await env.DB.prepare(
        `UPDATE questions
         SET open_price = ?, close_price = ?, outcome = ?, needs_retry = 0, resolved_at = ?, price_source = ?
         WHERE id = ? AND outcome IS NULL`,
      )
        .bind(prices.openPrice, prices.closePrice, outcome, now.toISOString(), prices.source, question.id)
        .run()

      if (Number(claim.meta.changes ?? 0) !== 1) {
        continue
      }

      console.log(JSON.stringify({
        event: 'question_resolved',
        questionId: question.id,
        asset: question.asset,
        outcome,
        source: prices.source,
        openPrice: prices.openPrice,
        closePrice: prices.closePrice,
      }))

      await applyResolutionToPlayers(env, question.id, outcome)
      await applyResolutionToDuels(env, question.id, outcome, now)
      resolved++
    }
    catch (error) {
      // One bad question must never kill the rest of the pass.
      console.error(JSON.stringify({
        event: 'resolution_question_error',
        questionId: question.id,
        error: error instanceof Error ? error.message : String(error),
      }))
      continue
    }
  }

  return { resolved, retryFlagged }
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
