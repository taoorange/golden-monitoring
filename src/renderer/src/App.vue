<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ChartPanel from './components/ChartPanel.vue'
import LedgerPanel from './components/LedgerPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { initLedger, ledger } from './stores/ledger.js'
import { initSettings, settings } from './stores/settings.js'
import bgCute from '../../assets/imgs/cute.jpg'

const quote = ref(null)
const quoteError = ref('')
const quoteStale = ref(false)
const lastAlertText = ref('')
const showSettings = ref(false)
const settingsBtn = ref(null)
const refreshing = ref(false)

let offQuote = null
let offAlert = null
let offOpenSettings = null

const buyText = computed(() =>
  quote.value?.buyYuan != null ? quote.value.buyYuan.toFixed(2) : '—'
)
const sellText = computed(() =>
  quote.value?.sellYuan != null ? quote.value.sellYuan.toFixed(2) : '—'
)
const sellNum = computed(() =>
  quote.value?.sellYuan != null ? Number(quote.value.sellYuan) : null
)

const statusText = computed(() => {
  if (refreshing.value) return '刷新中…'
  if (quoteError.value) return quoteError.value
  if (quoteStale.value) return '可能非实时'
  return '行情正常'
})

function onQuotePayload(payload) {
  if (payload?.quote) {
    // 换新对象，确保时间戳变化时界面一定更新
    quote.value = { ...payload.quote }
    quoteStale.value = !payload.ok
  }
  if (payload?.ok) {
    quoteError.value = ''
  } else if (!refreshing.value) {
    quoteError.value = payload?.error || '行情失败'
    quoteStale.value = true
  } else if (payload?.error) {
    quoteError.value = payload.error
    quoteStale.value = true
  }
}

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  quoteError.value = ''
  try {
    const result = await window.golden.refreshQuote()
    if (result?.quote) {
      quote.value = { ...result.quote }
      quoteStale.value = !result.ok
    }
    if (result && result.ok === false) {
      quoteError.value = result.error || '刷新失败'
      quoteStale.value = true
    }
  } catch (err) {
    quoteError.value = err?.message || '刷新失败'
    quoteStale.value = true
  } finally {
    refreshing.value = false
  }
}

watch(
  () => settings.pollIntervalSec,
  (sec) => {
    window.golden.setPollInterval(Number(sec))
  }
)

function openSettings() {
  showSettings.value = true
}

function closeSettings() {
  showSettings.value = false
  nextTick(() => settingsBtn.value?.focus())
}

function onKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === ',') {
    event.preventDefault()
    openSettings()
  }
}

onMounted(async () => {
  await initSettings()
  await initLedger()
  offQuote = window.golden.onQuote(onQuotePayload)
  // 提醒已改由主进程后台判定，这里只更新「最近提醒」文案
  offAlert = window.golden.onAlert((payload) => {
    if (payload?.message) lastAlertText.value = payload.message
  })
  offOpenSettings = window.golden.onOpenSettings?.(openSettings) || null
  window.addEventListener('keydown', onKeydown)
  const last = await window.golden.getLastQuote()
  if (last) quote.value = last
  window.golden.setPollInterval(Number(settings.pollIntervalSec))
})

onUnmounted(() => {
  offQuote?.()
  offAlert?.()
  offOpenSettings?.()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'with-bg-image': settings.showBgImage }"
    :data-theme="settings.theme"
    :style="settings.showBgImage ? { '--app-bg-image': `url(${bgCute})` } : undefined"
  >
    <header class="top-bar">
      <div class="brand">
        <span class="spark">✨</span>
        <div>
          <h1>攒金小本本</h1>
          <p class="sub">
            {{ quote?.productName || '如意金积存' }}
            <template v-if="quote?.fetchedAt">
              · 更新 {{ new Date(quote.fetchedAt).toLocaleTimeString() }}
            </template>
          </p>
        </div>
      </div>
      <div class="top-actions">
        <button
          type="button"
          class="chip-btn"
          :disabled="refreshing"
          @click="refreshNow"
        >
          {{ refreshing ? '刷新中…' : '立即刷新' }}
        </button>
        <div
          class="status-pill"
          :class="{ ok: !quoteError && !refreshing, warn: quoteStale || !!quoteError, busy: refreshing }"
        >
          {{ statusText }}
        </div>
        <button
          ref="settingsBtn"
          type="button"
          class="icon-btn"
          title="设置"
          aria-label="打开设置"
          @click="openSettings"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.4.3.6.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
            />
          </svg>
        </button>
      </div>
    </header>

    <div class="quote-row top-quote">
      <div class="quote-card">
        <span class="label">积存价 ♡</span>
        <strong>{{ buyText }}</strong>
      </div>
      <div class="quote-card sell">
        <span class="label">赎回价 ★</span>
        <strong>{{ sellText }}</strong>
      </div>
    </div>

    <main class="layout-l2">
      <ChartPanel />
      <aside class="panel ledger-panel">
        <LedgerPanel v-if="ledger.ready" :sell-yuan="sellNum" />
        <template v-else>
          <div class="panel-title">黄金账本</div>
          <p class="hint">账本加载中…</p>
        </template>
      </aside>
    </main>

    <SettingsDialog
      v-if="showSettings"
      :sell-yuan="sellNum"
      :last-alert-text="lastAlertText"
      @close="closeSettings"
    />
  </div>
</template>

<style scoped lang="scss">
.ledger-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 820px) {
  .ledger-panel {
    min-height: 420px;
    overflow: visible;
  }
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.chip-btn {
  border: 1px dashed var(--color-card-border);
  background: var(--color-panel);
  color: var(--color-accent);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;

  &:disabled {
    opacity: 0.65;
    cursor: wait;
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-card-border);
  border-radius: 12px;
  background: var(--color-panel);
  color: var(--color-accent);
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    border-color: var(--color-accent-soft);
  }
}

.status-pill.warn {
  color: var(--color-danger);
}

.status-pill.busy {
  color: var(--color-accent);
}

.top-quote {
  margin-bottom: 12px;
}
</style>
