<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getPrediction, type PredictionDetail } from '../lib/api'

const props = defineProps<{
  predictionId: number
  wallet: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const detail = ref<PredictionDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    detail.value = await getPrediction(props.predictionId, props.wallet)
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the prediction.'
  }
  finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  void load()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

watch(() => props.wallet, () => {
  void load()
})

const outcomeLabel = computed(() => detail.value?.prediction.outcome === 'yes' ? 'YES' : 'NO')

function formatPrice(value: number | null): string {
  if (value === null) return 'n/a'
  if (value >= 100) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return String(Number(value.toPrecision(4)))
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="sheet-overlay" @click="emit('close')">
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Prediction detail"
      @click.stop
    >
      <div class="sheet-handle" aria-hidden="true" />

      <template v-if="detail">
        <span class="card-eyebrow">Prediction record &middot; {{ detail.prediction.asset }}</span>
        <h2 class="sheet-title">{{ detail.prediction.question }}</h2>

        <dl class="detail-list">
          <div class="detail-row">
            <dt>Resolves</dt>
            <dd class="mono">{{ formatDateTime(detail.prediction.resolvesAt) }}</dd>
          </div>
          <div class="detail-row">
            <dt>Opening price</dt>
            <dd class="mono">{{ formatPrice(detail.prediction.openPrice) }} USD</dd>
          </div>
          <div class="detail-row">
            <dt>Closing price</dt>
            <dd class="mono">{{ formatPrice(detail.prediction.closePrice) }} USD</dd>
          </div>
          <div class="detail-row">
            <dt>Outcome</dt>
            <dd>
              <template v-if="detail.prediction.outcome">
                <strong :class="detail.prediction.outcome === 'yes' ? 'side-yes' : 'side-no'">
                  {{ outcomeLabel }}
                </strong>
              </template>
              <template v-else>Not resolved yet</template>
            </dd>
          </div>
          <div class="detail-row">
            <dt>Your pick</dt>
            <dd>
              <template v-if="detail.prediction.myPick">
                <strong :class="detail.prediction.myPick === 'yes' ? 'side-yes' : 'side-no'">
                  {{ detail.prediction.myPick === 'yes' ? 'YES' : 'NO' }}
                </strong>
              </template>
              <template v-else-if="wallet">
                <span class="card-description">No pick on this question.</span>
              </template>
              <template v-else>
                <span class="card-description">Connect wallet to see your pick.</span>
              </template>
            </dd>
          </div>
          <div v-if="detail.prediction.myPick && detail.prediction.outcome" class="detail-row">
            <dt>Result</dt>
            <dd>
              <strong :class="detail.prediction.correct ? 'result-correct' : 'result-wrong'">
                {{ detail.prediction.correct ? 'Correct' : 'Wrong' }}
              </strong>
            </dd>
          </div>
          <template v-if="detail.me">
            <div class="detail-row">
              <dt>Current streak</dt>
              <dd class="streak mono">{{ detail.me.currentStreak }}</dd>
            </div>
            <div class="detail-row">
              <dt>Best streak</dt>
              <dd class="streak mono">{{ detail.me.bestStreak }}</dd>
            </div>
          </template>
          <div v-if="detail.prediction.priceSource" class="detail-row">
            <dt>Price source</dt>
            <dd class="mono">{{ detail.prediction.priceSource }}</dd>
          </div>
        </dl>
        <p v-if="detail.prediction.priceSource" class="sheet-note">
          Prices recorded at resolution. Shown as provenance, not as trading advice.
        </p>
      </template>

      <template v-else-if="loading">
        <p class="card-description">Loading the prediction...</p>
      </template>

      <template v-else-if="error">
        <p class="card-error" role="alert">{{ error }}</p>
      </template>

      <button class="btn btn-ghost" type="button" @click="emit('close')">
        Close
      </button>
    </div>
  </div>
</template>
