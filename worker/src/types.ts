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
