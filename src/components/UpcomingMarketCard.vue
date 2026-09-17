<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  asset: string
  resolvesAt: string
}>()

const emit = defineEmits<{ opened: [] }>()

const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

const openMs = computed(() => new Date(props.resolvesAt).getTime() - 86_400_000)
const remainingMs = computed(() => Math.max(0, openMs.value - nowMs.value))
const isOpen = computed(() => remainingMs.value <= 0)

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  return days > 0 ? `${days}d ${clock}` : clock
}

const countdown = computed(() => isOpen.value
  ? 'Opening soon'
  : `Opens in ${formatCountdown(remainingMs.value)}`)

let openedEmitted = false

watch(isOpen, (value) => {
  if (value && !openedEmitted) {
    openedEmitted = true
    emit('opened')
  }
})

onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1_000)
  if (isOpen.value && !openedEmitted) {
    openedEmitted = true
    emit('opened')
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="card question-card">
    <div class="card-top">
      <span class="card-eyebrow">{{ asset }}</span>
      <span class="chip chip--idle">
        <span class="chip-dot" aria-hidden="true" />
        Upcoming
      </span>
    </div>
    <p class="countdown mono">{{ countdown }}</p>
  </section>
</template>
