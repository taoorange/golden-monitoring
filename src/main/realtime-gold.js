/**
 * 国内黄金 · 实时行情（非官方公开接口）
 *
 * 主源：东方财富 118.AU9999（上金所黄金9999，元/克）
 * 兜底：新浪 gds_AUTD（黄金 T+D，元/克）
 * 种子：东方财富分钟线，用于打开应用时先铺一段曲线
 *
 * 注意：
 *   - 均为网页端公开接口，非正式 OpenAPI，字段或鉴权可能随时变化。
 *   - 浏览器直连有 CORS，必须在主进程请求。
 *   - 实时轮询默认 1 秒，日志按 60 秒采样，避免一天写入数万行。
 *
 * 每次请求写入 logs/api-YYYY-MM-DD.log（见 api-logger.js）
 */

import https from 'node:https'
import { withApiLog } from './api-logger.js'

const EM_QUOTE_URL =
  'https://push2.eastmoney.com/api/qt/stock/get?secid=118.AU9999' +
  '&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f86,f169,f170'

const EM_TRENDS_URL =
  'https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=118.AU9999' +
  '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13' +
  '&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0'

const SINA_URL = 'https://hq.sinajs.cn/list=gds_AUTD'

const agent = new https.Agent({ keepAlive: true, maxSockets: 2 })

/**
 * @param {string} url
 * @param {{ encoding?: BufferEncoding, headers?: Record<string, string>, timeout?: number }} [options]
 * @returns {Promise<string>}
 */
function requestText(url, options = {}) {
  const { encoding = 'utf8', headers = {}, timeout = 8000 } = options

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 GoldenMonitoring',
          ...headers
        }
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString(encoding)
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`HTTP ${res.statusCode}`)
            err.responseBody = text
            reject(err)
            return
          }
          resolve(text)
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(timeout, () => req.destroy(new Error('实时行情请求超时')))
    req.end()
  })
}

/** 东财价格类字段放大 100 倍 */
function scaled(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n / 100 : null
}

function rawNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function fetchEastmoneyQuote() {
  const text = await requestText(EM_QUOTE_URL, {
    headers: { Referer: 'https://quote.eastmoney.com/' }
  })
  const json = JSON.parse(text)
  const data = json?.data
  if (!data) throw new Error('东财返回无行情')

  const price = scaled(data.f43)
  if (price == null) throw new Error('东财返回无最新价')

  const prevClose = scaled(data.f60)
  const at = rawNumber(data.f86)
    ? new Date(rawNumber(data.f86) * 1000)
    : new Date()

  return {
    productName: data.f58 || '黄金9999',
    code: data.f57 || 'AU9999',
    price,
    open: scaled(data.f46),
    high: scaled(data.f44),
    low: scaled(data.f45),
    prevClose,
    change: scaled(data.f169),
    changePct: scaled(data.f170),
    volume: rawNumber(data.f47),
    amount: rawNumber(data.f48),
    at: at.toISOString(),
    source: 'eastmoney'
  }
}

async function fetchSinaQuote() {
  const text = await requestText(SINA_URL, {
    // gds_AUTD 返回内容全为 ASCII，用 latin1 可避开 GBK 解码依赖
    encoding: 'latin1',
    headers: { Referer: 'https://finance.sina.com.cn' }
  })
  const match = text.match(/="([^"]*)"/)
  if (!match) throw new Error('新浪返回格式异常')

  const f = match[1].split(',')
  const price = Number(f[0])
  if (!Number.isFinite(price)) throw new Error('新浪返回无最新价')

  const prevClose = Number(f[8])
  const change = Number.isFinite(prevClose) ? price - prevClose : null
  const at = new Date(`${f[12]}T${f[6]}+08:00`)

  return {
    productName: '黄金T+D',
    code: 'AUTD',
    price,
    open: Number(f[7]) || null,
    high: Number(f[4]) || null,
    low: Number(f[5]) || null,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    change,
    changePct:
      change != null && prevClose > 0 ? (change / prevClose) * 100 : null,
    volume: Number(f[9]) || null,
    amount: null,
    at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
    source: 'sina'
  }
}

/**
 * 拉取一份实时报价：东财 Au99.99 优先，失败切新浪黄金 T+D。
 * @returns {Promise<object>}
 */
export async function fetchRealtimeGoldQuote() {
  try {
    return await withApiLog(
      {
        api: 'eastmoney.sge.AU9999',
        method: 'GET',
        url: EM_QUOTE_URL,
        sampleMs: 60_000
      },
      async () => {
        const quote = await fetchEastmoneyQuote()
        return {
          result: quote,
          responseForLog: { code: quote.code, price: quote.price, at: quote.at },
          httpStatus: 200
        }
      }
    )
  } catch (primaryErr) {
    try {
      return await withApiLog(
        {
          api: 'sina.gds.AUTD',
          method: 'GET',
          url: SINA_URL,
          sampleMs: 60_000
        },
        async () => {
          const quote = await fetchSinaQuote()
          return {
            result: quote,
            responseForLog: { price: quote.price, at: quote.at },
            httpStatus: 200
          }
        }
      )
    } catch (fallbackErr) {
      throw new Error(
        `实时行情失败：东财 ${primaryErr?.message || primaryErr}；新浪 ${
          fallbackErr?.message || fallbackErr
        }`
      )
    }
  }
}

/**
 * 东财当日分钟线，用作实时曲线打开时的种子。
 * @returns {Promise<Array<{ at: string, price: number }>>}
 */
export async function fetchSgeTrendSeed() {
  return withApiLog(
    {
      api: 'eastmoney.sge.trends',
      method: 'GET',
      url: EM_TRENDS_URL
    },
    async () => {
      const text = await requestText(EM_TRENDS_URL, {
        headers: { Referer: 'https://quote.eastmoney.com/' }
      })
      const json = JSON.parse(text)
      const data = json?.data
      const rows = Array.isArray(data?.trends) ? data.trends : []

      const points = []
      for (const row of rows) {
        const parts = String(row).split(',')
        const timeText = parts[0]
        const price = Number(parts[2])
        if (!timeText || !Number.isFinite(price)) continue
        const at = new Date(`${timeText.replace(' ', 'T')}:00+08:00`)
        if (Number.isNaN(at.getTime())) continue
        points.push({ at: at.toISOString(), price })
      }

      return {
        result: points,
        responseForLog: {
          count: points.length,
          last: points[points.length - 1] || null
        },
        httpStatus: 200
      }
    }
  )
}
