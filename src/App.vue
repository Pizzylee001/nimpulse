<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import ActionCard from './components/ActionCard.vue'
import PulseMark from './components/PulseMark.vue'
import QuestionCard from './components/QuestionCard.vue'
import RecentCard from './components/RecentCard.vue'
import WalletSheet from './components/WalletSheet.vue'
import { TESTNET_RECIPIENT } from './config'
import { getToday, postPick, type Side, type TodayResponse } from './lib/api'
import {
  ACTION_TIMEOUT_MS,
  describeWalletError,
  detectLanguage,
  initProvider,
  loadFoundationSnapshot,
  PULSE_DURATION_MS,
  saveFoundationSnapshot,
  truncateMiddle,
  unwrapProviderResult,
  withTimeout,
  type NimiqProvider,
} from './lib/nimiq'

const SIGN_TEST_MESSAGE = 'NimPulse wallet test'

type ProviderState = 'connecting' | 'ready' | 'unavailable'
type ChipStatus = 'idle' | 'working' | 'done' | 'declined'

interface CardState {
  loading: boolean
  error: string | null
  pulse: boolean
}

const snapshot = loadFoundationSnapshot()
snapshot.boots += 1
if (!snapshot.address) {
  snapshot.publicKey = null
  snapshot.signature = null
  snapshot.hash = null
}
saveFoundationSnapshot(snapshot)
console.info(`[nimpulse] boot ${snapshot.boots}`)

const boots = snapshot.boots
const provider = shallowRef<NimiqProvider | null>(null)
const providerState = ref<ProviderState>('connecting')
let sessionVersion = 0

const connectState = reactive<CardState & { address: string | null }>({
  loading: false,
  error: null,
  pulse: false,
  address: snapshot.address,
})

const signState = reactive<CardState & { publicKey: string | null, signature: string | null }>({
  loading: false,
  error: null,
  pulse: false,
  publicKey: snapshot.publicKey,
  signature: snapshot.signature,
})

const sendState = reactive<CardState & { hash: string | null }>({
  loading: false,
  error: null,
  pulse: false,
  hash: snapshot.hash,
})

const copied = ref(false)
const walletSheetOpen = ref(false)

const todayData = ref<TodayResponse | null>(null)
const apiLoading = ref(true)
const apiError = ref<string | null>(null)
const pickFlow = reactive({ loading: false, side: null as Side | null, error: null as string | null })

function persist() {
  saveFoundationSnapshot({
    boots,
    address: connectState.address,
    publicKey: signState.publicKey,
    signature: signState.signature,
    hash: sendState.hash,
  })
}

function triggerPulse(state: CardState) {
  state.pulse = false
  requestAnimationFrame(() => {
    state.pulse = true
    setTimeout(() => {
      state.pulse = false
    }, PULSE_DURATION_MS)
  })
}

function chipStatus(state: CardState, done: boolean): ChipStatus {
  if (state.loading) return 'working'
  if (state.error) return 'declined'
  return done ? 'done' : 'idle'
}

const connectDone = computed(() => connectState.address !== null)
const signDone = computed(() => connectState.address !== null && signState.publicKey !== null && signState.signature !== null)
const sendDone = computed(() => connectState.address !== null && sendState.hash !== null)

const connectChip = computed(() => chipStatus(connectState, connectDone.value))
const signChip = computed(() => chipStatus(signState, signDone.value))
const sendChip = computed(() => chipStatus(sendState, sendDone.value))

const connectButtonLabel = computed(() => connectDone.value ? 'Disconnect' : 'Connect wallet')
const signButtonLabel = computed(() => {
  if (!connectDone.value) return 'Connect wallet first'
  return signDone.value ? 'Signed' : 'Sign message'
})
const sendButtonLabel = computed(() => {
  if (!connectDone.value) return 'Connect wallet first'
  return sendDone.value ? 'Sent' : 'Send 1 NIM'
})

async function fetchToday() {
  apiLoading.value = true
  apiError.value = null
  try {
    todayData.value = await getToday(connectState.address)
  }
  catch (error) {
    apiError.value = error instanceof Error ? error.message : 'Could not load the daily question.'
  }
  finally {
    apiLoading.value = false
  }
}

let pollTimer: ReturnType<typeof setInterval> | undefined

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void fetchToday()
  }
}

