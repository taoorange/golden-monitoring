/**
 * 上海黄金交易所（SGE）· Au99.99 行情（非官方 OpenAPI）
 *
 * 【接口 2】日线 POST https://www.sge.com.cn/graph/Dailyhq  body: instid=Au99.99
 * 【接口 3】分时 GET  https://www.sge.com.cn/graph/quotations?instid=Au99.99
 *
 * 每次请求写入 logs/api-YYYY-MM-DD.log（见 api-logger.js）
 */

import https from 'node:https'
import { URLSearchParams } from 'node:url'
import { withApiLog } from './api-logger.js'

const DAILY_URL = 'https://www.sge.com.cn/graph/Dailyhq'
const QUOTE_URL = 'https://www.sge.com.cn/graph/quotations?instid=Au99.99'

/**
 * @param {string} url
 * @param {{ method?: string, body?: string | null, headers?: Record<string, string>, api: string }} opts
 */
function httpsRequest(url, { method = 'GET', body = null, headers = {}, api }) {
  return withApiLog(
    {
      api,
      method,
      url,
      requestBody: body
    },
    () =>
      new Promise((resolve, reject) => {
        const req = https.request(
          url,
          {
            method,
            headers: {
              'User-Agent': 'Mozilla/5.0 GoldenMonitoring',
              Referer: 'https://www.sge.com.cn/sjzx/mrhq',
              ...headers
            }
          },
          (res) => {
            const chunks = []
            res.on('data', (c) => chunks.push(c))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')
              try {
                const json = JSON.parse(text)
                resolve({
                  result: json,
                  responseForLog: text,
                  httpStatus: res.statusCode
                })
              } catch (err) {
                err.responseBody = text
                reject(err)
              }
            })
          }
        )
        req.on('error', reject)
        req.setTimeout(20000, () => req.destroy(new Error('上金所请求超时')))
        if (body) req.write(body)
        req.end()
      })
  )
}

/**
 * 上金所 Au99.99 全部日线 OHLC
 * @returns {Promise<Array<{ date: string, open: number, close: number, low: number, high: number }>>}
 */
export async function fetchSgeDailyAu9999() {
  const body = new URLSearchParams({ instid: 'Au99.99' }).toString()
  const json = await httpsRequest(DAILY_URL, {
    api: 'sge.daily.Au99.99',
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      Origin: 'https://www.sge.com.cn',
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
  const rows = json.time || []
  return rows
    .filter((row) => Array.isArray(row) && row.length >= 5)
    .map((row) => ({
      date: String(row[0]),
      open: Number(row[1]),
      close: Number(row[2]),
      low: Number(row[3]),
      high: Number(row[4])
    }))
}

/**
 * 上金所 Au99.99 当日分时点列
 */
export async function fetchSgeIntradayAu9999() {
  const json = await httpsRequest(QUOTE_URL, {
    api: 'sge.intraday.Au99.99',
    method: 'GET'
  })
  const times = json.times || []
  const data = json.data || []
  const points = []
  for (let i = 0; i < times.length; i++) {
    const raw = data[i]
    const price = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(price)) continue
    points.push({ time: String(times[i]), price })
  }
  return {
    points,
    delaystr: json.delaystr || '',
    fetchedAt: new Date().toISOString()
  }
}
