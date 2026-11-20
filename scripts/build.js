/**
 * 打包入口：npm run build:mac / build:win 共用，支持透传版本递增参数。
 *
 * 用法：
 *   npm run build:mac
 *   npm run build:mac -- --patch
 *   npm run build:win -- --minor
 *
 * 会先升级 package.json / package-lock.json 的版本，再执行 electron-vite build、
 * 启动自检和 electron-builder，产物版本号就是升级后的版本。
 *
 * 进度条按阶段推进：electron-builder 没有可解析的细粒度进度，
 * 这里展示的是整体阶段进度，不是单个文件打包的百分比。
 */
const { spawnSync } = require('child_process')
const path = require('path')

const rootDir = path.join(__dirname, '..')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const rawArgs = process.argv.slice(2)
const bumpFlags = new Set(['--patch', '--minor', '--major', '-p'])
const bumpArg = rawArgs.find((arg) => bumpFlags.has(arg))
const bumpType = bumpArg === '--minor' ? 'minor' : bumpArg === '--major' ? 'major' : 'patch'

const target = rawArgs.includes('--mac') ? 'mac' : 'win'
const targetLabel = target === 'mac' ? 'macOS' : 'Windows'

const totalSteps = (bumpArg ? 1 : 0) + 3
const BAR_WIDTH = 24
let completedSteps = 0

function drawBar(label) {
  const pct = Math.round((completedSteps / totalSteps) * 100)
  const filled = Math.round((pct / 100) * BAR_WIDTH)
  const bar = `${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}`
  console.log(
    `[${bar}] ${String(pct).padStart(3)}%  ${completedSteps + 1}/${totalSteps} ${label}`
  )
}

function drawFinish() {
  console.log(`[${'#'.repeat(BAR_WIDTH)}] 100%  打包完成`)
}

/** @param {string} label @param {string} command @param {string[]} args */
function runStep(label, command, args) {
  drawBar(label)
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false
  })
  if (result.error) {
    console.error(`[build] ${label}失败：${command} ${args.join(' ')}`, result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[build] ${label}失败，退出码 ${result.status}`)
    process.exit(result.status ?? 1)
  }
  completedSteps += 1
}

if (bumpArg) {
  runStep(`升级版本（${bumpType}）`, npmCmd, [
    'version',
    bumpType,
    '--no-git-tag-version'
  ])
}

runStep('构建代码', npmCmd, ['run', 'build'])

drawBar('启动自检')
const smoke = spawnSync(
  process.execPath,
  [path.join(__dirname, 'smoke-test.js')],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false
  }
)
if (smoke.error || smoke.status !== 0) {
  console.error('[build] 启动自检失败，已停止打包')
  process.exit(smoke.status ?? 1)
}
completedSteps += 1

runStep(
  `打包 ${targetLabel}`,
  npxCmd,
  target === 'mac'
    ? ['electron-builder', '--mac', '--publish', 'never']
    : ['electron-builder', '--win', '--x64', '--publish', 'never']
)

drawFinish()
