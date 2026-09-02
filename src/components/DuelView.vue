<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DuelData, Side } from '../lib/api'
import { copyText } from '../lib/clipboard'

const props = defineProps<{
  duel: DuelData | null
  loading: boolean
  error: string | null
  providerReady: boolean
  connected: boolean
  joinLoading: boolean
  joinError: string | null
}>()

const emit = defineEmits<{ back: [], connect: [], join: [side: Side] }>()

const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (copiedTimer) clearTimeout(copiedTimer)
})

const status = computed(() => props.duel?.status ?? 'open')
const isOpen = computed(() => status.value === 'open')
const isLocked = computed(() => status.value === 'locked')
const isResolved = computed(() => status.value === 'resolved')
const isExpired = computed(() => status.value === 'expired')

const eyebrow = computed(() => (isOpen.value ? 'Free duel' : 'Head-to-head'))
const outcomeLabel = computed(() => props.duel?.question.outcome === 'yes' ? 'YES' : 'NO')

const remainingMs = computed(() => {
  if (!props.duel) return 0
  return Math.max(0, new Date(props.duel.question.resolvesAt).getTime() - nowMs.value)
})

const countdown = computed(() => {
  const totalSeconds = Math.floor(remainingMs.value / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
})

const oppositeSide = computed<Side>(() => props.duel ? (props.duel.creator.side === 'yes' ? 'no' : 'yes') : 'yes')

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
const copied = ref(false)
const shareUrl = computed(() => props.duel ? `${window.location.origin}/?duel=${props.duel.id}` : '')

async function share() {
  if (!navigator.share) return
  try {
    await navigator.share({
      title: 'NimPulse duel',
      text: 'Take the opposite side of my free NimPulse duel.',
      url: shareUrl.value,
    })
  }
  catch {
    // The user cancelled the share sheet, nothing to do.
  }
}

async function copy() {
  const ok = await copyText(shareUrl.value)
  copied.value = ok
  if (ok) {
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  }
}

function sideClass(side: Side | null): string {
  return side === 'yes' ? 'side-yes' : 'side-no'
}

function panelClass(role: 'creator' | 'opponent'): string[] {
  if (!isResolved.value || !props.duel?.winnerRole) return []
  return props.duel.winnerRole === role
    ? ['versus-panel--winner']
    : ['versus-panel--loser']
}
</script>

<template>
  <section class="duel-view">
    <div class="duel-top">
      <span class="card-eyebrow">{{ eyebrow }}</span>
      <button class="btn-back" type="button" @click="emit('back')">
        Back to today
      </button>
    </div>

    <template v-if="duel">
      <h2 class="duel-question">
        {{ duel.question.question }}
      </h2>

      <p class="countdown mono countdown--gold">
        <template v-if="isResolved">Closed {{ outcomeLabel }}</template>
        <template v-else-if="remainingMs > 0">Resolves in {{ countdown }}</template>
        <template v-else>Resolving soon</template>
      </p>

      <!-- Versus composition: two panels with a central VS marker -->
      <div class="versus">
        <div class="versus-panel" :class="panelClass('creator')">
          <span class="versus-role">Creator</span>
          <span class="versus-wallet mono">{{ duel.creator.wallet }}</span>
          <span class="versus-side" :class="sideClass(duel.creator.side)">
            {{ duel.creator.side === 'yes' ? 'YES' : 'NO' }}
          </span>
          <span v-if="isResolved && duel.winnerRole === 'creator'" class="winner-tag">Winner</span>
        </div>

        <div class="versus-marker" aria-hidden="true">VS</div>

        <div v-if="duel.opponent" class="versus-panel" :class="panelClass('opponent')">
          <span class="versus-role">Opponent</span>
          <span class="versus-wallet mono">{{ duel.opponent.wallet }}</span>
          <span class="versus-side" :class="sideClass(duel.opponent.side)">
            {{ duel.opponent.side === 'yes' ? 'YES' : 'NO' }}
          </span>
          <span v-if="isResolved && duel.winnerRole === 'opponent'" class="winner-tag">Winner</span>
        </div>
        <div v-else class="versus-panel versus-panel--empty">
          <span class="versus-role">Opponent</span>
          <span class="versus-waiting">Waiting for opponent</span>
        </div>
      </div>

      <!-- Open duel, viewer has no wallet -->
      <template v-if="isOpen && !connected">
        <p class="duel-status-line">
          The creator picked {{ duel.creator.side === 'yes' ? 'YES' : 'NO' }}. Open this
          link inside Nimiq Pay and connect a wallet to take the opposite side.
        </p>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="!providerReady"
          @click="emit('connect')"
        >
          Connect wallet to join
        </button>
        <p class="free-note">Free duel. No NIM moves.</p>
      </template>

      <!-- Open duel, viewer is the creator -->
      <template v-else-if="isOpen && duel.role === 'creator'">
        <p class="duel-status-line">
          Your side: {{ duel.mySide === 'yes' ? 'YES' : 'NO' }}. Waiting for opponent.
        </p>
        <p class="share-label">Share this duel</p>
        <div class="share-box">
          <span class="share-url mono">{{ shareUrl }}</span>
        </div>
        <div class="share-actions">
          <button v-if="canShare" class="btn btn-primary" type="button" @click="share">
            Share duel
          </button>
          <button class="btn btn-ghost" type="button" @click="copy">
            {{ copied ? 'Copied' : 'Copy link' }}
          </button>
        </div>
      </template>

      <!-- Open duel, spectator with a wallet can join on the opposite side -->
      <template v-else-if="isOpen && duel.role === 'spectator'">
        <p class="duel-status-line">
          The creator picked {{ duel.creator.side === 'yes' ? 'YES' : 'NO' }}. You take the
          opposite side.
        </p>
        <div class="choice-row">
          <div class="side-slot" :class="[sideClass(duel.creator.side), 'side-slot--disabled']">
            {{ duel.creator.side === 'yes' ? 'YES' : 'NO' }}
          </div>
          <div class="side-slot" :class="sideClass(oppositeSide)">
            {{ oppositeSide === 'yes' ? 'YES' : 'NO' }}
          </div>
        </div>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="!providerReady || joinLoading"
          @click="emit('join', oppositeSide)"
        >
          <span v-if="joinLoading" class="spinner" aria-hidden="true" />
          {{ joinLoading ? 'Waiting for Nimiq Pay...' : 'Join duel' }}
        </button>
        <p class="free-note">Free duel. No NIM moves.</p>
        <p v-if="joinError" class="card-error" role="alert">
          {{ joinError }}
        </p>
      </template>

      <!-- Locked -->
      <template v-else-if="isLocked">
        <p class="duel-status-line">Both players are locked in. Waiting for resolution.</p>
        <template v-if="duel.role === 'creator' || duel.role === 'opponent'">
          <div class="share-box">
            <span class="share-url mono">{{ shareUrl }}</span>
          </div>
          <div class="share-actions">
            <button v-if="canShare" class="btn btn-primary" type="button" @click="share">
              Share duel
            </button>
            <button class="btn btn-ghost" type="button" @click="copy">
              {{ copied ? 'Copied' : 'Copy link' }}
            </button>
          </div>
        </template>
      </template>

      <!-- Resolved -->
      <template v-else-if="isResolved">
        <p class="duel-status-line">
          Duel resolved. Outcome was
          <strong :class="sideClass(duel.question.outcome)">{{ outcomeLabel }}</strong>.
          The {{ duel.winnerRole }} wins.
        </p>
        <div class="share-box">
          <span class="share-url mono">{{ shareUrl }}</span>
        </div>
        <div class="share-actions">
          <button v-if="canShare" class="btn btn-primary" type="button" @click="share">
            Share result
          </button>
          <button class="btn btn-ghost" type="button" @click="copy">
            {{ copied ? 'Copied' : 'Copy link' }}
          </button>
        </div>
      </template>

      <!-- Expired -->
      <template v-else-if="isExpired">
        <p class="duel-status-line">
          Duel expired. No opponent joined before the question closed.
        </p>
      </template>

      <p v-if="error" class="card-error" role="alert">
        {{ error }}
      </p>
    </template>

    <template v-else-if="loading">
      <p class="card-description">Loading the duel...</p>
    </template>

    <template v-else-if="error">
      <p class="card-error" role="alert">
        {{ error }}
      </p>
    </template>
  </section>
</template>
