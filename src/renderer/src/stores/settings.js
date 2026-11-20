import { reactive, watch } from 'vue'

const LEGACY_KEY = 'golden-monitoring:settings'

export const SETTINGS_DEFAULTS = {
  notifyEnabled: true,
  nearGapYuan: 5,
  riseStepYuan: 1,
  dropStepYuan: 3,
  pollIntervalSec: 10,
  theme: 'pastel-dream',
  showBgImage: true
}

const THEME_IDS = new Set([
  'pastel-dream',
  'night-neon',
  'mist-blue',
  'warm-sand',
  'celadon',
  'business-slate'
])

export const settings = reactive({ ...SETTINGS_DEFAULTS })

let persistEnabled = false
let saveTimer = null

function readLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return null
  }
}

function clampNumber(value, min, max, fallback) {
  if (value === '' || value == null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 收敛历史数据里可能出现的空值/越界值 */
export function normalizeSettings(target = settings) {
  target.nearGapYuan = Number(clampNumber(target.nearGapYuan, 0.1, 1000, 5).toFixed(2))
  target.riseStepYuan = Number(clampNumber(target.riseStepYuan, 0.1, 1000, 1).toFixed(2))
  target.dropStepYuan = Number(clampNumber(target.dropStepYuan, 0.1, 1000, 3).toFixed(2))
  target.pollIntervalSec = Math.round(clampNumber(target.pollIntervalSec, 5, 60, 10))
  if (!THEME_IDS.has(target.theme)) target.theme = SETTINGS_DEFAULTS.theme
  return target
}

function scheduleSave() {
  if (!persistEnabled || !window.golden?.saveSettings) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await window.golden.saveSettings({ ...settings })
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ ...settings }))
    } catch (err) {
      console.error('保存设置失败', err)
    }
  }, 200)
}

/**
 * 以磁盘设置为准；磁盘没有则用 localStorage 迁移一次。
 */
export async function initSettings() {
  const loaded = await window.golden.loadSettings()
  if (!loaded.exists) {
    const legacy = readLegacyLocalStorage()
    Object.assign(settings, legacy || loaded.settings)
  } else {
    Object.assign(settings, loaded.settings)
  }
  normalizeSettings(settings)
  persistEnabled = true
  await window.golden.saveSettings({ ...settings })
  return settings
}

watch(settings, () => scheduleSave(), { deep: true })
