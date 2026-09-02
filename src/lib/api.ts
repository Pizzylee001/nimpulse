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
