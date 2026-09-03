import type { Env, PlayerRow, Side } from './types'

/** Shared read helpers for wallet-scoped pick and player data. */
export async function findPick(env: Env, questionId: number, wallet: string): Promise<{ side: Side } | null> {
  return await env.DB.prepare(
    'SELECT side FROM picks WHERE question_id = ? AND wallet_address = ?',
  )
    .bind(questionId, wallet)
    .first<{ side: Side }>()
}

export async function findPlayer(env: Env, wallet: string): Promise<PlayerRow | null> {
  return await env.DB.prepare('SELECT * FROM players WHERE wallet_address = ?')
    .bind(wallet)
    .first<PlayerRow>()
}
