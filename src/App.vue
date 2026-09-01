<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from 'vue'
import ActionCard from './components/ActionCard.vue'
import PulseMark from './components/PulseMark.vue'
import { TESTNET_RECIPIENT } from './config'
import {
  ACTION_TIMEOUT_MS,
  describeWalletError,
  detectLanguage,
  initProvider,
  isProviderErrorResponse,
  truncateMiddle,
  withTimeout,
  type NimiqProvider,
} from './lib/nimiq'

const SIGN_TEST_MESSAGE = 'Nimpulse wallet test'

type ProviderState = 'connecting' | 'ready' | 'unavailable'
type ChipStatus = 'idle' | 'working' | 'done' | 'declined'

const provider = shallowRef<NimiqProvider | null>(null)
const providerState = ref<ProviderState>('connecting')
const consensus = ref<boolean | null>(null)
const language = ref('')

const connectState = reactive({
  loading: false,
  error: null as string | null,
  address: null as string | null,
})

const signState = reactive({
  loading: false,
  error: null as string | null,
  publicKey: null as string | null,
  signature: null as string | null,
})

const sendState = reactive({
  loading: false,
  error: null as string | null,
  hash: null as string | null,
})

const copied = ref(false)

function chipStatus(state: { loading: boolean, error: string | null }, done: boolean): ChipStatus {
  if (state.loading) return 'working'
  if (state.error) return 'declined'
  return done ? 'done' : 'idle'
}

const connectChip = computed(() => chipStatus(connectState, connectState.address !== null))
const signChip = computed(() => chipStatus(signState, signState.publicKey !== null && signState.signature !== null))
const sendChip = computed(() => chipStatus(sendState, sendState.hash !== null))

const providerLabel = computed(() => {
  if (providerState.value === 'ready') return 'nimiq pay'
  if (providerState.value === 'connecting') return 'detecting'
  return 'not inside nimiq pay'
})

const consensusLabel = computed(() => {
  if (providerState.value !== 'ready') return 'n/a'
  if (consensus.value === null) return 'checking'
  return consensus.value ? 'established' : 'syncing'
})

onMounted(async () => {
  const detected = detectLanguage()
  language.value = detected.language
  console.info(`[nimpulse] language: ${detected.language} (source: ${detected.source})`)

  try {
    provider.value = await initProvider()
    providerState.value = 'ready'
  }
  catch (error) {
    console.info('[nimpulse] Nimiq provider unavailable:', error)
    providerState.value = 'unavailable'
    return
  }

  // Read-only consensus check, no confirmation dialog.
  try {
    consensus.value = await provider.value.isConsensusEstablished()
  }
  catch (error) {
    console.info('[nimpulse] consensus check failed:', error)
    consensus.value = null
  }
})

