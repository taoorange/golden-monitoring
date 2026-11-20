import { BrowserWindow } from 'electron'
import { evaluateAlert, evaluateDropAlert, weightedAvgFromEntries } from './alert-rules.js'
import { loadLedgerFile } from './ledger-store.js'
import { showSystemNotification } from './notify.js'
import { sendFeishuBotMessage } from './feishu.js'
import { loadAlertState, loadSettings, saveAlertState } from './settings-store.js'

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const moneyFmt = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

function holdingsLine(entries, sell) {
  let grams = 0
  let cost = 0
  for (const e of entries || []) {
    grams += Number(e.grams) || 0
    cost += Number(e.totalPrice) || 0
  }
  if (!(grams > 0)) return ''
  const avg = cost / grams
  const pnl = grams * sell - cost
  const sign = pnl >= 0 ? '+' : '-'
  return `持仓 ${grams.toFixed(3)}g · 均价 ${moneyFmt.format(avg)} · 浮盈亏 ${sign}¥${moneyFmt.format(
    Math.abs(pnl)
  )}`
}

function buildFeishuText(message, entries, sell) {
  const extra = holdingsLine(entries, sell)
  return extra ? `【攒金小本本】\n${message}\n${extra}` : `【攒金小本本】\n${message}`
}

/**
 * 主进程在每次成功拿到报价后调用：后台托盘时也能弹系统通知。
 * @param {{ sellYuan: number }} quote
 */
export async function processQuoteAlerts(quote) {
  const sell = Number(quote?.sellYuan)
  if (!Number.isFinite(sell)) return

  const { settings } = await loadSettings()
  const { entries } = await loadLedgerFile()
  const avg = weightedAvgFromEntries(entries)
  const { state } = await loadAlertState()

  const messages = []

  const ledgerResult = evaluateAlert({
    sell,
    avg,
    nearGapYuan: Number(settings.nearGapYuan),
    riseStepYuan: Number(settings.riseStepYuan),
    state: {
      nearArmed: state.nearArmed,
      maxRiseTier: state.maxRiseTier
    }
  })

  const dropResult = evaluateDropAlert({
    sell,
    dropStepYuan: Number(settings.dropStepYuan),
    state: {
      dropAnchorSell: state.dropAnchorSell,
      maxDropTier: state.maxDropTier
    }
  })

  const nextState = {
    ...state,
    nearArmed: ledgerResult.nextState.nearArmed,
    maxRiseTier: ledgerResult.nextState.maxRiseTier,
    dropAnchorSell: dropResult.nextState.dropAnchorSell,
    maxDropTier: dropResult.nextState.maxDropTier
  }
  await saveAlertState(nextState)

  if (ledgerResult.shouldNotify) messages.push(ledgerResult.message)
  for (const n of dropResult.notifications) messages.push(n.message)

  for (const message of messages) {
    if (settings.notifyEnabled) {
      showSystemNotification({ title: '攒金小本本', body: message })
    }
    if (settings.feishuEnabled && settings.feishuWebhook) {
      void sendFeishuBotMessage({
        webhook: settings.feishuWebhook,
        secret: settings.feishuSecret,
        text: buildFeishuText(message, entries, sell)
      })
    }
    broadcast('golden:alert', { message, at: new Date().toISOString() })
  }
}
