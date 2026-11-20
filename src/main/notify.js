import { Notification } from 'electron'

/**
 * 弹出系统通知（需用户未关系统权限）
 * @param {{ title: string, body: string }} payload
 */
export function showSystemNotification({ title, body }) {
  if (!Notification.isSupported()) {
    return { ok: false, reason: 'unsupported' }
  }
  const n = new Notification({
    title: title || '攒金小本本',
    body: body || '',
    silent: false
  })
  n.show()
  return { ok: true }
}
