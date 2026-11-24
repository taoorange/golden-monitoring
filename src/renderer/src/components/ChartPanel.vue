<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { settings } from '../stores/settings.js'

const range = ref('3M')
const mode = ref('realtime')
const loading = ref(false)
const error = ref('')
const dailyRows = ref([])
const intraday = ref({ points: [] })
const realtimePoints = ref([])
const realtimeQuote = ref(null)
const realtimeTrading = ref(false)
const realtimeError = ref('')
const chartEl = ref(null)
/** @type {import('echarts').ECharts | null} */
let chart = null
let offRealtime = null
let resizeObserver = null
/** 首次实时推送后补拉一次完整曲线，避免窗口比主进程种子数据先就绪 */
let snapshotSynced = false

const RANGE_DAYS = { '1M': 31, '3M': 93, '1Y': 366 }
// 保留 2 小时数据，默认只展示最近 1 小时，可左右拖动回看
const REALTIME_MAX = 7200
const REALTIME_WINDOW_MS = 60 * 60 * 1000

/** 是否跟随最新价格自动滚动；用户拖走后暂停，回到最右侧再恢复 */
let followRealtime = true
/** 用户手动拖动后的固定时间窗口（毫秒），窗口大小始终为 1 小时 */
let userWindow = null
let lastMode = ''

function formatClock(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const filteredDaily = computed(() => {
  const rows = dailyRows.value
  if (!rows.length) return []
  const days = RANGE_DAYS[range.value] || 93
  return rows.slice(-days)
})

const realtimePrice = computed(() => {
  const last = realtimePoints.value[realtimePoints.value.length - 1]
  const price = realtimeQuote.value?.price ?? last?.price
  if (price == null) return '—'
  return Number.isFinite(Number(price)) ? Number(price).toFixed(2) : '—'
})

const realtimeChangePct = computed(() => {
  const q = realtimeQuote.value
  if (!q) return null
  if (q.changePct != null) {
    const pct = Number(q.changePct)
    if (Number.isFinite(pct)) return pct
  }
  if (q.prevClose == null || q.price == null) return null
  const prev = Number(q.prevClose)
  const price = Number(q.price)
  if (Number.isFinite(prev) && prev > 0 && Number.isFinite(price)) {
    return ((price - prev) / prev) * 100
  }
  return null
})

const realtimeChangeText = computed(() => {
  const pct = realtimeChangePct.value
  if (pct == null) return ''
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
})

const realtimeSourceText = computed(() =>
  realtimeQuote.value?.source === 'sina'
    ? '黄金 T+D · 新浪兜底'
    : '上金所 Au99.99 · 东方财富'
)

function readCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // 主题挂在 .app-shell 上
  const shell = document.querySelector('.app-shell')
  const fromShell = shell ? getComputedStyle(shell).getPropertyValue(name).trim() : ''
  return fromShell || v || fallback
}

