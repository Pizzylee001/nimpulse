<script setup lang="ts">
import { computed } from 'vue'

type ChipStatus = 'idle' | 'working' | 'done' | 'declined'

const props = defineProps<{
  step: string
  title: string
  description: string
  buttonLabel: string
  status: ChipStatus
  loading: boolean
  disabled: boolean
  error: string | null
  hasResult: boolean
  buttonDisabled?: boolean
  clearable?: boolean
  pulse?: boolean
  pulseMoney?: boolean
}>()

const emit = defineEmits<{ submit: [], clear: [] }>()

const statusLabels: Record<ChipStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  done: 'Done',
  declined: 'Declined',
}

const statusLabel = computed(() => statusLabels[props.status])
</script>

<template>
  <section
    class="card"
    :class="{
      'card--disabled': disabled,
      'card--pulse': pulse && !pulseMoney,
      'card--pulse-money': pulse && pulseMoney,
    }"
  >
    <div class="card-top">
      <span class="card-eyebrow">{{ step }}</span>
      <span class="chip" :class="`chip--${status}`">
        <span v-if="status === 'working'" class="chip-spinner" aria-hidden="true" />
        <span v-else class="chip-dot" aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </div>
    <h2 class="card-title">
      {{ title }}
    </h2>
    <p class="card-description">
      {{ description }}
    </p>
    <div v-if="hasResult" class="card-result">
      <slot />
    </div>
    <p v-if="error" class="card-error" role="alert">
      {{ error }}
    </p>
    <div class="button-row">
      <button
        class="btn btn-primary"
        type="button"
        :disabled="disabled || loading || buttonDisabled"
        @click="emit('submit')"
      >
        <span v-if="loading" class="spinner" aria-hidden="true" />
        {{ loading ? 'Working…' : buttonLabel }}
      </button>
      <button
        v-if="clearable"
        class="btn btn-ghost"
        type="button"
        :disabled="loading"
        @click="emit('clear')"
      >
        Clear
      </button>
    </div>
  </section>
</template>
