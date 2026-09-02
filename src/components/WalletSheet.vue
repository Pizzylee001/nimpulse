<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import PulseMark from './PulseMark.vue'

const props = defineProps<{
  address: string
}>()

const emit = defineEmits<{ close: [], disconnect: [] }>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function close() {
  emit('close')
}

function disconnect() {
  emit('disconnect')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (copiedTimer) clearTimeout(copiedTimer)
})

async function copyAddress() {
  let ok = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(props.address)
      ok = true
    }
  }
  catch {
    ok = false
  }
  if (!ok) {
    // Fallback for non-secure contexts (plain HTTP on LAN), where the
    // async clipboard API is unavailable.
    const textarea = document.createElement('textarea')
    textarea.value = props.address
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      ok = document.execCommand('copy')
    }
    catch {
      ok = false
    }
    document.body.removeChild(textarea)
  }
  if (ok) {
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  }
}
</script>

<template>
  <div class="sheet-overlay" @click="close">
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet session"
      @click.stop
    >
      <div class="sheet-handle" aria-hidden="true" />
      <div class="sheet-brand">
        <PulseMark variant="mark" />
        <span class="sheet-title">Wallet session</span>
      </div>
      <div class="sheet-address">
        <span class="result-label">Connected address</span>
        <span class="result-value mono sheet-address-value">{{ address }}</span>
      </div>
      <button class="btn btn-ghost" type="button" @click="copyAddress">
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
      <button class="btn btn-danger-outline" type="button" @click="disconnect">
        Disconnect
      </button>
      <p class="sheet-helper">Disconnects NimPulse and clears this session.</p>
    </div>
  </div>
</template>
