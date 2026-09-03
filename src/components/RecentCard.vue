<script setup lang="ts">
import { computed } from 'vue'
import type { MeStats, RecentQuestion } from '../lib/api'

const props = defineProps<{
  recent: RecentQuestion | null
  me: MeStats | null
}>()

const emit = defineEmits<{ open: [questionId: number] }>()

const label = computed(() => {
  if (!props.recent) return ''
  const resolves = new Date(props.recent.resolvesAt)
  const yesterday = new Date(Date.now() - 86_400_000)
  const sameDay = resolves.getUTCDate() === yesterday.getUTCDate()
    && resolves.getUTCMonth() === yesterday.getUTCMonth()
    && resolves.getUTCFullYear() === yesterday.getUTCFullYear()
  return sameDay ? 'Yesterday' : 'Last resolved'
})

function formatPrice(value: number | null): string {
  if (value === null) return 'n/a'
  if (value >= 100) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return String(Number(value.toPrecision(4)))
}
</script>

<template>
  <button
    v-if="recent"
    class="card card--compact recent-card"
    type="button"
    :aria-label="`Open resolved ${recent.asset} prediction`"
    @click="emit('open', recent.id)"
  >
    <div class="recent-top">
      <span class="card-eyebrow">{{ label }} &middot; {{ recent.asset }}</span>
      <span class="outcome" :class="recent.outcome === 'yes' ? 'side-yes' : 'side-no'">
        Closed {{ recent.outcome === 'yes' ? 'YES' : 'NO' }}
      </span>
    </div>
    <p class="recent-prices mono">
      {{ formatPrice(recent.openPrice) }} &rarr; {{ formatPrice(recent.closePrice) }} USD
    </p>
    <p class="recent-result">
      <template v-if="recent.myPick">
        Your pick: <strong :class="recent.myPick.side === 'yes' ? 'side-yes' : 'side-no'">
          {{ recent.myPick.side === 'yes' ? 'YES' : 'NO' }}
        </strong>
        <span :class="recent.myPick.correct ? 'result-correct' : 'result-wrong'">
          &middot; {{ recent.myPick.correct ? 'Correct' : 'Wrong' }}
        </span>
      </template>
      <template v-else>No pick</template>
      <span v-if="me" class="streak mono">&middot; Streak: {{ me.currentStreak }}</span>
    </p>
  </button>
</template>
