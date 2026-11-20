<script setup>
import { computed, nextTick, onUnmounted, reactive, ref } from 'vue'
import { addEntry, ledger, summary, updateEntry } from '../stores/ledger.js'

const props = defineProps({
  sellYuan: { type: Number, default: null }
})

const moneyFmt = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})
const gramFmt = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 3
})

const formOpen = ref(false)
const editingId = ref(null)
const pricingMode = ref('unit')
const gramsInput = ref(null)
const formEl = ref(null)
const feedback = ref(null)
let feedbackTimer = null

const form = reactive({
  date: todayInputValue(),
  grams: '',
  unitPrice: '',
  totalPrice: '',
  note: ''
})

const sortedEntries = computed(() =>
  [...ledger.entries].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))
)

const hasPosition = computed(() => summary.value.grams > 0)

const marketValue = computed(() => {
  const sell = Number(props.sellYuan)
  if (!hasPosition.value || !Number.isFinite(sell) || sell <= 0) return null
  return summary.value.grams * sell
})

const pnl = computed(() => {
  if (marketValue.value == null) return null
  return marketValue.value - summary.value.cost
})

const pnlPct = computed(() => {
  if (pnl.value == null || !(summary.value.avg > 0)) return null
  return ((Number(props.sellYuan) - summary.value.avg) / summary.value.avg) * 100
})

const pnlTone = computed(() => {
  if (pnl.value == null) return 'flat'
  if (pnl.value > 0) return 'up'
  if (pnl.value < 0) return 'down'
  return 'flat'
})

const canSubmit = computed(() => {
  const grams = Number(form.grams)
  const unitPrice = Number(form.unitPrice)
  const totalPrice = Number(form.totalPrice)
  return grams > 0 && unitPrice > 0 && totalPrice > 0
})

function pad2(value) {
  return String(value).padStart(2, '0')
}

function todayInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function timeOf(iso) {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

function formatDateInput(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? todayInputValue() : todayInputValue(d)
}

function dateToIso(value) {
  if (!value) return new Date().toISOString()
  if (value === todayInputValue()) return new Date().toISOString()
  const d = new Date(`${value}T12:00:00`)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function entryDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return d.getFullYear() === new Date().getFullYear()
    ? md
    : `${d.getFullYear()}-${md}`
}

function entryDateTitle(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? `¥${moneyFmt.format(n)}` : '—'
}

function signedMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : '-'}¥${moneyFmt.format(Math.abs(n))}`
}

function price(value) {
  const n = Number(value)
  return Number.isFinite(n) ? `¥${moneyFmt.format(n)}` : '—'
}

function grams(value) {
  const n = Number(value)
  return Number.isFinite(n) ? `${gramFmt.format(n)}g` : '—'
}

function percent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function calcTotal() {
  const grams = Number(form.grams)
  const unitPrice = Number(form.unitPrice)
  return grams > 0 && unitPrice > 0 ? (grams * unitPrice).toFixed(2) : ''
}

function calcUnit() {
  const grams = Number(form.grams)
  const totalPrice = Number(form.totalPrice)
  return grams > 0 && totalPrice > 0 ? (totalPrice / grams).toFixed(2) : ''
}

function syncDependent() {
  if (pricingMode.value === 'unit') form.totalPrice = calcTotal()
  else form.unitPrice = calcUnit()
}

function setMode(mode) {
  if (pricingMode.value === mode) return
  pricingMode.value = mode
  syncDependent()
}

function resetForm() {
  form.date = todayInputValue()
  form.grams = ''
  form.unitPrice = ''
  form.totalPrice = ''
  form.note = ''
  pricingMode.value = 'unit'
  editingId.value = null
}

async function focusForm() {
  await nextTick()
  formEl.value?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  gramsInput.value?.focus()
}

function openCreate() {
  resetForm()
  formOpen.value = true
  focusForm()
}

function startEdit(row) {
  editingId.value = row.id
  form.date = formatDateInput(row.createdAt)
  form.grams = String(row.grams ?? '')
  form.unitPrice = String(row.unitPrice ?? '')
  form.totalPrice = String(row.totalPrice ?? '')
  form.note = row.note || ''
  pricingMode.value = 'unit'
  formOpen.value = true
  focusForm()
}

function closeForm() {
  formOpen.value = false
  resetForm()
}

function showFeedback(text, undo = null) {
  if (feedbackTimer) clearTimeout(feedbackTimer)
  feedback.value = { text, undo }
  feedbackTimer = setTimeout(() => {
    feedback.value = null
    feedbackTimer = null
  }, 5000)
}

function runUndo() {
  const undo = feedback.value?.undo
  if (undo) undo()
}

function submit() {
  if (!canSubmit.value) return

  const payload = {
    grams: Number(form.grams),
    unitPrice: Number(form.unitPrice),
    totalPrice: Number(form.totalPrice),
    note: form.note.trim()
  }

  if (editingId.value) {
    const original = ledger.entries.find((e) => e.id === editingId.value)
    if (original && formatDateInput(original.createdAt) !== form.date) {
      payload.createdAt = dateToIso(form.date)
    }
    updateEntry(editingId.value, payload)
    showFeedback('已保存修改')
  } else {
    addEntry({ ...payload, createdAt: dateToIso(form.date) })
    showFeedback('已记一笔')
  }

  closeForm()
}

function deleteEntry(row) {
  const index = ledger.entries.findIndex((e) => e.id === row.id)
  if (index < 0) return

  const [removed] = ledger.entries.splice(index, 1)
  if (editingId.value === row.id) closeForm()

  showFeedback('已删除 1 笔记录', () => {
    ledger.entries.splice(Math.min(index, ledger.entries.length), 0, removed)
    showFeedback('已撤销删除')
  })
}

onUnmounted(() => {
  if (feedbackTimer) clearTimeout(feedbackTimer)
})
</script>

<template>
  <div class="ledger">
    <div class="ledger-head">
      <div>
        <div class="ledger-title">黄金账本</div>
        <p class="hint">按当前赎回价估算浮盈亏</p>
      </div>
      <button
        v-if="!formOpen"
        type="button"
        class="add-btn"
        @click="openCreate"
      >
        + 记一笔
      </button>
    </div>

    <section class="overview" aria-label="持仓概览">
      <div class="overview-top">
        <div class="market">
          <span class="k">总市值</span>
          <strong>{{ marketValue == null ? '—' : money(marketValue) }}</strong>
        </div>
        <div class="pnl" :class="pnlTone">
          <span class="k">浮盈亏</span>
          <strong>{{ pnl == null ? '—' : signedMoney(pnl) }}</strong>
          <em v-if="pnlPct != null">{{ percent(pnlPct) }}</em>
        </div>
      </div>
      <p class="calc-hint">
        <template v-if="marketValue != null">
          按当前赎回价 {{ price(sellYuan) }}/克估算
        </template>
        <template v-else-if="!hasPosition">还没有持仓，先记一笔吧</template>
        <template v-else>等待赎回价刷新…</template>
      </p>
      <div class="stats">
        <div>
          <span class="k">持仓克数</span>
          <strong>{{ grams(summary.grams) }}</strong>
        </div>
        <div>
          <span class="k">持仓均价</span>
          <strong>{{ summary.avg == null ? '—' : `${price(summary.avg)}/g` }}</strong>
        </div>
        <div>
          <span class="k">总成本</span>
          <strong>{{ money(summary.cost) }}</strong>
        </div>
      </div>
    </section>

    <form
      v-if="formOpen"
      ref="formEl"
      class="entry-form"
      @submit.prevent="submit"
      @keydown.esc="closeForm"
    >
      <div class="form-head">
        <strong>{{ editingId ? '编辑记录' : '记一笔攒金' }}</strong>
        <span class="hint">按单价或总价录入</span>
      </div>

      <div class="form-grid">
        <label>
          日期
          <input v-model="form.date" type="date" :max="todayInputValue()" />
        </label>
        <label>
          克数
          <input
            ref="gramsInput"
            v-model="form.grams"
            type="number"
            min="0"
            step="0.0001"
            placeholder="0.00"
            @input="syncDependent"
          />
        </label>

        <div class="mode-row">
          <span class="k">录入方式</span>
          <div class="mode-switch" role="group" aria-label="录入方式">
            <button
              type="button"
              :class="{ active: pricingMode === 'unit' }"
              @click="setMode('unit')"
            >
              按单价
            </button>
            <button
              type="button"
              :class="{ active: pricingMode === 'total' }"
              @click="setMode('total')"
            >
              按总价
            </button>
          </div>
        </div>

        <label>
          单价（元/克）
          <input
            v-model="form.unitPrice"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            :readonly="pricingMode === 'total'"
            :class="{ auto: pricingMode === 'total' }"
            @input="syncDependent"
          />
        </label>
        <label>
          总价（元）
          <input
            v-model="form.totalPrice"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            :readonly="pricingMode === 'unit'"
            :class="{ auto: pricingMode === 'unit' }"
            @input="syncDependent"
          />
        </label>

        <label class="note-field">
          备注
          <input
            v-model="form.note"
            type="text"
            maxlength="40"
            placeholder="可选，如：工行如意金"
          />
        </label>
      </div>

      <div class="form-actions">
        <button type="button" class="btn" @click="closeForm">取消</button>
        <button
          type="submit"
          class="btn primary"
          :disabled="!canSubmit"
          :title="canSubmit ? '' : '填写克数，并输入单价或总价'"
        >
          {{ editingId ? '保存修改' : '保存' }}
        </button>
      </div>
    </form>

    <div v-else class="entries">
      <div class="entries-head">
        <span>持仓明细</span>
        <span class="count">{{ sortedEntries.length }} 笔</span>
      </div>

      <ul v-if="sortedEntries.length" class="list">
        <li v-for="row in sortedEntries" :key="row.id" class="entry">
          <span class="date-badge" :title="entryDateTitle(row.createdAt)">
            {{ entryDate(row.createdAt) }}
          </span>
          <div class="entry-body">
            <div class="entry-line">
              <strong>{{ grams(row.grams) }}</strong>
              <span class="unit">@ {{ price(row.unitPrice) }}/g</span>
              <span class="total">{{ money(row.totalPrice) }}</span>
            </div>
            <div class="entry-sub">
              <span class="note" :title="row.note || ''">{{ row.note || '无备注' }}</span>
              <span class="entry-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="编辑"
                  aria-label="编辑"
                  @click="startEdit(row)"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn danger"
                  title="删除"
                  aria-label="删除"
                  @click="deleteEntry(row)"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                    />
                  </svg>
                </button>
              </span>
            </div>
          </div>
        </li>
      </ul>

      <div v-else class="empty">
        <p>还没有攒金记录</p>
        <button type="button" class="btn primary" @click="openCreate">
          记下第一笔
        </button>
      </div>
    </div>

    <div v-if="feedback" class="feedback" role="status" aria-live="polite">
      <span>{{ feedback.text }}</span>
      <button v-if="feedback.undo" type="button" @click="runUndo">撤销</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ledger {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.ledger-head {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;

  .hint {
    margin: 0;
  }
}

.ledger-title {
  font-size: 14px;
  font-weight: 800;
  margin-bottom: 2px;
}

.add-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  padding: 7px 13px;
  background: var(--color-accent-soft);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-accent-soft) 35%, transparent);

  &:hover {
    filter: brightness(1.05);
  }
}

.overview {
  flex-shrink: 0;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--color-card-border);
  border-radius: 14px;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--color-panel) 88%, var(--color-accent-soft) 12%),
    color-mix(in srgb, var(--color-panel) 68%, var(--color-accent-soft) 32%)
  );
}

.overview-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}

.k {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.market strong {
  display: block;
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.pnl {
  text-align: right;

  strong {
    display: block;
    font-size: 18px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  em {
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  &.up {
    color: var(--color-sell);
  }

  &.down {
    color: var(--color-danger);
  }

  &.flat {
    color: var(--color-text-muted);
  }
}

.calc-hint {
  margin: 7px 0 10px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;

  > div {
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--color-card-border) 55%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-panel) 78%, var(--color-accent-soft) 22%);
  }

  strong {
    display: block;
    overflow: hidden;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.entries {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.entries-head {
  display: flex;
  flex-shrink: 0;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 700;

  .count {
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted);
  }
}

.list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 2px 0 0;
  overflow: auto;
  list-style: none;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent-soft) 50%, transparent);
  }
}

.entry {
  display: flex;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--color-pink-soft);

  &:last-child {
    border-bottom: none;
  }

  &:hover,
  &:focus-within {
    .entry-actions {
      opacity: 1;
    }
  }
}

.date-badge {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 3px 5px;
  border: 1px solid color-mix(in srgb, var(--color-card-border) 55%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-panel) 70%, var(--color-accent-soft) 30%);
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.entry-body {
  flex: 1;
  min-width: 0;
}

.entry-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;

  strong {
    font-size: 14px;
  }

  .unit {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .total {
    margin-left: auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
}

.entry-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-muted);

  .note {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.entry-actions {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-accent-soft) 22%, transparent);
    color: var(--color-accent);
  }

  &.danger:hover {
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    color: var(--color-danger);
  }
}

@media (hover: none) {
  .entry-actions {
    opacity: 1;
  }
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 12px;
  border: 1px dashed var(--color-card-border);
  border-radius: 14px;
  color: var(--color-text-muted);
  text-align: center;

  p {
    margin: 0;
    font-size: 12px;
  }
}

.entry-form {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--color-card-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-panel) 86%, var(--color-accent-soft) 14%);

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent-soft) 50%, transparent);
  }
}

.form-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;

  strong {
    font-size: 13px;
  }

  .hint {
    margin: 0;
    font-size: 10px;
  }
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;

  label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    font-size: 11px;
    color: var(--color-text-muted);
  }

  input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--color-card-border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-panel) 85%, white 15%);
    color: var(--color-text);
    font-size: 12px;
    font-variant-numeric: tabular-nums;

    &:focus {
      outline: 2px solid color-mix(in srgb, var(--color-accent-soft) 55%, transparent);
      outline-offset: 1px;
    }

    &.auto {
      background: color-mix(in srgb, var(--color-panel) 70%, var(--color-accent-soft) 30%);
      color: var(--color-text-muted);
    }
  }

  .note-field {
    grid-column: 1 / -1;
  }
}

.mode-row {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  .k {
    margin: 0;
  }
}

.mode-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-panel) 72%, var(--color-accent-soft) 28%);

  button {
    padding: 4px 10px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 11px;
    cursor: pointer;

    &.active {
      background: var(--color-accent-soft);
      color: #fff;
      font-weight: 700;
    }
  }
}

.form-actions {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
  padding-bottom: 2px;
  background: color-mix(in srgb, var(--color-panel) 86%, var(--color-accent-soft) 14%);
}

.btn {
  padding: 7px 14px;
  border: 1px solid var(--color-card-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-panel) 85%, white 15%);
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;

  &.primary {
    border-color: transparent;
    background: var(--color-accent-soft);
    color: #fff;
    font-weight: 700;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.feedback {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--color-card-border) 60%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-accent-soft) 18%, transparent);
  font-size: 11px;

  button {
    padding: 0;
    border: none;
    background: none;
    color: var(--color-accent);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }
}

@media (max-width: 520px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .mode-row {
    grid-column: 1;
  }
}
</style>
