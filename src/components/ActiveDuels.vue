<script setup lang="ts">
import { computed } from 'vue'
import type { MyDuelSummary } from '../lib/api'

const props = defineProps<{
  duels: MyDuelSummary[]
  loading: boolean
}>()

const emit = defineEmits<{ open: [duelId: number] }>()

const statusLabels: Record<MyDuelSummary['status'], string> = {
  open: 'Waiting for opponent',
  locked: 'Locked',
  resolved: 'Resolved',
  expired: 'Expired',
}

const visible = computed(() => props.duels.length > 0 || props.loading)

function sideLabel(side: 'yes' | 'no'): string {
  return side === 'yes' ? 'YES' : 'NO'
}

function formatResolveDate(resolvesAt: string): string {
  const date = new Date(resolvesAt)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section v-if="visible" class="active-duels">
    <span class="card-eyebrow">Active duels</span>

    <p v-if="loading && duels.length === 0" class="duel-row-sub">
      Loading your duels...
    </p>

    <ul class="duel-list">
      <li v-for="duel in duels" :key="duel.id">
        <button
          class="duel-row"
          :class="`duel-row--${duel.status}`"
          type="button"
          :aria-label="`Open duel ${duel.id}, ${duel.question.asset}, your side ${sideLabel(duel.mySide)}`"
          @click="emit('open', duel.id)"
        >
          <span class="duel-row-main">
            <span class="duel-row-top">
              <span class="duel-row-status">{{ statusLabels[duel.status] }}</span>
              <span class="duel-row-asset mono">{{ duel.question.asset }}</span>
            </span>
            <span class="duel-row-sides">
              You:
              <strong :class="duel.mySide === 'yes' ? 'side-yes' : 'side-no'">{{ sideLabel(duel.mySide) }}</strong>
              <template v-if="duel.opponent">
                &middot; Them:
                <strong :class="duel.opponent.side === 'yes' ? 'side-yes' : 'side-no'">{{ sideLabel(duel.opponent.side) }}</strong>
              </template>
              <template v-else>
                &middot; Waiting for opponent
              </template>
            </span>
            <span class="duel-row-sub">
              {{ formatResolveDate(duel.question.resolvesAt) }}
            </span>
          </span>
          <span class="duel-row-action">Open duel</span>
        </button>
      </li>
    </ul>
  </section>
</template>
