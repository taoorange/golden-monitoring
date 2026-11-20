<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { settings } from '../stores/settings.js'
import { summary } from '../stores/ledger.js'

const props = defineProps({
  sellYuan: { type: Number, default: null },
  lastAlertText: { type: String, default: '' }
})

const emit = defineEmits(['close'])

const closeBtn = ref(null)
const testState = ref('')
let testTimer = null

const moneyFmt = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const avg = computed(() => summary.value.avg)
const sell = computed(() => Number(props.sellYuan))
const hasSell = computed(() => Number.isFinite(sell.value) && sell.value > 0)

const distance = computed(() => {
  if (avg.value == null || !hasSell.value) return null
  return sell.value - avg.value
})

const snapshotText = computed(() => {
  if (avg.value == null) return '暂无持仓，记账后会显示均价与距离'
  if (!hasSell.value) return `当前均价 ${money(avg.value)}，等待赎回价刷新…`
  const d = distance.value
  return `当前均价 ${money(avg.value)} · 赎回价 ${money(sell.value)} · 距均价 ${
    d >= 0 ? '+' : '-'
  }${plain(Math.abs(d))} 元/克`
})

const sampleAvg = computed(() => (avg.value == null ? 1125 : avg.value))

const nearExample = computed(() => {
  const gap = safeNumber(settings.nearGapYuan, 5)
  return `示例：均价 ${plain(sampleAvg.value)} → 赎回价 ${plain(
    sampleAvg.value - gap
  )}–${plain(sampleAvg.value)} 时提醒一次`
})

const riseExample = computed(() => {
  const step = safeNumber(settings.riseStepYuan, 1)
  return `示例：赎回价到 ${plain(sampleAvg.value + step)}、${plain(
    sampleAvg.value + step * 2
  )}… 逐档提醒`
})

const dropExample = computed(() => {
  const step = safeNumber(settings.dropStepYuan, 3)
  const high = 800
  return `示例：近期高点 ${plain(high)} → ${plain(
    Math.max(0, high - step)
  )}、${plain(Math.max(0, high - step * 2))}… 提醒`
})

function plain(value) {
  const n = Number(value)
  return Number.isFinite(n) ? moneyFmt.format(n) : '—'
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? `¥${moneyFmt.format(n)}` : '—'
}

