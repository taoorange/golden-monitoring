/**
 * 上金所 Au99.99 实时行情轮询（主进程）
 *
 * 节奏：
 *   - 交易时段 + 窗口可见：1 秒
 *   - 交易时段 + 窗口隐藏：5 秒（托盘仍保留最近走势）
 *   - 休市：15 秒
 *   - 请求失败：指数退避，上限 30 秒
 *
 * 交易时段（北京时间）：周一至周五 09:00–15:30、20:00–次日 02:30；
 * 周五夜盘延续到周六 02:30，周日晚无夜盘。节假日按休市处理，靠失败退避兜底。
 */

import { BrowserWindow } from 'electron'
import { fetchRealtimeGoldQuote, fetchSgeTrendSeed } from './realtime-gold.js'

const ACTIVE_INTERVAL_MS = 1_000
const HIDDEN_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 15_000
const MAX_BACKOFF_MS = 30_000
// 渲染层按最近 1 小时展示，这里多留一些便于左右回看
const MAX_POINTS = 7_200
// 种子多取一段分钟线，保证打开应用就能左右回看，而不是只有最近半小时
const SEED_POINTS = 180
const FRESH_MS = 5 * 60 * 1_000

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  hour12: false,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour12: false,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit'
})

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function shanghaiClock(date = new Date()) {
  const parts = PARTS_FMT.formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  return { day: WEEKDAY[get('weekday')], minutes: hour * 60 + minute }
}

/** 当前是否处于上金所 Au99.99 交易时段（北京时间） */
export function isSgeTradingTime(date = new Date()) {
  const { day, minutes } = shanghaiClock(date)
  if (day == null) return false

  // 周一至周五日盘 09:00–15:30
  if (day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60 + 30) {
    return true
  }
  // 周一至周五夜盘 20:00–24:00
  if (day >= 1 && day <= 5 && minutes >= 20 * 60) return true
  // 周二至周六凌晨延续前一晚夜盘 00:00–02:30
  if (day >= 2 && day <= 6 && minutes <= 2 * 60 + 30) return true

  return false
}

function hasVisibleWindow() {
  return BrowserWindow.getAllWindows().some(
    (win) => !win.isDestroyed() && win.isVisible()
  )
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function makePoint({ at, price }) {
  return { at, t: TIME_FMT.format(new Date(at)), price }
}

export function createRealtimePoller() {
  let timer = null
  let stopped = true
  let inFlight = false
  let failMs = ACTIVE_INTERVAL_MS
  /** @type {object | null} */
  let lastQuote = null
  let lastError = ''
  /** @type {Array<{ at: string, t: string, price: number }>} */
  let points = []

  async function seed() {
    try {
      const minutePoints = await fetchSgeTrendSeed()
      const now = Date.now()
      // 取最近 30 个分钟点；同时丢掉接口可能多给的“未来一分钟”
      const seeded = (minutePoints || [])
        .filter((p) => new Date(p.at).getTime() <= now + 1_000)
        .slice(-SEED_POINTS)
        .map(makePoint)

      // seed 期间可能已经拉到实时点，合并而不是覆盖
      const merged = new Map(seeded.map((p) => [p.at, p]))
      for (const p of points) merged.set(p.at, p)
      points = [...merged.values()]
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-MAX_POINTS)
    } catch (err) {
      // 种子失败不影响实时轮询，曲线会从第一笔实时报价开始
      console.warn('实时曲线种子加载失败', err?.message || err)
    }
  }

  function isQuoteFresh() {
    if (!lastQuote?.at) return true
    const at = new Date(lastQuote.at).getTime()
    return Number.isFinite(at) && Date.now() - at < FRESH_MS
  }

  function schedule() {
    if (stopped) return
    if (timer) clearTimeout(timer)

    let delay
    if (failMs > ACTIVE_INTERVAL_MS) {
      delay = failMs
    } else if (!isSgeTradingTime() || !isQuoteFresh()) {
      delay = IDLE_INTERVAL_MS
    } else if (hasVisibleWindow()) {
      delay = ACTIVE_INTERVAL_MS
    } else {
      delay = HIDDEN_INTERVAL_MS
    }

    timer = setTimeout(tickOnce, delay)
  }

  async function tickOnce() {
    if (stopped || inFlight) return
    inFlight = true

    try {
      const quote = await fetchRealtimeGoldQuote()
      lastQuote = quote
      lastError = ''
      failMs = ACTIVE_INTERVAL_MS

      const point = makePoint(quote)
      const last = points[points.length - 1]
      if (last && last.at === point.at) points[points.length - 1] = point
      else points.push(point)
      if (points.length > MAX_POINTS) {
        points.splice(0, points.length - MAX_POINTS)
      }

      broadcast('golden:realtime', {
        ok: true,
        quote,
        point,
        trading: isSgeTradingTime()
      })
    } catch (err) {
      lastError = err?.message || String(err)
      failMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(ACTIVE_INTERVAL_MS, failMs * 2)
      )
      broadcast('golden:realtime', {
        ok: false,
        error: lastError,
        quote: lastQuote,
        trading: isSgeTradingTime()
      })
    } finally {
      inFlight = false
      schedule()
    }
  }

  return {
    async start() {
      if (!stopped) return
      stopped = false
      await seed()
      if (!stopped) tickOnce()
    },
    stop() {
      stopped = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    /** 窗口重新显示时立即拉一次，避免等下一个轮询周期 */
    wake() {
      if (stopped || inFlight) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      tickOnce()
    },
    getSnapshot() {
      return {
        quote: lastQuote,
        points: points.slice(),
        trading: isSgeTradingTime(),
        error: lastError
      }
    }
  }
}
