<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { TodayQuestion, UpcomingAsset } from '../lib/api'

const props = defineProps<{
  question: TodayQuestion | null
  upcoming: UpcomingAsset[]
  providerReady: boolean
  connected: boolean
  pickLoading: boolean
  pickSide: 'yes' | 'no' | null
  pickError: string | null
  apiError: string | null
  apiLoading: boolean
  challengeLoading: boolean
}>()

const emit = defineEmits<{ pick: [side: 'yes' | 'no'], connect: [], challenge: [] }>()

const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const remainingMs = computed(() => {
  if (!props.question) return 0
  return Math.max(0, new Date(props.question.resolvesAt).getTime() - nowMs.value)
})

const expired = computed(() => props.question !== null && remainingMs.value <= 0)

const countdown = computed(() => {
  const totalSeconds = Math.floor(remainingMs.value / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
})

const locked = computed(() => props.question?.myPick != null)
const lockedSide = computed(() => props.question?.myPick?.side ?? null)

function formatUpcomingDate(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleString(undefined, { day: 'numeric', timeZone: 'UTC' })
  const month = date.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
  return `${day} ${month}`
}

const upcomingLabel = computed(() =>
  props.upcoming.map(entry => `${entry.asset} ${formatUpcomingDate(entry.resolvesAt)}`).join(', '))
</script>

<template>
  <section class="card question-card">
    <template v-if="question">
      <div class="card-top">
        <span class="card-eyebrow">Today &middot; {{ question.asset }}</span>
        <span class="chip" :class="locked ? 'chip--done' : 'chip--idle'">
          <span class="chip-dot" aria-hidden="true" />
          {{ locked ? 'Locked' : 'Open' }}
        </span>
      </div>

      <h2 class="card-title question-text">
        {{ question.question }}
      </h2>

      <p v-if="upcoming.length > 0" class="card-description mono">
        Next markets: {{ upcomingLabel }}
      </p>

      <p class="countdown mono" :class="{ 'countdown--expiring': remainingMs <= 60_000 && !expired }">
        <template v-if="!expired">Resolves in {{ countdown }}</template>
        <template v-else>Resolving soon</template>
      </p>

      <div v-if="locked && !expired" class="locked-box">
        <p class="locked-line">
          Your pick:
          <strong :class="lockedSide === 'yes' ? 'side-yes' : 'side-no'">
            {{ lockedSide === 'yes' ? 'YES' : 'NO' }}
          </strong>
        </p>
        <p class="locked-sub">Waiting for resolution</p>
        <button
          class="btn btn-primary btn-challenge"
          type="button"
          :disabled="!providerReady || challengeLoading"
          @click="emit('challenge')"
        >
          <span v-if="challengeLoading" class="spinner" aria-hidden="true" />
          Challenge with {{ lockedSide === 'yes' ? 'YES' : 'NO' }}
        </button>
      </div>

      <div v-else-if="!expired" class="choice-row">
        <template v-if="connected">
          <button
            class="btn btn-side btn-yes"
            type="button"
            :disabled="!providerReady || pickLoading"
            @click="emit('pick', 'yes')"
          >
            <span v-if="pickLoading && pickSide === 'yes'" class="spinner" aria-hidden="true" />
            YES
          </button>
          <button
            class="btn btn-side btn-no"
            type="button"
            :disabled="!providerReady || pickLoading"
            @click="emit('pick', 'no')"
          >
            <span v-if="pickLoading && pickSide === 'no'" class="spinner" aria-hidden="true" />
            NO
          </button>
        </template>
        <button
          v-else
          class="btn btn-primary"
          type="button"
          :disabled="!providerReady"
          @click="emit('connect')"
        >
          Connect wallet to pick
        </button>
      </div>

      <p v-if="pickError" class="card-error" role="alert">
        {{ pickError }}
      </p>
      <p v-if="apiError" class="card-error" role="alert">
        {{ apiError }}
      </p>
    </template>

    <template v-else-if="apiLoading">
      <p class="card-description">Loading today's question...</p>
    </template>

    <template v-else-if="apiError">
      <h2 class="card-title">Today's question</h2>
      <p class="card-error" role="alert">
        {{ apiError }}
      </p>
    </template>

    <template v-else>
      <h2 class="card-title">Today's question</h2>
      <p class="card-description">
        No question is open right now. The next one opens soon.
      </p>
    </template>
  </section>
</template>
