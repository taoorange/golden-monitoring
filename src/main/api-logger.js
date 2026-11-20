/**
 * 接口请求落盘日志（JSON Lines，按天一个文件）
 * 路径：…/com.taotao.golden-monitoring/logs/api-YYYY-MM-DD.log
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getApiLogFilePath } from './app-paths.js'

const MAX_RESPONSE_CHARS = 8 * 1024

/** api + 成功/失败 组合的最近落盘时间，用于高频轮询采样 */
const lastLogAt = new Map()

function shouldLog(meta, kind) {
  if (!meta?.sampleMs) return true
  const key = `${meta.api}:${kind}`
  const now = Date.now()
  const last = lastLogAt.get(key) || 0
  if (now - last < meta.sampleMs) return false
  lastLogAt.set(key, now)
  return true
}

function truncateText(value) {
  if (value == null) return value
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= MAX_RESPONSE_CHARS) return text
  return `${text.slice(0, MAX_RESPONSE_CHARS)}…[truncated ${text.length - MAX_RESPONSE_CHARS} chars]`
}

/**
 * 追加一条接口日志；失败只打 console，不影响行情主流程。
 * @param {{
 *   api: string,
 *   method: string,
 *   url: string,
 *   requestBody?: string | null,
 *   ok: boolean,
 *   durationMs: number,
 *   httpStatus?: number,
 *   response?: unknown,
 *   error?: string
 * }} entry
 */
export function appendApiLog(entry) {
  const path = getApiLogFilePath()
  const line =
    JSON.stringify({
      at: new Date().toISOString(),
      api: entry.api,
      method: entry.method,
      url: entry.url,
      requestBody: entry.requestBody ?? null,
      ok: entry.ok,
      durationMs: entry.durationMs,
      httpStatus: entry.httpStatus ?? null,
      response: truncateText(entry.response),
      error: entry.error ?? null
    }) + '\n'

  mkdir(dirname(path), { recursive: true })
    .then(() => appendFile(path, line, 'utf8'))
    .catch((err) => console.error('写接口日志失败', path, err))
}

/**
 * 包装一次异步请求并自动记日志。
 * @template T
 * @param {{ api: string, method: string, url: string, requestBody?: string | null, sampleMs?: number }} meta
 * @param {() => Promise<{ result: T, responseForLog?: unknown, httpStatus?: number }>} runner
 * @returns {Promise<T>}
 */
export async function withApiLog(meta, runner) {
  const started = Date.now()
  const { sampleMs: _sampleMs, ...logMeta } = meta
  try {
    const { result, responseForLog, httpStatus } = await runner()
    if (shouldLog(meta, 'ok')) {
      appendApiLog({
        ...logMeta,
        ok: true,
        durationMs: Date.now() - started,
        httpStatus,
        response: responseForLog ?? result
      })
    }
    return result
  } catch (err) {
    if (shouldLog(meta, 'err')) {
      appendApiLog({
        ...logMeta,
        ok: false,
        durationMs: Date.now() - started,
        error: err?.message || String(err),
        response: err?.responseBody ?? null
      })
    }
    throw err
  }
}
