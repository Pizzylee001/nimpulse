import type { DuelResponse, DuelRole, DuelRow, DuelStatus, Env, QuestionRow, Side } from './types'
import { maskWalletAddress } from './verify'

/*
 * Free 1v1 duels on the daily question. Duel state is always computed
 * from stored data (opponent presence plus question state), never from
 * a mutable status alone, so reads stay correct even between cron passes.
 */

/** Safe, bounded client nonce: letters, numbers, hyphens, 8 to 64 chars. */
export const MEMO_BASE_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export function buildDuelCreateMessage(questionId: number, side: Side, wallet: string, memoBase: string, resolvesAt: string): string {
  return `NimPulse duel create: ${questionId} ${side} ${wallet} ${memoBase} ${resolvesAt}`
}

export function buildDuelJoinMessage(duelId: number, questionId: number, side: Side, wallet: string, resolvesAt: string): string {
  return `NimPulse duel join: ${duelId} ${questionId} ${side} ${wallet} ${resolvesAt}`
}

export async function findDuelById(env: Env, id: number): Promise<DuelRow | null> {
  return await env.DB.prepare('SELECT * FROM duels WHERE id = ?')
    .bind(id)
    .first<DuelRow>()
}

export async function findDuelByMemoBase(env: Env, memoBase: string): Promise<DuelRow | null> {
  return await env.DB.prepare('SELECT * FROM duels WHERE memo_base = ?')
    .bind(memoBase)
    .first<DuelRow>()
}

export async function findPickSide(env: Env, questionId: number, wallet: string): Promise<Side | null> {
  const row = await env.DB.prepare(
    'SELECT side FROM picks WHERE question_id = ? AND wallet_address = ?',
  )
    .bind(questionId, wallet)
    .first<{ side: Side }>()
  return row?.side ?? null
}

/**
 * Compute the full duel state for a viewer. Status logic:
 * - question resolved with opponent: resolved, winner from the outcome
 * - question resolved or past resolve time without opponent: expired
 * - opponent present and question unresolved: locked
 * - otherwise: open
 * Wallets are always masked; the viewer's own address is never needed
 * from this response because the client already knows it.
 */
export function buildDuelState(duel: DuelRow, question: QuestionRow, viewerWallet: string | null, now: Date): DuelResponse {
  const questionResolved = question.outcome !== null
  const pastResolve = now.toISOString() >= question.resolves_at
  const hasOpponent = duel.opponent_wallet !== null

  let status: DuelStatus
  let winnerRole: 'creator' | 'opponent' | null = null

  if (questionResolved && hasOpponent) {
    status = 'resolved'
    winnerRole = duel.creator_side === question.outcome ? 'creator' : 'opponent'
  }
  else if (!hasOpponent && (questionResolved || pastResolve)) {
    status = 'expired'
  }
  else if (hasOpponent) {
    status = 'locked'
  }
  else {
    status = 'open'
  }

  let role: DuelRole = 'spectator'
  if (viewerWallet) {
    if (viewerWallet === duel.creator_wallet) {
      role = 'creator'
    }
    else if (duel.opponent_wallet !== null && viewerWallet === duel.opponent_wallet) {
      role = 'opponent'
    }
  }

  const mySide = role === 'creator'
    ? duel.creator_side
    : role === 'opponent' ? duel.opponent_side : null

  return {
    id: duel.id,
    status,
    question: {
      id: question.id,
      asset: question.asset,
      question: question.question,
      resolvesAt: question.resolves_at,
      secondsRemaining: Math.max(0, Math.floor((new Date(question.resolves_at).getTime() - now.getTime()) / 1000)),
      outcome: question.outcome,
      openPrice: question.open_price,
      closePrice: question.close_price,
    },
    creator: {
      wallet: maskWalletAddress(duel.creator_wallet),
      side: duel.creator_side,
    },
    opponent: hasOpponent && duel.opponent_wallet !== null && duel.opponent_side !== null
      ? { wallet: maskWalletAddress(duel.opponent_wallet), side: duel.opponent_side }
      : null,
    role,
    mySide,
    winnerRole,
  }
}
