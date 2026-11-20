import { createHmac } from 'node:crypto'

const WEBHOOK_PREFIX = 'https://open.feishu.cn/open-apis/bot/v2/hook/'
const TIMEOUT_MS = 8000
const RETRY_DELAY_MS = 1000

function maskWebhook(url) {
  if (!url) return '(空)'
  const tail = url.slice(-6)
  return `${WEBHOOK_PREFIX}…${tail}`
}

/** 飞书自定义机器人加签：HMAC-SHA256(key = timestamp + "\n" + secret, data = "") */
function signPayload(secret, timestamp) {
  return createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64')
}

async function postOnce(url, payload) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    const data = await res.json().catch(() => null)

    if (res.status >= 500) {
      return { ok: false, retryable: true, error: `HTTP ${res.status}` }
    }
    if (!res.ok) return { ok: false, retryable: false, error: `HTTP ${res.status}` }
    if (!data) return { ok: false, retryable: false, error: '响应不是合法 JSON' }

    const code = data.code ?? data.StatusCode
    if (code === 0) return { ok: true }
    const msg = data.msg ?? data.StatusMessage ?? ''
    return { ok: false, retryable: false, error: `${code ?? 'unknown'} ${msg}`.trim() }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return {
      ok: false,
      retryable: true,
      error: aborted ? '请求超时' : err?.message || String(err)
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 发送飞书群自定义机器人文本消息。
 * 失败只返回错误，不抛异常，调用方可以放心 fire-and-forget。
 * @param {{ webhook: string, secret?: string, text: string }} options
 */
export async function sendFeishuBotMessage({ webhook, secret, text }) {
  const url = String(webhook || '').trim()
  const body = String(text || '').trim()
  const key = String(secret || '').trim()

  if (!url) return { ok: false, error: '未配置 Webhook 地址' }
  if (!url.startsWith(WEBHOOK_PREFIX)) {
    return { ok: false, error: 'Webhook 地址不合法，应以 https://open.feishu.cn/open-apis/bot/v2/hook/ 开头' }
  }
  if (!body) return { ok: false, error: '消息内容为空' }

  const payload = { msg_type: 'text', content: { text: body } }
  if (key) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    payload.timestamp = timestamp
    payload.sign = signPayload(key, timestamp)
  }

  let result = await postOnce(url, payload)
  if (!result.ok && result.retryable) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    result = await postOnce(url, payload)
  }
  if (!result.ok) {
    console.error(`[feishu] 发送失败 ${maskWebhook(url)}：${result.error}`)
  }
  return { ok: result.ok, error: result.error }
}
