<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import ChartPanel from './components/ChartPanel.vue'
import LedgerPanel from './components/LedgerPanel.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { flushLedgerSave, initLedger, ledger } from './stores/ledger.js'
import { initSettings, settings } from './stores/settings.js'
import bgCute from '../../assets/imgs/cute.jpg'
import { version as appVersion } from '../../../package.json'

const quote = ref(null)
const quoteError = ref('')
const quoteStale = ref(false)
const lastAlertText = ref('')
const showSettings = ref(false)
const settingsBtn = ref(null)
const refreshing = ref(false)
/**
 * 积存价 / 赎回价共用的涨跌方向：跟随国内金价（上金所 Au99.99）当日涨跌，
 * up 固定红、down 固定绿，不随主题配色变化
 */
const priceTone = ref('flat')

let offQuote = null
let offAlert = null
let offOpenSettings = null
let offRealtime = null

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

/** 从实时金价（Au99.99 / 黄金 T+D）推导当日涨跌方向 */
function toneFromRealtime(rtQuote) {
  if (!rtQuote) return 'flat'
  const pct = Number(rtQuote.changePct)
  if (Number.isFinite(pct)) return pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  const price = Number(rtQuote.price)
  const prevClose = Number(rtQuote.prevClose)
  if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) {
    return 'flat'
  }
  if (price > prevClose) return 'up'
  if (price < prevClose) return 'down'
  return 'flat'
}

/** 统一入口：更新工行报价 */
function applyQuote(next) {
  if (!next) return
  quote.value = { ...next }
}

function onQuotePayload(payload) {
  if (payload?.quote) {
    applyQuote(payload.quote)
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
      applyQuote(result.quote)
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

function onPageHide() {
  flushLedgerSave()
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
  window.addEventListener('pagehide', onPageHide)

  const realtime = await window.golden.getRealtime().catch(() => null)
  if (realtime?.quote) priceTone.value = toneFromRealtime(realtime.quote)
  offRealtime = window.golden.onRealtime?.((payload) => {
    if (payload?.quote) priceTone.value = toneFromRealtime(payload.quote)
  }) || null

  const last = await window.golden.getLastQuote()
  if (last) applyQuote(last)
  window.golden.setPollInterval(Number(settings.pollIntervalSec))
})

onUnmounted(() => {
  offQuote?.()
  offAlert?.()
  offOpenSettings?.()
  offRealtime?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pagehide', onPageHide)
  flushLedgerSave()
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
      <div class="quote-card" :class="priceTone">
        <span class="label">积存价 ♡</span>
        <strong>
          {{ buyText }}
          <span v-if="priceTone !== 'flat'" class="trend-arrow" :class="priceTone">
            {{ priceTone === 'up' ? '↑' : '↓' }}
          </span>
        </strong>
      </div>
      <div class="quote-card sell" :class="priceTone">
        <span class="label">赎回价 ★</span>
        <strong>
          {{ sellText }}
          <span v-if="priceTone !== 'flat'" class="trend-arrow" :class="priceTone">
            {{ priceTone === 'up' ? '↑' : '↓' }}
          </span>
        </strong>
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

    <span class="app-version" aria-hidden="true">v{{ appVersion }}</span>
  </div>
</template>

<style scoped lang="scss">
.app-version {
  position: fixed;
  right: 12px;
  bottom: 8px;
  z-index: 5;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--color-text-muted);
  opacity: 0.45;
  pointer-events: none;
  user-select: none;
}

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

// 价格后的涨跌箭头：上涨红色向上浮动，下跌绿色向下浮动
.trend-arrow {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.72em;
  font-weight: 800;
  line-height: 1;
  vertical-align: 0.08em;
  will-change: transform;

  &.up {
    color: #dc2626;
    animation: arrow-up 1.1s ease-in-out infinite;
  }

  &.down {
    color: #16a34a;
    animation: arrow-down 1.1s ease-in-out infinite;
  }
}

@keyframes arrow-up {
  0%,
  100% {
    transform: translateY(2px);
    opacity: 0.8;
  }

  50% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@keyframes arrow-down {
  0%,
  100% {
    transform: translateY(-2px);
    opacity: 0.8;
  }

  50% {
    transform: translateY(5px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trend-arrow {
    animation: none;
  }
}
</style>