async function connectWallet() {
  const nimiq = provider.value
  if (!nimiq || connectState.loading) return
  connectState.loading = true
  connectState.error = null
  try {
    const accounts = await withTimeout(
      nimiq.listAccounts(),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    if (isProviderErrorResponse(accounts)) throw accounts
    const first = accounts[0]
    if (!first) throw new Error('Nimiq Pay returned no accounts.')
    connectState.address = first
  }
  catch (error) {
    connectState.error = describeWalletError(error)
  }
  finally {
    connectState.loading = false
  }
}

async function signTestMessage() {
  const nimiq = provider.value
  if (!nimiq || signState.loading) return
  signState.loading = true
  signState.error = null
  try {
    const signed = await withTimeout(
      nimiq.sign(SIGN_TEST_MESSAGE),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    if (isProviderErrorResponse(signed)) throw signed
    signState.publicKey = signed.publicKey
    signState.signature = signed.signature
  }
  catch (error) {
    signState.error = describeWalletError(error)
  }
  finally {
    signState.loading = false
  }
}

async function sendTestTransaction() {
  const nimiq = provider.value
  if (!nimiq || sendState.loading) return
  sendState.loading = true
  sendState.error = null
  try {
    const hash = await withTimeout(
      nimiq.sendBasicTransactionWithData({
        recipient: TESTNET_RECIPIENT,
        value: 100_000,
        data: 'nimpulse-test',
      }),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    if (isProviderErrorResponse(hash)) throw hash
    sendState.hash = hash
  }
  catch (error) {
    sendState.error = describeWalletError(error)
  }
  finally {
    sendState.loading = false
  }
}

async function copyHash() {
  const hash = sendState.hash
  if (!hash) return
  let ok = false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(hash)
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
    textarea.value = hash
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
  if (!ok) {
    sendState.error = 'Copy failed. Copy the hash manually from your wallet history.'
    return
  }
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div class="app-shell">
    <div class="app-column">
      <header class="app-header">
        <div class="hero-brand">
          <PulseMark variant="mark" />
          <h1 class="wordmark">Nimpulse</h1>
        </div>
        <p class="tagline">Call the market. Win the pot.</p>
        <p class="hero-sub">Daily 1v1 prediction duels inside Nimiq Pay.</p>
        <PulseMark variant="line" />
        <p v-if="providerState === 'connecting'" class="status-line">
          Connecting to Nimiq Pay…
        </p>
      </header>

      <div v-if="providerState === 'unavailable'" class="notice" role="status">
        <h2 class="notice-title">
          Nimpulse runs inside Nimiq Pay
        </h2>
        <p class="notice-text">
          This mini app needs the Nimiq Pay wallet to work. Open Nimiq Pay on your
          phone, go to Mini Apps, and load this page from the Custom URL field.
          The wallet cards below stay disabled until then.
        </p>
      </div>

      <main class="card-stack">
        <ActionCard
          step="Step 1"
          title="Connect wallet"
          description="Link your Nimiq Pay wallet to Nimpulse."
          button-label="Connect wallet"
          :status="connectChip"
          :loading="connectState.loading"
          :disabled="providerState !== 'ready'"
          :error="connectState.error"
          :has-result="connectState.address !== null"
          @submit="connectWallet"
        >
          <template v-if="connectState.address">
            <span class="result-label">Connected address</span>
            <span class="result-value mono">{{ truncateMiddle(connectState.address) }}</span>
          </template>
        </ActionCard>

        <ActionCard
          step="Step 2"
          title="Sign test message"
          description="Prove wallet access by signing a fixed message."
          button-label="Sign message"
          :status="signChip"
          :loading="signState.loading"
          :disabled="providerState !== 'ready'"
          :error="signState.error"
          :has-result="signState.publicKey !== null && signState.signature !== null"
          @submit="signTestMessage"
        >
          <template v-if="signState.publicKey && signState.signature">
            <span class="result-label">Public key</span>
            <span class="result-value mono">{{ truncateMiddle(signState.publicKey) }}</span>
            <span class="result-label">Signature</span>
            <span class="result-value mono">{{ truncateMiddle(signState.signature) }}</span>
          </template>
        </ActionCard>

        <ActionCard
          step="Step 3"
          title="Send 1 testnet NIM"
          description="Fire a 1 NIM test transaction with a nimpulse-test memo."
          button-label="Send 1 NIM"
          :status="sendChip"
          :loading="sendState.loading"
          :disabled="providerState !== 'ready'"
          :error="sendState.error"
          :has-result="sendState.hash !== null"
          @submit="sendTestTransaction"
        >
          <template v-if="sendState.hash">
            <span class="result-label">Transaction hash</span>
            <div class="hash-row">
              <span class="result-value mono gold" :title="sendState.hash">
                {{ truncateMiddle(sendState.hash, 12, 8) }}
              </span>
              <button class="btn btn-ghost" type="button" @click="copyHash">
                {{ copied ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </template>
        </ActionCard>
      </main>

      <footer class="status-footer">
        provider: {{ providerLabel }} | consensus: {{ consensusLabel }} | lang: {{ language || 'unknown' }}
      </footer>
    </div>
  </div>
</template>
