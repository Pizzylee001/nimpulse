import { API_BASE_URL } from '../config'

export type Side = 'yes' | 'no'

export interface TodayQuestion {
  id: number
  asset: string
  question: string
  opensAt: string
  resolvesAt: string
  secondsRemaining: number
  myPick: { side: Side } | null
}

export interface RecentQuestion {
  id: number
  asset: string
  question: string
  resolvesAt: string
  outcome: Side
  openPrice: number | null
  closePrice: number | null
  myPick: { side: Side, correct: boolean } | null
}

export interface MeStats {
  currentStreak: number
  bestStreak: number
  totalCorrect: number
  totalPicks: number
}

export interface TodayResponse {
  today: TodayQuestion | null
  recent: RecentQuestion | null
  me: MeStats | null
}

export interface PickRequest {
  questionId: number
  side: Side
  wallet: string
  expiresAt: string
  publicKey: string
  signature: string
}

const REQUEST_TIMEOUT_MS = 15_000

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const message = (body as { error?: unknown } | null)?.error
      throw new Error(typeof message === 'string' && message
        ? message
        : `NimPulse API error (${res.status}).`)
    }
    return body
  }
  finally {
    clearTimeout(timer)
  }
}

export async function getToday(wallet: string | null): Promise<TodayResponse> {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
  return await request(`/api/today${query}`) as TodayResponse
}

export async function postPick(body: PickRequest): Promise<void> {
  await request('/api/pick', { method: 'POST', body: JSON.stringify(body) })
}

export interface DuelPlayer {
  wallet: string
  side: Side
}

export interface DuelQuestion {
  id: number
  asset: string
  question: string
  resolvesAt: string
  secondsRemaining: number
  outcome: Side | null
  openPrice: number | null
  closePrice: number | null
}

export type DuelRole = 'creator' | 'opponent' | 'spectator'
export type DuelStatus = 'open' | 'locked' | 'resolved' | 'expired'

export interface DuelData {
  id: number
  status: DuelStatus
  question: DuelQuestion
  creator: DuelPlayer
  opponent: DuelPlayer | null
  role: DuelRole
  mySide: Side | null
  winnerRole: 'creator' | 'opponent' | null
}

export interface CreateDuelRequest {
  questionId: number
  side: Side
  wallet: string
  memoBase: string
  publicKey: string
  signature: string
}

export interface JoinDuelRequest {
  side: Side
  wallet: string
  publicKey: string
  signature: string
}

export async function getDuel(duelId: number, wallet: string | null): Promise<DuelData> {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
  return await request(`/api/duels/${duelId}${query}`) as DuelData
}

export async function createDuel(body: CreateDuelRequest): Promise<DuelData> {
  const result = await request('/api/duels', { method: 'POST', body: JSON.stringify(body) }) as { duel: DuelData }
  return result.duel
}

export async function joinDuel(duelId: number, body: JoinDuelRequest): Promise<DuelData> {
  const result = await request(`/api/duels/${duelId}/join`, { method: 'POST', body: JSON.stringify(body) }) as { duel: DuelData }
  return result.duel
}

export type MyDuelStatus = 'open' | 'locked' | 'resolved' | 'expired'
export type MyDuelRole = 'creator' | 'opponent'

export interface MyDuelSummary {
  id: number
  status: MyDuelStatus
  role: MyDuelRole
  mySide: Side
  opponent: { wallet: string, side: Side } | null
  question: {
    id: number
    asset: string
    question: string
    resolvesAt: string
    outcome: Side | null
  }
  winnerRole: 'creator' | 'opponent' | null
  createdAt: string
}

export interface PredictionDetail {
  prediction: {
    id: number
    asset: string
    question: string
    opensAt: string
    resolvesAt: string
    outcome: Side | null
    openPrice: number | null
    closePrice: number | null
    priceSource: string | null
    myPick: Side | null
    correct: boolean | null
    secondsRemaining: number
  }
  me: {
    currentStreak: number
    bestStreak: number
    totalCorrect: number
    totalPicks: number
  } | null
}

export async function getMyDuels(wallet: string): Promise<MyDuelSummary[]> {
  const result = await request(`/api/duels?wallet=${encodeURIComponent(wallet)}`) as { duels: MyDuelSummary[] }
  return result.duels
}

export async function getPrediction(predictionId: number, wallet: string | null): Promise<PredictionDetail> {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''
  return await request(`/api/predictions/${predictionId}${query}`) as PredictionDetail
}
