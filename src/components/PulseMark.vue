<script setup lang="ts">
defineProps<{
  variant: 'mark' | 'line'
}>()
</script>

<template>
  <!-- Compact mark shown next to the wordmark -->
  <svg
    v-if="variant === 'mark'"
    class="pulse-mark"
    viewBox="0 0 40 28"
    fill="none"
    aria-hidden="true"
  >
    <path
      class="pulse-stroke"
      d="M2 17 H9 L13 8 L17 22 L21 13 L25 17 H38"
    />
    <circle class="pulse-node" cx="13" cy="8" r="2.6" />
  </svg>

  <!-- Wide terminal line under the hero, draws itself once on load -->
  <svg
    v-else
    class="pulse-line"
    viewBox="0 0 480 56"
    fill="none"
    aria-hidden="true"
  >
    <path
      class="pulse-stroke hero-wave-path"
      pathLength="1"
      d="M0 36 H128 L146 24 L162 44 L178 30 L196 30 L208 8 L222 44 L236 30 H480"
    />
    <circle class="pulse-node hero-wave-node" cx="208" cy="8" r="3.5" />
  </svg>
</template>
