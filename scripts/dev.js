/**
 * 开发入口：先找一个空闲端口，再启动 electron-vite dev。
 * 默认从 5173 开始，被占用就依次尝试 5174、5175…，并打印实际使用的端口。
 *
 * 额外参数会透传给 electron-vite，例如：
 *   node scripts/dev.js --rendererOnly
 */
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')

const rootDir = path.join(__dirname, '..')
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const START_PORT = Number(process.env.DEV_PORT) || 5173
const MAX_TRIES = 20

function canBind(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host }, () => {
      server.close(() => resolve(true))
    })
  })
}

/** IPv4 / IPv6 都能绑定才算端口空闲（Vite 与其它服务绑定的地址可能不同） */
async function isPortFree(port) {
  const v4 = await canBind('127.0.0.1', port)
  if (!v4) return false
  return canBind('::1', port)
}

async function pickPort() {
  for (let i = 0; i < MAX_TRIES; i++) {
    const port = START_PORT + i
    if (await isPortFree(port)) {
      if (port !== START_PORT) console.log(`[dev] 端口 ${START_PORT} 被占用，改用 ${port}`)
      else console.log(`[dev] 使用端口 ${port}`)
      return port
    }
  }
  console.error(`[dev] ${START_PORT}–${START_PORT + MAX_TRIES - 1} 均被占用，请先释放端口`)
  process.exit(1)
}

pickPort().then((port) => {
  const child = spawn(npxCmd, ['electron-vite', 'dev', ...process.argv.slice(2)], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, DEV_PORT: String(port) }
  })
  child.on('error', (err) => {
    console.error('[dev] 启动失败：', err)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
})
