<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DuelData, Side, TodayQuestion } from '../lib/api'
import { copyText } from '../lib/clipboard'

const props = defineProps<{
  question: TodayQuestion
  side: Side
  loading: boolean
  error: string | null
  result: DuelData | null
}>()

const emit = defineEmits<{ create: [], close: [] }>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
const shareUrl = computed(() => props.result ? `${window.location.origin}/?duel=${props.result.id}` : '')

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (copiedTimer) clearTimeout(copiedTimer)
  if (closeTimer) clearTimeout(closeTimer)
})

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
</script>

<template>
  <div class="sheet-overlay" @click="emit('close')">
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Create a free duel"
      @click.stop
    >
      <div class="sheet-handle" aria-hidden="true" />
      <span class="card-eyebrow">Free duel</span>
      <h2 class="sheet-title">Create a free duel</h2>

      <template v-if="!result">
        <p class="sheet-question">{{ question.question }}</p>
        <p class="locked-line">
          Your side:
          <strong :class="side === 'yes' ? 'side-yes' : 'side-no'">
            {{ side === 'yes' ? 'YES' : 'NO' }}
          </strong>
        </p>
        <p class="sheet-note">Your friend will take the opposite side.</p>
        <p class="sheet-note">No NIM moves in this free duel.</p>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="loading"
          @click="emit('create')"
        >
          <span v-if="loading" class="spinner" aria-hidden="true" />
          {{ loading ? 'Waiting for Nimiq Pay...' : 'Create duel' }}
        </button>
        <p v-if="error" class="card-error" role="alert">
          {{ error }}
        </p>
      </template>

      <template v-else>
        <p class="share-label">Duel link ready</p>
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
        <p class="sheet-note">Waiting for your friend to take the opposite side.</p>
      </template>
    </div>
  </div>
</template>
