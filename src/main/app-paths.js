import { app } from 'electron'
import { join } from 'node:path'

/** 用户数据根目录（与 appId 对齐，升级不丢） */
export function getAppDataDir() {
  return join(app.getPath('appData'), 'com.taotao.golden-monitoring')
}

export function getLedgerFilePath() {
  return join(getAppDataDir(), 'ledger.json')
}

export function getSettingsFilePath() {
  return join(getAppDataDir(), 'settings.json')
}

export function getAlertStateFilePath() {
  return join(getAppDataDir(), 'alert-state.json')
}

export function getLogsDir() {
  return join(getAppDataDir(), 'logs')
}

/** 当天接口日志：api-YYYY-MM-DD.log */
export function getApiLogFilePath(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return join(getLogsDir(), `api-${y}-${m}-${d}.log`)
}