function renderChart() {
  if (!chart) return
  const line = readCssVar('--chart-line', '#7c3aed')
  const fill = readCssVar('--chart-fill', 'rgba(167,139,250,0.35)')
  const text = readCssVar('--color-text-muted', '#6366f1')
  const gridColor = readCssVar('--chart-grid', 'rgba(124,58,237,0.12)')

  const baseOption = {
    grid: { left: 52, right: 16, top: 28, bottom: 32 },
    tooltip: { trigger: 'axis' },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: text, fontSize: 10 },
      splitLine: { lineStyle: { color: gridColor } }
    }
  }

  if (mode.value === 'realtime') {
    const points = realtimePoints.value
    const preCloseRaw = realtimeQuote.value?.prevClose
    const preClose = Number(preCloseRaw)
    const hasPreClose =
      preCloseRaw != null && Number.isFinite(preClose) && preClose > 0

    const lastAt = points.length
      ? new Date(points[points.length - 1].at).getTime()
      : Date.now()

    // 窗口固定 1 小时：跟随最新价，或停在用户拖到的位置
    let start = lastAt - REALTIME_WINDOW_MS
    let end = lastAt
    if (!followRealtime && userWindow) {
      start = userWindow.start
      end = userWindow.end
    }

    const zoom = [
      {
        type: 'inside',
        xAxisIndex: 0,
        // 锁定窗口大小：拖动/滚轮只平移，不缩放
        zoomLock: true,
        zoomOnMouseWheel: false,
        moveOnMouseWheel: true,
        moveOnMouseMove: true,
        startValue: start,
        endValue: end
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        zoomLock: true,
        brushSelect: false,
        height: 12,
        bottom: 4,
        borderColor: 'transparent',
        backgroundColor: 'rgba(148, 163, 184, 0.12)',
        fillerColor: fill,
        handleStyle: { color: line },
        moveHandleSize: 0,
        showDetail: false,
        textStyle: { color: text, fontSize: 9 },
        startValue: start,
        endValue: end
      }
    ]

    chart.setOption(
      {
        ...baseOption,
        grid: { ...baseOption.grid, bottom: 44 },
        animation: false,
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v) => `${Number(v).toFixed(2)} 元/克`
        },
        dataZoom: zoom,
        xAxis: {
          type: 'time',
          axisLabel: {
            color: text,
            fontSize: 10,
            hideOverlap: true,
            formatter: (value) => formatClock(value)
          }
        },
        yAxis: {
          ...baseOption.yAxis,
          min: (v) => Math.floor((v.min - 0.1) * 10) / 10,
          max: (v) => Math.ceil((v.max + 0.1) * 10) / 10
        },
        series: [
          {
            type: 'line',
            data: points.map((p) => [new Date(p.at).getTime(), p.price]),
            smooth: true,
            showSymbol: false,
            lineStyle: { color: line, width: 1.8 },
            areaStyle: { color: fill },
            markLine: hasPreClose
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: 'rgba(100,116,139,0.55)', type: 'dashed' },
                  label: { formatter: '昨收', color: text, fontSize: 10 },
                  data: [{ yAxis: preClose }]
                }
              : undefined
          }
        ]
      },
      // 首次进入实时模式重建；后续合并，避免每秒刷新把用户拖动的窗口重置
      lastMode !== 'realtime'
    )
    lastMode = 'realtime'
    return
  }

  if (mode.value === 'intraday') {
    const pts = intraday.value.points || []
    chart.setOption(
      {
        ...baseOption,
        xAxis: {
          type: 'category',
          data: pts.map((p) => p.time),
          axisLabel: { color: text, fontSize: 10 }
        },
        series: [
          {
            type: 'line',
            data: pts.map((p) => p.price),
            smooth: true,
            showSymbol: false,
            lineStyle: { color: line, width: 2.4 },
            areaStyle: { color: fill }
          }
        ]
      },
      true
    )
    lastMode = 'intraday'
    return
  }

  const rows = filteredDaily.value
  chart.setOption(
    {
      ...baseOption,
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.date),
        axisLabel: { color: text, fontSize: 10 }
      },
      series: [
        {
          type: 'line',
          data: rows.map((r) => r.close),
          smooth: true,
          showSymbol: false,
          lineStyle: { color: line, width: 2.4 },
          areaStyle: { color: fill }
        }
      ]
    },
    true
  )
  lastMode = 'daily'
}

