import { computed, reactive, watch } from 'vue'

const LEGACY_KEY = 'golden-monitoring:ledger'

export const ledger = reactive({
  entries: [],
  filePath: '',
  ready: false
})

let saveTimer = null
let persistEnabled = false

function readLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function scheduleSave() {
  if (!persistEnabled || !window.golden?.saveLedger) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const res = await window.golden.saveLedger(ledger.entries)
      if (res?.path) ledger.filePath = res.path
    } catch (err) {
      console.error('保存账本失败', err)
    }
  }, 200)
}

/** 首次无账本时的默认攒金（可改可删） */
function createDefaultEntry() {
  const grams = 135
  const unitPrice = 1125.11
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    grams,
    unitPrice,
    totalPrice: Number((grams * unitPrice).toFixed(2)),
    note: '默认持仓',
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 从磁盘加载；若为空则迁 localStorage；仍空则写入默认 135g @ 1125.11。
 */
export async function initLedger() {
  const loaded = await window.golden.loadLedger()
  ledger.filePath = loaded.path || (await window.golden.getLedgerPath())

  let entries = loaded.entries || []
  if (!entries.length) {
    const legacy = readLegacyLocalStorage()
    if (legacy.length) {
      entries = legacy
      await window.golden.saveLedger(entries)
      localStorage.removeItem(LEGACY_KEY)
    } else {
      entries = [createDefaultEntry()]
      await window.golden.saveLedger(entries)
    }
  }

  ledger.entries = entries
  persistEnabled = true
  ledger.ready = true
}

watch(
  () => ledger.entries,
  () => scheduleSave(),
  { deep: true }
)

export const summary = computed(() => {
  let grams = 0
  let cost = 0
  for (const e of ledger.entries) {
    const g = Number(e.grams) || 0
    const t = Number(e.totalPrice) || 0
    grams += g
    cost += t
  }
  const avg = grams > 0 ? cost / grams : null
  return { grams, cost, avg }
})

export function addEntry({ grams, unitPrice, totalPrice, note, createdAt }) {
  const now = new Date().toISOString()
  const entry = {
    id: crypto.randomUUID(),
    grams: Number(grams),
    unitPrice: Number(unitPrice),
    totalPrice: Number(totalPrice),
    note: note || '',
    createdAt: createdAt || now,
    updatedAt: now
  }
  ledger.entries.unshift(entry)
  return entry
}

export function updateEntry(id, patch) {
  const row = ledger.entries.find((e) => e.id === id)
  if (!row) return
  Object.assign(row, patch, { updatedAt: new Date().toISOString() })
}

export function removeEntry(id) {
  const i = ledger.entries.findIndex((e) => e.id === id)
  if (i >= 0) ledger.entries.splice(i, 1)
}
