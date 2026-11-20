/**
 * 启动自检：用本机 Electron 启动构建后的应用，确认主进程、preload 和渲染进程都能正常起来。
 *
 * 用法：
 *   npm run smoke
 *
 * 自检使用独立的临时数据目录，不会读写你真实的账本和设置。
 */
const { spawnSync } = require('child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const rootDir = path.join(__dirname, '..')
const electronPath = require('electron')
const smokeDir = path.join(os.tmpdir(), 'golden-monitoring-smoke')

function cleanup() {
  fs.rmSync(smokeDir, { recursive: true, force: true })
}

cleanup()

const result = spawnSync(electronPath, ['.', '--smoke-test'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: false,
  timeout: 40_000
})

cleanup()

if (result.error) {
  if (result.error.code === 'ETIMEDOUT') {
    console.error('[smoke] 启动自检超时，应用没有在 40 秒内退出')
  } else {
    console.error('[smoke] 启动自检失败：', result.error.message)
  }
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`[smoke] 启动自检失败，退出码 ${result.status}`)
  process.exit(result.status ?? 1)
}

console.log('[smoke] 启动自检通过')
