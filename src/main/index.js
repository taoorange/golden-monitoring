import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIcbcPoller } from './poller.js'
import { createRealtimePoller } from './realtime-poller.js'
import { fetchSgeDailyAu9999, fetchSgeIntradayAu9999 } from './sge-gold.js'
import { showSystemNotification } from './notify.js'
import { getLedgerFilePath, loadLedgerFile, saveLedgerFile } from './ledger-store.js'
import { loadSettings, saveSettings } from './settings-store.js'
import { processQuoteAlerts } from './alert-engine.js'
import { createAppTray, destroyAppTray } from './tray.js'

/** @type {BrowserWindow | null} */
let mainWindow = null
/** 托盘「退出」时为 true，允许真正关闭窗口 */
let isQuitting = false
/** 打包前的启动自检：不显示窗口、不启动托盘和轮询 */
const isSmokeTest = process.argv.includes('--smoke-test')

if (isSmokeTest) {
  const smokeDir = join(tmpdir(), 'golden-monitoring-smoke')
  mkdirSync(smokeDir, { recursive: true })
  app.setPath('userData', smokeDir)
  app.setPath('appData', smokeDir)
}

const poller = createIcbcPoller({
  onQuoteSuccess: (quote) => processQuoteAlerts(quote)
})
const realtimePoller = createRealtimePoller()

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  realtimePoller.wake()
}

function openSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('golden:open-settings')
        }
      }, 300)
    })
    return
  }

  showMainWindow()
  mainWindow.webContents.send('golden:open-settings')
}

function quitApp() {
  isQuitting = true
  poller.stop()
  realtimePoller.stop()
  destroyAppTray()
  app.quit()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: '攒金小本本',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isSmokeTest) {
      mainWindow?.show()
      realtimePoller.wake()
    }
  })

  // 点关闭：隐藏到托盘，继续后台轮询与系统通知
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('golden:get-last-quote', () => poller.getLastQuote())
  ipcMain.handle('golden:refresh-quote', async () => poller.refreshNow())
  ipcMain.handle('golden:set-poll-interval', (_e, sec) => {
    poller.setIntervalSec(Number(sec))
    return true
  })
  ipcMain.handle('golden:fetch-sge-daily', async () => fetchSgeDailyAu9999())
  ipcMain.handle('golden:fetch-sge-intraday', async () => fetchSgeIntradayAu9999())
  ipcMain.handle('golden:realtime-get', () => realtimePoller.getSnapshot())
  ipcMain.handle('golden:notify', (_e, payload) => showSystemNotification(payload || {}))
  ipcMain.handle('golden:ledger-path', () => getLedgerFilePath())
  ipcMain.handle('golden:ledger-load', async () => loadLedgerFile())
  ipcMain.handle('golden:ledger-save', async (_e, entries) => saveLedgerFile(entries))
  ipcMain.handle('golden:settings-load', async () => loadSettings())
  ipcMain.handle('golden:settings-save', async (_e, partial) => {
    const res = await saveSettings(partial || {})
    if (res.settings?.pollIntervalSec != null) {
      poller.setIntervalSec(Number(res.settings.pollIntervalSec))
    }
    return res
  })
}

function runSmokeCheck() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.error('[smoke] 主窗口未创建')
    app.exit(1)
    return
  }

  let finished = false
  const timer = setTimeout(() => finish(1, '等待窗口加载超时'), 15_000)

  function finish(code, message) {
    if (finished) return
    finished = true
    clearTimeout(timer)
    if (code === 0) {
      console.log(`[smoke] ${message}`)
    } else {
      console.error(`[smoke] ${message}`)
    }
    setTimeout(() => app.exit(code), 30)
  }

  async function checkRenderer() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      finish(1, '主窗口已关闭')
      return
    }

    try {
      const result = await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const started = Date.now()
          const tick = () => {
            const shell = document.querySelector('.app-shell')
            const chart = document.querySelector('.chart-panel')
            const ledger = document.querySelector('.ledger-panel .ledger')
            const api = window.golden
            if (shell && chart && ledger && api && typeof api.ping === 'function') {
              let pong = false
              try {
                pong = api.ping() === 'pong'
              } catch (err) {}
              resolve({ ok: pong, shell: !!shell, chart: !!chart, ledger: !!ledger, api: !!api, pong })
              return
            }
            if (Date.now() - started > 8000) {
              resolve({ ok: false, shell: !!shell, chart: !!chart, ledger: !!ledger, api: !!api, pong: false })
              return
            }
            setTimeout(tick, 100)
          }
          tick()
        })
      `)
      if (result?.ok) finish(0, '应用启动成功')
      else finish(1, `渲染进程未就绪：${JSON.stringify(result)}`)
    } catch (err) {
      finish(1, `渲染进程检查失败：${err?.message || err}`)
    }
  }

  mainWindow.webContents.once('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (isMainFrame !== false) finish(1, `页面加载失败：${code} ${desc}`)
  })
  mainWindow.webContents.once('render-process-gone', (_event, details) => {
    finish(1, `渲染进程退出：${details?.reason || 'unknown'}`)
  })

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', checkRenderer)
  } else {
    checkRenderer()
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.taotao.golden-monitoring')
  registerIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const { settings } = await loadSettings()
  createWindow()

  if (isSmokeTest) {
    if (process.platform === 'darwin') app.dock?.hide()
    runSmokeCheck()
    return
  }

  createAppTray({
    showWindow: showMainWindow,
    openSettings,
    quitApp
  })
  poller.start(Number(settings.pollIntervalSec) || 10)
  realtimePoller.start()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  realtimePoller.stop()
})

// 托盘常驻：关窗不退出
app.on('window-all-closed', () => {
  // 故意不 quit
})
