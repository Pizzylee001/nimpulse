import type { Env, QuestionRow } from './types'

/*
 * Daily question generation. One question per UTC day, resolved at the
 * next 00:00 UTC. Assets rotate BTC, ETH, NIM, SOL, XRP, DOGE
 * deterministically by resolution date so cron-created and seed-created
 * rows always agree.
 */

const DAY_MS = 86_400_000
export const ROTATION = ['BTC', 'ETH', 'NIM', 'SOL', 'XRP', 'DOGE'] as const

function startOfNextUtcDay(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ))
}

export function assetForResolveDate(resolveDate: Date): string {
  const days = Math.floor(resolveDate.getTime() / DAY_MS)
  return ROTATION[((days % ROTATION.length) + ROTATION.length) % ROTATION.length]
}

export function upcomingAssets(fromResolveDate: Date, count: number): { asset: string, resolvesAt: string }[] {
  const upcoming: { asset: string, resolvesAt: string }[] = []
  for (let index = 1; index <= count; index++) {
    const resolveDate = new Date(fromResolveDate.getTime() + index * DAY_MS)
    upcoming.push({ asset: assetForResolveDate(resolveDate), resolvesAt: resolveDate.toISOString() })
  }
  return upcoming
}

function questionText(asset: string, resolveDate: Date): string {
  const y = resolveDate.getUTCFullYear()
  const m = String(resolveDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(resolveDate.getUTCDate()).padStart(2, '0')
  return `Will ${asset} close higher against USD at ${y}-${m}-${d} 00:00 UTC than its opening price 24 hours earlier?`
}

/**
 * Create the question for the given resolution date if it does not exist.
 * A question opens at creation time, but never earlier than 24 hours
 * before its resolution, so pre-seeded future questions stay closed
 * until their window starts.
 */
async function ensureQuestion(env: Env, resolveDate: Date, now: Date): Promise<void> {
  const asset = assetForResolveDate(resolveDate)
  const opensAt = new Date(Math.max(now.getTime(), resolveDate.getTime() - DAY_MS))
  await env.DB.prepare(
    `INSERT OR IGNORE INTO questions (asset, question, opens_at, resolves_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(asset, questionText(asset, resolveDate), opensAt.toISOString(), resolveDate.toISOString())
    .run()
}

/**
 * Idempotent seeding. The daily cron (00:05 UTC) calls this to create the
 * next day's question. It is also called once when the worker first sees
 * an empty question table (first run after deploy), seeding today's and
 * tomorrow's question so testing works immediately. Rows are only ever
 * created here, never hand-inserted, and prices and outcomes only ever
 * come from the resolution cron.
 */
export async function ensureQuestions(env: Env, now: Date): Promise<void> {
  const nextMidnight = startOfNextUtcDay(now)
  const midnightAfter = new Date(nextMidnight.getTime() + DAY_MS)
  await ensureQuestion(env, nextMidnight, now)
  await ensureQuestion(env, midnightAfter, now)
}

export async function findOpenQuestion(env: Env, now: Date): Promise<QuestionRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM questions
     WHERE opens_at <= ? AND resolves_at > ?
     ORDER BY resolves_at DESC
     LIMIT 1`,
  )
    .bind(now.toISOString(), now.toISOString())
    .first<QuestionRow>()
}

export async function findQuestionById(env: Env, id: number): Promise<QuestionRow | null> {
  return await env.DB.prepare('SELECT * FROM questions WHERE id = ?')
    .bind(id)
    .first<QuestionRow>()
}

export async function findMostRecentResolved(env: Env, now: Date): Promise<QuestionRow | null> {
  return await env.DB.prepare(
    `SELECT * FROM questions
     WHERE outcome IS NOT NULL AND resolves_at <= ?
     ORDER BY resolves_at DESC
     LIMIT 1`,
  )
    .bind(now.toISOString())
    .first<QuestionRow>()
}

export async function countQuestions(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM questions').first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function lastResolutionTime(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT MAX(resolved_at) AS last FROM questions WHERE resolved_at IS NOT NULL',
  ).first<{ last: string | null }>()
  return row?.last ?? null
}
