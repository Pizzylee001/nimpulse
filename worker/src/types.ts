export interface Env {
  DB: D1Database
}

export interface QuestionRow {
  id: number
  asset: string
  question: string
  opens_at: string
  resolves_at: string
  open_price: number | null
  close_price: number | null
  outcome: 'yes' | 'no' | null
  needs_retry: number
  resolved_at: string | null
  price_source: string | null
}

export interface PickRow {
  id: number
  question_id: number
  wallet_address: string
  side: 'yes' | 'no'
  signature: string
  created_at: string
}

export interface PlayerRow {
  wallet_address: string
  current_streak: number
  best_streak: number
  total_correct: number
  total_picks: number
  settled_wins: number
  settled_losses: number
}

export type Side = 'yes' | 'no'

export type DuelRole = 'creator' | 'opponent' | 'spectator'
export type DuelStatus = 'open' | 'locked' | 'resolved' | 'expired'

export interface DuelRow {
  id: number
  question_id: number
  creator_wallet: string
  creator_side: Side
  stake_luna: number
  status: string
  opponent_wallet: string | null
  opponent_side: Side | null
  winner_wallet: string | null
  memo_base: string
  created_at: string
  resolved_at: string | null
}

export interface DuelProofRow {
  id: number
  duel_id: number
  wallet_address: string
  role: 'creator' | 'opponent'
  side: Side
  public_key: string
  signature: string
  created_at: string
}

export interface DuelResponse {
  id: number
  status: DuelStatus
  question: {
    id: number
    asset: string
    question: string
    resolvesAt: string
    secondsRemaining: number
    outcome: Side | null
    openPrice: number | null
    closePrice: number | null
  }
  creator: {
    wallet: string
    side: Side
  }
  opponent: {
    wallet: string
    side: Side
  } | null
  role: DuelRole
  mySide: Side | null
  winnerRole: 'creator' | 'opponent' | null
}
