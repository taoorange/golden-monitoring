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

/**
 * 价格变动提醒：以上次提醒时的价格为基准，涨或跌累计满 changeStepYuan 元/克提醒一次。
 * 提醒后基准更新为当前价，因此单边行情每满一个步长报一次，不会每个报价都响。
 *
 * @returns {{ notifications: Array<{ kind: 'rise' | 'drop', message: string }>, nextState: object }}
 */
export function evaluateChangeAlert({ sell, changeStepYuan, state }) {
  const base = Number(state.changeBaseSell)
  const nextState = { changeBaseSell: state.changeBaseSell ?? null }

  if (!Number.isFinite(sell)) {
    return { notifications: [], nextState }
  }

  const step = Math.max(0.01, Number(changeStepYuan) || 1)

  // 首次只记基准，不打扰
  if (!Number.isFinite(base) || base <= 0) {
    nextState.changeBaseSell = sell
    return { notifications: [], nextState }
  }

  const diff = sell - base
  if (Math.abs(diff) < step) {
    return { notifications: [], nextState }
  }

  const direction = diff > 0 ? '上涨' : '下跌'
  nextState.changeBaseSell = sell
  return {
    notifications: [
      {
        kind: diff > 0 ? 'rise' : 'drop',
        message: `赎回价 ${sell.toFixed(2)}，较上次提醒${direction} ${Math.abs(diff).toFixed(
          2
        )} 元/克`
      }
    ],
    nextState
  }
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
