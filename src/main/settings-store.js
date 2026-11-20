import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAlertStateFilePath, getSettingsFilePath } from './app-paths.js'

export const SETTINGS_DEFAULTS = {
  notifyEnabled: true,
  nearGapYuan: 5,
  riseStepYuan: 1,
  dropStepYuan: 3,
  pollIntervalSec: 10,
  theme: 'pastel-dream',
  showBgImage: true,
  feishuEnabled: false,
  feishuWebhook: '',
  feishuSecret: ''
}

export const ALERT_STATE_DEFAULTS = {
  nearArmed: false,
  maxRiseTier: -1,
  dropAnchorSell: null,
  // 0 = 尚未触发过「满 1 步长」降价档；勿用 -1，否则会误报 0.00 元跌幅
  maxDropTier: 0
}

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8')
    return { data: { ...fallback, ...JSON.parse(raw) }, exists: true, path }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { data: { ...fallback }, exists: false, path }
    throw err
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
  return { ok: true, path }
}

export async function loadSettings() {
  const { data, exists, path } = await readJson(getSettingsFilePath(), SETTINGS_DEFAULTS)
  return { settings: data, exists, path }
}

export async function saveSettings(partial) {
  const { settings } = await loadSettings()
  const next = { ...settings, ...partial }
  await writeJson(getSettingsFilePath(), next)
  return { ok: true, settings: next }
}

export async function loadAlertState() {
  const { data, path } = await readJson(getAlertStateFilePath(), ALERT_STATE_DEFAULTS)
  return { state: data, path }
}

export async function saveAlertState(state) {
  const next = { ...ALERT_STATE_DEFAULTS, ...state }
  await writeJson(getAlertStateFilePath(), next)
  return { ok: true, state: next }
}