async function loadDaily() {
  loading.value = true
  error.value = ''
  try {
    dailyRows.value = (await window.golden.fetchSgeDaily()) || []
    renderChart()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function loadIntraday() {
  loading.value = true
  error.value = ''
  try {
    intraday.value = (await window.golden.fetchSgeIntraday()) || { points: [] }
    renderChart()
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function loadRealtime() {
  loading.value = true
  error.value = ''
  realtimeError.value = ''
  try {
    const snap = (await window.golden.getRealtime()) || {}
    realtimePoints.value = Array.isArray(snap.points)
      ? snap.points.slice(-REALTIME_MAX)
      : []
    if (snap.quote) realtimeQuote.value = snap.quote
    realtimeTrading.value = !!snap.trading
    if (snap.error) realtimeError.value = snap.error
  } catch (e) {
    realtimeError.value = e?.message || String(e)
  } finally {
    loading.value = false
    renderChart()
  }
}

function applyRealtimePoint(point) {
  if (!point || !Number.isFinite(Number(point.price))) return
  const list = realtimePoints.value
  const last = list[list.length - 1]
  if (last && last.at === point.at) list[list.length - 1] = point
  else list.push(point)
  if (list.length > REALTIME_MAX) list.splice(0, list.length - REALTIME_MAX)
  if (mode.value === 'realtime') renderChart()
}

function onRealtimePayload(payload) {
  if (!payload) return
  if (payload.trading != null) realtimeTrading.value = !!payload.trading
  if (payload.quote) realtimeQuote.value = payload.quote
  if (payload.point) applyRealtimePoint(payload.point)
  if (payload.ok === false) realtimeError.value = payload.error || '实时行情失败'
  else if (payload.ok) realtimeError.value = ''

  // 主进程启动时先取种子再推第一笔；首笔到达时种子一定已就绪
  if (!snapshotSynced) {
    snapshotSynced = true
    if (realtimePoints.value.length <= 1) void loadRealtime()
  }
}

async function switchMode(next) {
  mode.value = next
  if (next === 'intraday') {
    if (!intraday.value.points?.length) await loadIntraday()
    else renderChart()
  } else if (next === 'daily') {
    if (!dailyRows.value.length) await loadDaily()
    else renderChart()
  } else if (next === 'realtime') {
    error.value = ''
    followRealtime = true
    if (!realtimePoints.value.length) await loadRealtime()
    else renderChart()
  }
}

/** 用户把窗口拖离最右侧就暂停自动跟随并记住位置；拖回最右侧恢复 */
function onDataZoom() {
  const dz = chart?.getOption()?.dataZoom?.[0]
  if (!dz) return
  const endPct = typeof dz.end === 'number' ? dz.end : 100
  followRealtime = endPct >= 99.5
  if (followRealtime) {
    userWindow = null
    return
  }

  const points = realtimePoints.value
  if (!points.length) return
  const times = points.map((p) => new Date(p.at).getTime())
  const min = times[0]
  const max = times[times.length - 1]
  if (!(max > min)) return

  const startPct = typeof dz.start === 'number' ? dz.start : 0
  const start = min + ((max - min) * startPct) / 100
  // 窗口宽度始终保持 1 小时，不随数据增长变宽
  userWindow = { start, end: start + REALTIME_WINDOW_MS }
}

onMounted(async () => {
  chart = echarts.init(chartEl.value)
  chart.on('dataZoom', onDataZoom)
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(chartEl.value)
  await loadRealtime()
  offRealtime = window.golden.onRealtime?.(onRealtimePayload) || null
})

onUnmounted(() => {
  offRealtime?.()
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})

watch([range, mode], () => renderChart())
watch(
  () => settings.theme,
  () => {
    // 主题色变了，重读 CSS 变量再画
    requestAnimationFrame(() => renderChart())
  }
)
</script>

<template>
  <section class="panel chart-panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">
          国内金价走势
          <span
            v-if="mode === 'realtime'"
            class="live-dot"
            :class="{ on: realtimeTrading }"
            :title="realtimeTrading ? '交易中' : '休市'"
          />
        </div>
        <p class="hint">
          <template v-if="mode === 'realtime'">
            {{ realtimeSourceText }} · 每秒刷新 ·
            {{ realtimeTrading ? '交易中' : '休市' }}
          </template>
          <template v-else>
            上金所 Au99.99（原料金）· 与工行如意金价不同口径
          </template>
        </p>
      </div>
      <div class="toolbar">
        <span
          v-if="mode === 'realtime' && realtimeChangePct != null"
          class="rt-price"
        >
          {{ realtimePrice }}
          <em :class="realtimeChangePct >= 0 ? 'up' : 'down'">
            {{ realtimeChangeText }}
          </em>
        </span>
        <button
          type="button"
          class="chip"
          :class="{ active: mode === 'realtime' }"
          @click="switchMode('realtime')"
        >
          实时
        </button>
        <button
          v-for="r in ['1M', '3M', '1Y']"
          :key="r"
          type="button"
          class="chip"
          :class="{ active: mode === 'daily' && range === r }"
          @click="range = r; switchMode('daily')"
        >
          {{ r }}
        </button>
        <button
          type="button"
          class="chip"
          :class="{ active: mode === 'intraday' }"
          @click="switchMode('intraday')"
        >
          今日分时
        </button>
      </div>
    </div>
    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint err">{{ error }}</p>
    <p v-if="realtimeError && mode === 'realtime'" class="hint err">
      {{ realtimeError }}
    </p>
    <div ref="chartEl" class="chart-box" />
  </section>
</template>

<style scoped lang="scss">
.chart-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-head {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.live-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  background: #94a3b8;
  vertical-align: middle;

  &.on {
    background: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
  }
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.rt-price {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin-right: 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text);

  em {
    font-style: normal;
    font-size: 12px;

    &.up {
      color: var(--color-up);
    }

    &.down {
      color: var(--color-down);
    }
  }
}

.chip {
  border: 1px dashed var(--color-card-border);
  background: rgba(255, 255, 255, 0.55);
  color: var(--color-text-muted);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;

  &.active {
    border-style: solid;
    color: var(--color-accent);
    font-weight: 700;
  }
}

.chart-box {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 180px;
  height: auto;
  margin-top: 8px;
}

.err {
  color: var(--color-danger);
}
</style>