function safeNumber(value, fallback) {
  if (value === '' || value == null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampNumber(key, min, max, fallback) {
  const raw = settings[key]
  const n = raw === '' || raw == null ? NaN : Number(raw)
  let next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  if (key === 'pollIntervalSec') next = Math.round(next)
  else next = Number(next.toFixed(2))
  settings[key] = next
}

function normalizeAll() {
  clampNumber('nearGapYuan', 0.1, 1000, 5)
  clampNumber('riseStepYuan', 0.1, 1000, 1)
  clampNumber('dropStepYuan', 0.1, 1000, 3)
  clampNumber('pollIntervalSec', 5, 60, 10)
}

async function testNotification() {
  testState.value = ''
  try {
    const res = await window.golden.notify({
      title: '攒金小本本',
      body: '这是一条测试通知'
    })
    testState.value = res?.ok ? '已发送' : '系统通知不可用'
  } catch {
    testState.value = '发送失败'
  }
  if (testTimer) clearTimeout(testTimer)
  testTimer = setTimeout(() => {
    testState.value = ''
    testTimer = null
  }, 3000)
}

function close() {
  normalizeAll()
  emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  closeBtn.value?.focus()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (testTimer) clearTimeout(testTimer)
})
</script>

<template>
  <div class="settings-overlay" @click.self="close">
    <section
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <header class="settings-head">
        <div>
          <h2 id="settings-title">设置</h2>
          <p>修改会自动保存</p>
        </div>
        <button
          ref="closeBtn"
          type="button"
          class="close-btn"
          aria-label="关闭设置"
          @click="close"
        >
          ✕
        </button>
      </header>

      <div class="settings-body">
        <section class="settings-section">
          <h3>通知与提醒</h3>

          <div class="setting-row">
            <div class="setting-text">
              <label>系统通知</label>
              <p>关闭后只在应用内记录提醒，不再弹系统通知。</p>
            </div>
            <div class="setting-control">
              <button type="button" class="ghost-btn" @click="testNotification">
                测试通知
              </button>
              <label class="switch">
                <input v-model="settings.notifyEnabled" type="checkbox" />
                <span class="switch-track" aria-hidden="true" />
              </label>
            </div>
          </div>
          <p v-if="testState" class="test-state">{{ testState }}</p>

          <div class="setting-row">
            <div class="setting-text">
              <label for="near-gap">接近均价提醒</label>
              <p>
                赎回价进入「均价 − 阈值」到均价之间时提醒一次；跌回阈值以下，或涨到均价以上后，重新准备下一次。
              </p>
              <small>{{ nearExample }}</small>
            </div>
            <div class="setting-control">
              <div class="number-field">
                <input
                  id="near-gap"
                  v-model.number="settings.nearGapYuan"
                  type="number"
                  min="0.1"
                  step="0.1"
                  @change="clampNumber('nearGapYuan', 0.1, 1000, 5)"
                />
                <span>元/克</span>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-text">
              <label for="rise-step">上涨分档提醒</label>
              <p>
                赎回价 ≥ 均价后，每上涨 X 元/克提醒一次，只提醒新到的最高档；跌回均价 − 接近阈值以下后档位重置。
              </p>
              <small>{{ riseExample }}</small>
            </div>
            <div class="setting-control">
              <div class="number-field">
                <input
                  id="rise-step"
                  v-model.number="settings.riseStepYuan"
                  type="number"
                  min="0.1"
                  step="0.1"
                  @change="clampNumber('riseStepYuan', 0.1, 1000, 1)"
                />
                <span>元/克</span>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-text">
              <label for="drop-step">下跌分档提醒</label>
              <p>
                以近期高点为锚，累计下跌每 X 元/克提醒一次；价格创新高后，锚点和档位重置。
              </p>
              <small>{{ dropExample }}</small>
            </div>
            <div class="setting-control">
              <div class="number-field">
                <input
                  id="drop-step"
                  v-model.number="settings.dropStepYuan"
                  type="number"
                  min="0.1"
                  step="0.1"
                  @change="clampNumber('dropStepYuan', 0.1, 1000, 3)"
                />
                <span>元/克</span>
              </div>
            </div>
          </div>

          <div class="snapshot">
            {{ snapshotText }}
          </div>

          <div class="setting-row readonly">
            <div class="setting-text">
              <label>最近一次提醒</label>
              <p>{{ lastAlertText || '暂无提醒记录' }}</p>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <h3>行情刷新</h3>

          <div class="setting-row">
            <div class="setting-text">
              <label for="poll-interval">工行报价刷新</label>
              <p>
                工行如意金积存报价的刷新频率，5–60 秒；请求失败会自动退避。
              </p>
              <small>右侧实时金价曲线固定 1 秒刷新，不受此项影响。</small>
            </div>
            <div class="setting-control">
              <div class="number-field">
                <input
                  id="poll-interval"
                  v-model.number="settings.pollIntervalSec"
                  type="number"
                  min="5"
                  max="60"
                  step="1"
                  @change="clampNumber('pollIntervalSec', 5, 60, 10)"
                />
                <span>秒</span>
              </div>
            </div>
          </div>

          <div class="setting-row readonly">
            <div class="setting-text">
              <label>实时金价曲线</label>
              <p>交易时段每秒刷新；窗口隐藏或休市时自动降频。</p>
            </div>
            <span class="badge">1 秒</span>
          </div>
        </section>

        <section class="settings-section">
          <h3>外观</h3>

          <div class="setting-row">
            <div class="setting-text">
              <label for="theme">主题</label>
              <p>只影响界面配色，不影响提醒和行情。</p>
            </div>
            <div class="setting-control">
              <select id="theme" v-model="settings.theme">
                <optgroup label="浅色">
                  <option value="pastel-dream">粉紫梦核</option>
                  <option value="mist-blue">晨雾蓝</option>
                  <option value="warm-sand">暖砂金</option>
                  <option value="celadon">青瓷</option>
                  <option value="business-slate">商务石墨</option>
                </optgroup>
                <optgroup label="深色">
                  <option value="night-neon">夜街霓虹</option>
                </optgroup>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-text">
              <label>显示背景图</label>
              <p>只影响外观；关闭后使用纯色渐变背景。</p>
            </div>
            <div class="setting-control">
              <label class="switch">
                <input v-model="settings.showBgImage" type="checkbox" />
                <span class="switch-track" aria-hidden="true" />
              </label>
            </div>
          </div>
        </section>
      </div>

      <footer class="settings-foot">
        <span>设置会自动保存</span>
        <button type="button" class="done-btn" @click="close">完成</button>
      </footer>
    </section>
  </div>
</template>

<style scoped lang="scss">
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-overlay);
  backdrop-filter: blur(4px);
}

