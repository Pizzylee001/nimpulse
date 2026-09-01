<script setup lang="ts">
defineProps<{
  title: string
  description: string
  buttonLabel: string
  loading: boolean
  disabled: boolean
  error: string | null
  hasResult: boolean
}>()

const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <section class="card" :class="{ 'card--disabled': disabled }">
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
    <button
      class="btn btn-primary"
      type="button"
      :disabled="disabled || loading"
      @click="emit('submit')"
    >
      <span v-if="loading" class="spinner" aria-hidden="true" />
      {{ loading ? 'Working…' : buttonLabel }}
    </button>
  </section>
</template>
