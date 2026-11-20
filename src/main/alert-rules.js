/**
 * 提醒判定纯函数（主进程后台与渲染层规则一致）
 */

export function evaluateAlert({ sell, avg, nearGapYuan, riseStepYuan, state }) {
  const nextState = {
    nearArmed: state.nearArmed,
    maxRiseTier: state.maxRiseTier
  }

  if (avg == null || !Number.isFinite(avg) || !Number.isFinite(sell)) {
    return { shouldNotify: false, kind: null, message: '', nextState }
  }

  const nearLow = avg - nearGapYuan

  if (sell > nearLow && sell < avg) {
    if (!state.nearArmed) {
      nextState.nearArmed = true
      return {
        shouldNotify: true,
        kind: 'near',
        message: `赎回价 ${sell.toFixed(2)} 已接近均价 ${avg.toFixed(2)}（差 ${(avg - sell).toFixed(2)} 元/克）`,
        nextState
      }
    }
    return { shouldNotify: false, kind: null, message: '', nextState }
  }

  if (sell <= nearLow) {
    nextState.nearArmed = false
    nextState.maxRiseTier = -1
    return { shouldNotify: false, kind: null, message: '', nextState }
  }

  if (sell >= avg) {
    nextState.nearArmed = false
    const step = Math.max(0.01, Number(riseStepYuan) || 1)
    const tier = Math.floor((sell - avg) / step)
    if (tier > state.maxRiseTier) {
      nextState.maxRiseTier = tier
      const threshold = avg + tier * step
      return {
        shouldNotify: true,
        kind: 'rise',
        message: `赎回价 ${sell.toFixed(2)} 已达/超过均价档 ${threshold.toFixed(2)}（均价 ${avg.toFixed(2)}）`,
        nextState
      }
    }
  }

  return { shouldNotify: false, kind: null, message: '', nextState }
}

export function evaluateDropAlert({ sell, dropStepYuan, state }) {
  const nextState = {
    dropAnchorSell: state.dropAnchorSell,
    maxDropTier: state.maxDropTier ?? -1
  }

  if (!Number.isFinite(sell)) {
    return { notifications: [], nextState }
  }

  const step = Math.max(0.01, Number(dropStepYuan) || 3)

  if (state.dropAnchorSell == null || !Number.isFinite(state.dropAnchorSell)) {
    nextState.dropAnchorSell = sell
    nextState.maxDropTier = 0
    return { notifications: [], nextState }
  }

  if (sell > state.dropAnchorSell) {
    nextState.dropAnchorSell = sell
    nextState.maxDropTier = 0
    return { notifications: [], nextState }
  }

  const anchor = state.dropAnchorSell
  // tier=0 表示跌幅还不满一个步长（含 0），不应通知
  const tier = Math.floor((anchor - sell) / step)
  const notifications = []
  let maxTier = state.maxDropTier ?? 0

  // 从 1 档起报：至少下跌 dropStepYuan 元/克
  for (let t = Math.max(maxTier + 1, 1); t <= tier; t++) {
    const dropped = t * step
    notifications.push({
      kind: 'drop',
      message: `赎回价 ${sell.toFixed(2)}，相对近期高点 ${anchor.toFixed(2)} 已累计下跌约 ${dropped.toFixed(2)} 元/克`
    })
    maxTier = t
  }

  nextState.maxDropTier = maxTier
  return { notifications, nextState }
}

export function weightedAvgFromEntries(entries) {
  let grams = 0
  let cost = 0
  for (const e of entries || []) {
    const g = Number(e.grams) || 0
    const t = Number(e.totalPrice) || 0
    grams += g
    cost += t
  }
  return grams > 0 ? cost / grams : null
}
