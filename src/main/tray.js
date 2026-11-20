import { Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'

/** @type {Tray | null} */
let tray = null

function resolveTrayIconPath() {
  if (is.dev) {
    return join(process.cwd(), 'build/icon.png')
  }
  // electron-builder extraResources → resources/icon.png
  const fromResources = join(process.resourcesPath, 'icon.png')
  if (existsSync(fromResources)) return fromResources
  return join(process.resourcesPath, 'build/icon.png')
}

/**
 * @param {{
 *   showWindow: () => void,
 *   openSettings: () => void,
 *   quitApp: () => void
 * }} handlers
 */
export function createAppTray(handlers) {
  if (tray) return tray

  const iconPath = resolveTrayIconPath()
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    // 兜底：1x1 透明，避免托盘创建失败
    image = nativeImage.createEmpty()
  } else {
    image = image.resize({ width: 18, height: 18 })
  }

  tray = new Tray(image)
  tray.setToolTip('攒金小本本（后台监测中）')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => handlers.showWindow()
      },
      {
        label: '设置…',
        click: () => handlers.openSettings()
      },
      {
        type: 'separator'
      },
      {
        label: '退出',
        click: () => handlers.quitApp()
      }
    ])
  )
  tray.on('double-click', () => handlers.showWindow())
  tray.on('click', () => {
    // macOS 单击常只出菜单；Windows 单击显示窗口
    if (process.platform === 'win32') handlers.showWindow()
  })

  return tray
}

export function destroyAppTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