onMounted(async () => {
  const detected = detectLanguage()
  console.info(`[nimpulse] language: ${detected.language} (source: ${detected.source})`)
  void fetchToday()
  pollTimer = setInterval(() => {
    void fetchToday()
  }, 60_000)
  document.addEventListener('visibilitychange', handleVisibilityChange)

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
    const established = await provider.value.isConsensusEstablished()
    console.info(`[nimpulse] consensus established: ${established}`)
  }
  catch (error) {
    console.info('[nimpulse] consensus check failed:', error)
  }
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

watch(connectDone, () => {
  void fetchToday()
})

async function connectWallet() {
  const nimiq = provider.value
  if (!nimiq || connectState.loading || connectDone.value) return
  connectState.loading = true
  connectState.error = null
  try {
    const raw = await withTimeout(
      nimiq.listAccounts(),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    const accounts = unwrapProviderResult<unknown>(raw)
    const list = Array.isArray(accounts)
      ? accounts
      : typeof accounts === 'string' ? [accounts] : []
    const first = list[0]
    if (typeof first !== 'string' || !first) {
      throw new Error('Nimiq Pay returned no accounts.')
    }
    connectState.address = first
    persist()
    triggerPulse(connectState)
  }
  catch (error) {
    connectState.error = describeWalletError(error)
  }
  finally {
    connectState.loading = false
  }
}

async function submitPick(side: Side) {
  const nimiq = provider.value
  const question = todayData.value?.today
  if (!nimiq || !question || pickFlow.loading || question.myPick) return

  if (!connectDone.value) {
    await connectWallet()
    if (!connectDone.value) return
  }
  const wallet = connectState.address
  if (!wallet) return

  pickFlow.loading = true
  pickFlow.side = side
  pickFlow.error = null
  try {
    // Canonical message, byte for byte what the server rebuilds.
    const message = `NimPulse pick: ${question.id} ${side} ${wallet} ${question.resolvesAt}`
    const raw = await withTimeout(
      nimiq.sign(message),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    const signed = unwrapProviderResult<unknown>(raw)
    if (typeof signed !== 'object' || signed === null) {
      throw new Error('Unexpected sign response from Nimiq Pay.')
    }
    const payload = signed as { publicKey?: unknown, signature?: unknown }
    const publicKey = payload.publicKey
    const signature = payload.signature
    if (typeof publicKey !== 'string' || typeof signature !== 'string') {
      throw new Error('Unexpected sign response from Nimiq Pay.')
    }
    await postPick({
      questionId: question.id,
      side,
      wallet,
      expiresAt: question.resolvesAt,
      publicKey,
      signature,
    })
    await fetchToday()
  }
  catch (error) {
    pickFlow.error = describeWalletError(error)
  }
  finally {
    pickFlow.loading = false
    pickFlow.side = null
  }
}

async function handleConnectAction() {
  if (connectDone.value) {
    disconnectSession()
    return
  }
  await connectWallet()
}

async function signTestMessage() {
  const nimiq = provider.value
  if (!nimiq || !connectDone.value || signState.loading || signDone.value) return
  const requestSession = sessionVersion
  signState.loading = true
  signState.error = null
  try {
    const raw = await withTimeout(
      nimiq.sign(SIGN_TEST_MESSAGE),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    const signed = unwrapProviderResult<unknown>(raw)
    if (typeof signed !== 'object' || signed === null) {
      throw new Error('Unexpected sign response from Nimiq Pay.')
    }
    const payload = signed as { publicKey?: unknown, signature?: unknown }
    const publicKey = payload.publicKey
    const signature = payload.signature
    if (typeof publicKey !== 'string' || typeof signature !== 'string') {
      throw new Error('Unexpected sign response from Nimiq Pay.')
    }
    if (requestSession !== sessionVersion || !connectDone.value) return
    signState.publicKey = publicKey
    signState.signature = signature
    persist()
    triggerPulse(signState)
  }
  catch (error) {
    if (requestSession === sessionVersion) {
      signState.error = describeWalletError(error)
    }
  }
  finally {
    signState.loading = false
  }
}

async function sendTestTransaction() {
  const nimiq = provider.value
  if (!nimiq || !connectDone.value || sendState.loading || sendDone.value) return
  const requestSession = sessionVersion
  sendState.loading = true
  sendState.error = null
  try {
    const raw = await withTimeout(
      nimiq.sendBasicTransactionWithData({
        recipient: TESTNET_RECIPIENT,
        value: 100_000,
        data: 'nimpulse-test',
      }),
      ACTION_TIMEOUT_MS,
      'Nimiq Pay did not respond in time. Try again.',
    )
    const result = unwrapProviderResult<unknown>(raw)
    let hash: string | null = null
    if (typeof result === 'string') {
      hash = result
    }
    else if (typeof result === 'object' && result !== null) {
      const candidate = (result as { hash?: unknown }).hash
      if (typeof candidate === 'string') hash = candidate
    }
    if (!hash) {
      throw new Error('Unexpected transaction response from Nimiq Pay.')
    }
    if (requestSession !== sessionVersion || !connectDone.value) return
    sendState.hash = hash
    persist()
    triggerPulse(sendState)
  }
  catch (error) {
    if (requestSession === sessionVersion) {
      sendState.error = describeWalletError(error)
    }
  }
  finally {
    sendState.loading = false
  }
}

function disconnectSession() {
  sessionVersion += 1

  connectState.address = null
  connectState.loading = false
  connectState.error = null
  connectState.pulse = false

  signState.publicKey = null
  signState.signature = null
  signState.loading = false
  signState.error = null
  signState.pulse = false

  sendState.hash = null
  sendState.loading = false
  sendState.error = null
  sendState.pulse = false

  pickFlow.error = null

  copied.value = false
  walletSheetOpen.value = false
  saveFoundationSnapshot({
    boots,
    address: null,
    publicKey: null,
    signature: null,
    hash: null,
  })
  void fetchToday()
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
          <h1 class="wordmark">NimPulse</h1>
          <button
            v-if="connectState.address"
            class="wallet-pill mono"
            type="button"
            aria-haspopup="dialog"
            @click="walletSheetOpen = true"
          >
            <PulseMark variant="mark" />
            {{ truncateMiddle(connectState.address) }}
          </button>
        </div>
        <p class="tagline">Call the market. Win the pot.</p>
        <p class="hero-sub">1v1 market prediction duels inside Nimiq Pay.</p>
        <PulseMark variant="line" />
        <p v-if="providerState === 'connecting'" class="status-line">
          Connecting to Nimiq Pay…
        </p>
      </header>

      <div v-if="providerState === 'unavailable'" class="notice" role="status">
        <h2 class="notice-title">
          NimPulse runs inside Nimiq Pay
        </h2>
        <p class="notice-text">
          This mini app needs the Nimiq Pay wallet to work. Open Nimiq Pay on your
          phone, go to Mini Apps, and load this page from the Custom URL field.
          The daily question stays readable, but picking needs the wallet.
        </p>
      </div>

      <main class="card-stack">
        <QuestionCard
          :question="todayData?.today ?? null"
          :provider-ready="providerState === 'ready'"
          :connected="connectDone"
          :pick-loading="pickFlow.loading"
          :pick-side="pickFlow.side"
          :pick-error="pickFlow.error"
          :api-error="apiError"
          :api-loading="apiLoading"
          @pick="submitPick"
          @connect="connectWallet"
        />

        <RecentCard :recent="todayData?.recent ?? null" :me="todayData?.me ?? null" />

        <details class="foundation">
          <summary>Foundation tests</summary>
          <div class="card-stack">
            <ActionCard
              step="Step 1"
              title="Connect wallet"
              description="Link your Nimiq Pay wallet to NimPulse."
              :button-label="connectButtonLabel"
              :button-variant="connectDone ? 'danger' : 'primary'"
              :status="connectChip"
              :loading="connectState.loading"
              :disabled="providerState !== 'ready'"
              :error="connectState.error"
              :has-result="connectDone"
              :helper="connectDone ? 'Disconnects NimPulse and clears this test session.' : null"
              :pulse="connectState.pulse"
              @submit="handleConnectAction"
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
              :button-label="signButtonLabel"
              :status="signChip"
              :loading="signState.loading"
              :disabled="providerState !== 'ready'"
              :button-disabled="!connectDone || signDone"
              :error="signState.error"
              :has-result="signDone"
              :pulse="signState.pulse"
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
              :button-label="sendButtonLabel"
              :status="sendChip"
              :loading="sendState.loading"
              :disabled="providerState !== 'ready'"
              :button-disabled="!connectDone || sendDone"
              :error="sendState.error"
              :has-result="sendDone"
              :pulse="sendState.pulse"
              pulse-money
              @submit="sendTestTransaction"
            >
              <template v-if="sendState.hash">
                <span class="result-label">Transaction hash</span>
                <div class="hash-row">
                  <span class="result-value mono gold" :title="sendState.hash">
                    {{ truncateMiddle(sendState.hash, 10, 6) }}
                  </span>
                  <button class="btn btn-ghost" type="button" @click="copyHash">
                    {{ copied ? 'Copied' : 'Copy' }}
                  </button>
                </div>
              </template>
            </ActionCard>
          </div>
        </details>
      </main>
    </div>

    <WalletSheet
      v-if="walletSheetOpen && connectState.address"
      :address="connectState.address"
      @close="walletSheetOpen = false"
      @disconnect="disconnectSession"
    />
  </div>
</template>
