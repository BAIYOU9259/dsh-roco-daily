/**
 * 配置与状态：~/.dsh/roco-daily.json · ~/.dsh/roco-daily/
 * 一切路径都尊重 DSH_HOME（和 DSH 其它插件一致）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseHHMM } from './schedule.mjs'

export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const CONFIG_PATH = path.join(DSH_HOME, 'roco-daily.json')
export const STATE_DIR = path.join(DSH_HOME, 'roco-daily')
export const STATE_PATH = path.join(STATE_DIR, 'state.json')

export const DEFAULT_STEPS = [
  {
    id: 'gubiji',
    name: '古币机',
    // anchors = 窗口客户区相对坐标 + 期望 RGB；空数组 = 这一步永远不会执行（安全默认）
    anchors: [],
    click: { x: 0, y: 0 },
    after: 1200,
    timeout: 6000,
    optional: true,
  },
  {
    id: 'merchant',
    name: '旅行商人',
    anchors: [],
    click: { x: 0, y: 0 },
    after: 1200,
    timeout: 6000,
    optional: true,
  },
  {
    id: 'pass',
    name: '通行证奖励',
    anchors: [],
    click: { x: 0, y: 0 },
    after: 1500,
    timeout: 6000,
    optional: true,
  },
]

export const DEFAULTS = {
  enabled: true,
  game: {
    title: '洛克王国',
    requireForeground: false,
    activateBeforeRun: true,
  },
  pet: {
    enabled: true,
    port: 0,
    owner: 'roco-daily',
    labels: ['洛克日常'],
    lock: true,
  },
  schedule: {
    enabled: true,
    time: '21:30',
    days: [1, 2, 3, 4, 5, 6, 7],
    catchUp: true,
  },
  // 桌宠锚点：记住它在哪，下次启动放回去；换屏时按同一比例落位
  petAnchor: {
    enabled: true,
    saveEveryMs: 10_000,
    tolerance: 0.01,
  },
  steps: DEFAULT_STEPS,
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

export function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out = Array.isArray(base) ? base.slice() : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

/** 把外部 JSON 规整成可安全使用的配置（不信任任何字段）。 */
export function normalize(raw) {
  const cfg = merge(clone(DEFAULTS), raw || {})
  cfg.enabled = cfg.enabled !== false
  cfg.game.title = String(cfg.game?.title ?? '').trim()
  cfg.game.requireForeground = cfg.game?.requireForeground === true
  cfg.game.activateBeforeRun = cfg.game?.activateBeforeRun !== false

  cfg.pet.enabled = cfg.pet?.enabled !== false
  cfg.pet.port = Number.isFinite(Number(cfg.pet?.port)) ? Number(cfg.pet.port) : 0
  cfg.pet.owner = String(cfg.pet?.owner || 'roco-daily')
  cfg.pet.labels = Array.isArray(cfg.pet?.labels) && cfg.pet.labels.length
    ? cfg.pet.labels.map((s) => String(s)).slice(0, 6)
    : ['洛克日常']
  cfg.pet.lock = cfg.pet?.lock !== false

  const pa = (cfg.petAnchor = cfg.petAnchor || {})
  pa.enabled = pa.enabled !== false
  const every = Number(pa.saveEveryMs)
  pa.saveEveryMs = Number.isFinite(every) ? Math.max(3000, Math.min(120_000, every)) : 10_000
  const tol = Number(pa.tolerance)
  pa.tolerance = Number.isFinite(tol) ? Math.max(0, Math.min(0.5, tol)) : 0.01

  const sch = cfg.schedule || {}
  sch.enabled = sch.enabled !== false
  sch.time = parseHHMM(sch.time) ? String(sch.time) : '21:30'
  const days = Array.isArray(sch.days) ? sch.days : [1, 2, 3, 4, 5, 6, 7]
  sch.days = [...new Set(days.map(Number).filter((d) => d >= 1 && d <= 7))].sort()
  if (!sch.days.length) sch.days = [1, 2, 3, 4, 5, 6, 7]
  sch.catchUp = sch.catchUp !== false

  cfg.steps = (Array.isArray(cfg.steps) ? cfg.steps : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => ({
      id: String(s.id || `step-${i + 1}`),
      name: String(s.name || s.id || `步骤 ${i + 1}`),
      anchors: (Array.isArray(s.anchors) ? s.anchors : [])
        .map((a) => ({
          x: Math.round(Number(a?.x) || 0),
          y: Math.round(Number(a?.y) || 0),
          rgb: Array.isArray(a?.rgb) ? a.rgb.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)))) : null,
        }))
        .filter((a) => a.rgb && a.rgb.length === 3),
      click: {
        x: Math.round(Number(s?.click?.x) || 0),
        y: Math.round(Number(s?.click?.y) || 0),
      },
      after: Math.max(0, Math.min(60_000, Number(s?.after) || 0)),
      timeout: Math.max(500, Math.min(120_000, Number(s?.timeout) || 6000)),
      optional: s?.optional === true,
    }))

  return cfg
}

export function readConfig() {
  try {
    return normalize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
  } catch {
    return normalize(null)
  }
}

export function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const tmp = `${CONFIG_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(normalize(cfg), null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_PATH)
  return CONFIG_PATH
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return { lastRunDate: null, lastStatus: null, lastRunAt: null }
  }
}

export function writeState(patch) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const next = { ...readState(), ...patch }
  const tmp = `${STATE_PATH}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, STATE_PATH)
  return next
}
