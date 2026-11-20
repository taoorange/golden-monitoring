/**
 * 工商银行 · 如意金积存 · 公开行情（非官方 OpenAPI）
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 【接口 1】如意金积存买卖价
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 用途：
 *   获取「如意金积存」积存价（客户买入）与赎回价（客户卖出），单位最终换算为元/克。
 *   本项目主进程轮询（poller.js）与「立即刷新」都走本文件。
 *
 * 重要说明：
 *   - 工行未提供正式开放平台文档；这是网银页面前端使用的 Servlet，随时可能改字段/鉴权。
 *   - 浏览器直连会 CORS 失败，必须在 Electron 主进程（或自建代理）请求。
 *   - Node 18+ / OpenSSL 3 可能报 unsafe legacy renegotiation；故使用
 *     SSL_OP_LEGACY_SERVER_CONNECT。证书校验仍开启（rejectUnauthorized 默认 true）。
 *   - 交易时段大致每日 9:10–22:30；休市时接口仍可能返回最近一次报价。
 *
 * 请求：
 *   Method : POST
 *   URL    : https://mybank.icbc.com.cn/servlet/AsynGetDataServlet
 *   Body   : tranCode=A00505
 *
 * 在本项目中的调用链：
 *   poller.js → fetchIcbcRuyiQuote()
 *   → IPC 推送 golden:quote → 渲染进程 App.vue 展示 / 主进程提醒
 *
 * 每次请求写入 logs/api-YYYY-MM-DD.log（见 api-logger.js）
 */

import https from 'node:https'
import crypto from 'node:crypto'
import { URLSearchParams } from 'node:url'
import { withApiLog } from './api-logger.js'

const ICBC_URL = 'https://mybank.icbc.com.cn/servlet/AsynGetDataServlet'

/**
 * 拉取工行如意金积存买卖价。
 *
 * @returns {Promise<{
 *   productName: string,
 *   productId: string,
 *   buyYuan: number,
 *   sellYuan: number,
 *   fetchedAt: string
 * }>}
 */
export function fetchIcbcRuyiQuote() {
  const body = new URLSearchParams({ tranCode: 'A00505' }).toString()

  return withApiLog(
    {
      api: 'icbc.ruyi.A00505',
      method: 'POST',
      url: ICBC_URL,
      requestBody: body
    },
    () =>
      new Promise((resolve, reject) => {
        const req = https.request(
          ICBC_URL,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'Mozilla/5.0 GoldenMonitoring'
            },
            secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT
          },
          (res) => {
            const chunks = []
            res.on('data', (c) => chunks.push(c))
            res.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8')
              try {
                const json = JSON.parse(text)
                if (String(json.TranErrorCode) !== '0' && json.TranErrorCode !== '') {
                  const err = new Error(
                    json.TranErrorDisplayMsg || `工行错误码 ${json.TranErrorCode}`
                  )
                  err.responseBody = text
                  reject(err)
                  return
                }
                const row = json.pronoinfo?.[0]
                const meta = json.ryinfo?.[0]
                if (!row) {
                  const err = new Error('工行返回无价格行')
                  err.responseBody = text
                  reject(err)
                  return
                }
                resolve({
                  result: {
                    productName: meta?.productName || '如意金积存',
                    productId: row.prodcode || meta?.productId || '',
                    buyYuan: Number(row.buyprice) / 100,
                    sellYuan: Number(row.sellprice) / 100,
                    fetchedAt: new Date().toISOString()
                  },
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
        req.setTimeout(15000, () => {
          req.destroy(new Error('工行请求超时'))
        })
        req.write(body)
        req.end()
      })
  )
}