.settings-dialog {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 48px));
  max-height: min(82vh, 760px);
  overflow: hidden;
  border: 2px solid var(--color-panel-border);
  border-radius: 20px;
  background: var(--color-panel);
  box-shadow: 0 24px 80px rgba(2, 6, 23, 0.35);
  backdrop-filter: blur(24px);
}

.settings-head {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px 12px;

  h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--color-text);
  }

  p {
    margin: 3px 0 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-card-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-panel) 80%, white 20%);
  color: var(--color-text-muted);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    color: var(--color-accent);
    border-color: var(--color-accent-soft);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-soft);
    outline-offset: 2px;
  }
}

.settings-body {
  flex: 1;
  min-height: 0;
  padding: 0 22px 8px;
  overflow: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent-soft) 45%, transparent);
  }
}

.settings-section {
  padding-top: 16px;

  & + & {
    margin-top: 4px;
    border-top: 1px solid color-mix(in srgb, var(--color-card-border) 45%, transparent);
  }

  h3 {
    margin: 0 0 2px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: var(--color-accent);
  }
}

.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px dashed color-mix(in srgb, var(--color-pink-soft) 60%, transparent);

  &:last-child {
    border-bottom: none;
  }

  &.readonly {
    align-items: center;
  }
}

.setting-text {
  min-width: 0;

  label {
    display: block;
    margin-bottom: 3px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text);
  }

  p {
    margin: 0;
    font-size: 11px;
    line-height: 1.55;
    color: var(--color-text-muted);
  }

  small {
    display: block;
    margin-top: 4px;
    font-size: 10px;
    line-height: 1.45;
    color: color-mix(in srgb, var(--color-text-muted) 78%, transparent);
  }
}

.setting-control {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.number-field {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--color-card-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-panel) 82%, white 18%);

  input {
    width: 68px;
    padding: 7px 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  span {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--color-text-muted);
  }
}

select {
  min-width: 132px;
  padding: 7px 10px;
  border: 1px solid var(--color-card-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-panel) 82%, white 18%);
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
}

.ghost-btn {
  padding: 6px 10px;
  border: 1px dashed var(--color-card-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-accent);
  font-size: 11px;
  cursor: pointer;

  &:hover {
    border-style: solid;
  }
}

.test-state {
  margin: -4px 0 8px;
  font-size: 10px;
  color: var(--color-text-muted);
  text-align: right;
}

.switch {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: 38px;
  height: 22px;
  cursor: pointer;

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .switch-track {
    position: absolute;
    inset: 0;
    border: 1px solid var(--color-card-border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-panel) 70%, var(--color-accent-soft) 30%);
    transition: background 0.16s ease, border-color 0.16s ease;

    &::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgba(2, 6, 23, 0.22);
      transition: transform 0.16s ease;
    }
  }

  input:checked + .switch-track {
    border-color: transparent;
    background: var(--color-accent-soft);

    &::after {
      transform: translateX(16px);
    }
  }

  input:focus-visible + .switch-track {
    outline: 2px solid color-mix(in srgb, var(--color-accent-soft) 65%, transparent);
    outline-offset: 2px;
  }
}

.snapshot {
  margin: 8px 0 2px;
  padding: 8px 10px;
  border: 1px dashed var(--color-card-border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-panel) 78%, var(--color-accent-soft) 22%);
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.5;
}

.badge {
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent-soft) 22%, transparent);
  color: var(--color-accent);
  font-size: 10px;
  font-weight: 700;
}

.settings-foot {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 22px 16px;
  border-top: 1px solid color-mix(in srgb, var(--color-card-border) 45%, transparent);

  span {
    font-size: 10px;
    color: var(--color-text-muted);
  }
}

.done-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    filter: brightness(1.05);
  }
}

@media (max-width: 560px) {
  .setting-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .setting-control {
    justify-content: flex-start;
  }

  .settings-overlay {
    padding: 12px;
  }

  .settings-dialog {
    width: 100%;
  }
}
</style>
