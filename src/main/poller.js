/**
 * 工行如意金「长轮询」调度（主进程）
 *
 * 并非 HTTP 协议意义上的 long-poll（服务端挂起），而是：
 *   循环：请求 A00505 → 成功后按间隔 sleep → 再请求；
 *   失败则间隔指数退避（上限 60s），成功后恢复用户设定间隔。
 *
 * 「立即刷新」：打断 sleep，并保证马上再跑一轮 tick（若正在请求则本轮结束后立刻再拉）。
 */

import { BrowserWindow } from 'electron'
import { fetchIcbcRuyiQuote } from './icbc-gold.js'

const DEFAULT_INTERVAL_MS = 10_000
const MAX_BACKOFF_MS = 60_000

/**
 * @param {{ onQuoteSuccess?: (quote: object) => void | Promise<void> }} [options]
 */
export function createIcbcPoller(options = {}) {
  let timer = null
  let stopped = true
  let intervalMs = DEFAULT_INTERVAL_MS
  let backoffMs = DEFAULT_INTERVAL_MS
  let lastFingerprint = ''
  /** @type {Awaited<ReturnType<typeof fetchIcbcRuyiQuote>> | null} */
  let lastQuote = null
  let wakeResolve = null
  /** 用户点了立即刷新：打断等待，并在需要时连续再拉一轮 */
  let wantImmediate = false
  /** @type {Array<(result: object) => void>} */
  let refreshWaiters = []
  const onQuoteSuccess = options.onQuoteSuccess

  function broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      wakeResolve = resolve
      timer = setTimeout(() => {
        wakeResolve = null
        timer = null
        resolve()
      }, ms)
    })
  }

  function wake() {
    if (timer) clearTimeout(timer)
    timer = null
    if (wakeResolve) {
      const r = wakeResolve
      wakeResolve = null
      r()
    }
  }

  function resolveRefreshWaiters(result) {
    const list = refreshWaiters
    refreshWaiters = []
    for (const resolve of list) resolve(result)
  }

  async function tickOnce() {
    const manual = wantImmediate
    wantImmediate = false
    try {
      const quote = await fetchIcbcRuyiQuote()
      lastQuote = quote
      backoffMs = intervalMs
      const fp = `${quote.buyYuan}|${quote.sellYuan}`
      const changed = fp !== lastFingerprint
      lastFingerprint = fp
      const payload = { ok: true, quote, changed, manual }
      broadcast('golden:quote', payload)
      try {
        await onQuoteSuccess?.(quote)
      } catch (hookErr) {
        console.error('onQuoteSuccess failed', hookErr)
      }
      resolveRefreshWaiters(payload)
    } catch (err) {
      const payload = {
        ok: false,
        error: err?.message || String(err),
        quote: lastQuote,
        manual
      }
      broadcast('golden:quote', payload)
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2)
      resolveRefreshWaiters(payload)
    }
  }

  async function loop() {
    while (!stopped) {
      await tickOnce()
      if (stopped) break
      // 刷新过程中又点了一次：不 sleep，马上再拉
      if (wantImmediate) continue
      await sleep(backoffMs)
    }
  }

  return {
    start(sec) {
      if (typeof sec === 'number' && sec >= 5 && sec <= 60) {
        intervalMs = Math.round(sec * 1000)
        backoffMs = intervalMs
      }
      if (!stopped) return
      stopped = false
      loop()
    },
    stop() {
      stopped = true
      wake()
      resolveRefreshWaiters({ ok: false, error: 'stopped', quote: lastQuote })
    },
    setIntervalSec(sec) {
      if (typeof sec !== 'number' || sec < 5 || sec > 60) return
      intervalMs = Math.round(sec * 1000)
      backoffMs = intervalMs
    },
    /**
     * 立即刷新：打断等待并尽快再请求；返回本轮（或紧接着一轮）结果 Promise。
     */
    refreshNow() {
      wantImmediate = true
      wake()
      return new Promise((resolve) => {
        refreshWaiters.push(resolve)
      })
    },
    getLastQuote() {
      return lastQuote
    }
  }
}
