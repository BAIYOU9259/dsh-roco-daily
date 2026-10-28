/**
 * dsh-roco-daily —— 宿主半边
 *
 * 生命周期：DSH 启动时 apply() 跑一次 → 桌宠菜单挂上、排班计时器起来。
 * 运行时零 LLM 调用：全部是本地脚本 + 本地 HTTP。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_PATH, STATE_DIR, readConfig, readState, writeState } from './lib/config.mjs'
import { makePs } from './lib/ps.mjs'
import { createPetClient, petBase } from './lib/pet.mjs'
import { createRunner } from './lib/runner.mjs'
import { createBridge } from './lib/bridge.mjs'
import { localDateKey, todaySlotPassed } from './lib/schedule.mjs'
import { makeAnchor, planRestore } from './lib/anchor.mjs'

const API = '/roco-daily/api'
const TICK_MS = 30_000
const ANCHOR_PATH = path.join(STATE_DIR, 'pet-anchor.json')
const PET_ID = 'main'

function readAnchor() {
  try { return JSON.parse(fs.readFileSync(ANCHOR_PATH, 'utf8')) } catch { return null }
}

function writeAnchor(a) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${ANCHOR_PATH}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(a, null, 2), 'utf8')
    fs.renameSync(tmp, ANCHOR_PATH)
  } catch {}
}

function resolvePort(ctx) {
  const ws = ctx?.webServer
  const candidates = [
    ws?.port,
    ws?.server?.address?.()?.port,
    ws?.address?.()?.port,
    ws?.httpServer?.address?.()?.port,
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function json(res, code, body) {
  try {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  } catch {}
}

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let data = ''
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { resolve(''); req.destroy(); return }
      data += c
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

export default {
  inject: ['webServer', 'connection'],

  apply(ctx) {
    const log = (m) => {
      try { console.log(m) } catch {}
    }
    const ps = makePs()
    const state = { cfg: readConfig(), timer: null, bridge: null, runner: null }

    const getConfig = () => {
      state.cfg = readConfig()
      return state.cfg
    }

    const port = resolvePort(ctx)
    const base = port ? petBase(port) : null
    if (base) {
      try { writeState({ petBase: base, port }) } catch {}
    }
    const pet = createPetClient({ base, owner: state.cfg?.pet?.owner || 'roco-daily' })
    const runner = createRunner({ getConfig, pet, ps, log })
    state.runner = runner

    // —— 桌宠锚点：记住它在哪，下次启动放回去 --------------------------------
    // dsh-pet 自己每次启动都会回到 config 的 corner，不记用户拖到哪。
    let anchorTimer = null
    const anchorEnabled = () => {
      const c = getConfig()
      return !!base && (c.petAnchor?.enabled !== false) && (c.pet?.enabled !== false)
    }

    const snapshot = async () => {
      const pose = await pet.pose(PET_ID)
      if (!pose.ok || !pose.data) return null
      const scr = ps.screens()
      const rect = ps.petRect('electron')
      return makeAnchor({
        pose: pose.data,
        screens: scr?.ok ? scr.screens : [],
        rect: rect?.ok ? rect.rect : null,
      })
    }

    const saveAnchor = async () => {
      const a = await snapshot()
      if (!a) return null
      const prev = readAnchor()
      if (prev && prev.nx === a.nx && prev.ny === a.ny
        && prev.screen?.deviceName === a.screen?.deviceName) return prev
      writeAnchor(a)
      return a
    }

    /** DSH 启动若干秒后跑一次：把宠物挪回上次的位置（换屏则按比例）。 */
    const restoreAnchor = async () => {
      if (!anchorEnabled()) return { ok: false, reason: 'disabled' }
      const saved = readAnchor()
      if (!saved) return { ok: false, reason: 'no-anchor' }
      const pose = await pet.pose(PET_ID)
      const scr = ps.screens()
      const plan = planRestore({
        saved,
        screens: scr?.ok ? scr.screens : [],
        pose: pose?.ok ? pose.data : null,
        tolerance: Number(getConfig().petAnchor?.tolerance ?? 0.01),
      })
      if (!plan.apply) return { ok: true, applied: false, reason: plan.reason }
      const r = await pet.moveTo(plan.x, plan.y, { petId: PET_ID })
      log(`[roco-daily] 桌宠归位 → ${plan.x.toFixed(3)},${plan.y.toFixed(3)}（${plan.reason}）`)
      return { ok: r.ok, applied: r.ok, reason: plan.reason, x: plan.x, y: plan.y, error: r.error }
    }

    // —— 排班：DSH 开着的时候每 30 秒看一眼 ------------------------------------
    let lastTickDay = null
    const tick = async () => {
      try {
        const cfg = getConfig()
        if (!cfg.enabled || !cfg.schedule.enabled) return
        const now = new Date()
        const dayKey = localDateKey(now)
        const st = readState()
        if (st.lastRunDate === dayKey) return
        if (runner.running) return

        const passed = todaySlotPassed(now, cfg.schedule)
        const catchUpOk = cfg.schedule.catchUp !== false
        if (!passed) return
        // 不补跑：只在时间点后 15 分钟内触发
        const slot = new Date(now.getTime())
        const [h, m] = String(cfg.schedule.time).split(':').map(Number)
        slot.setHours(h, m, 0, 0)
        const lateMin = (now.getTime() - slot.getTime()) / 60000
        if (!catchUpOk && lateMin > 15) return

        lastTickDay = dayKey
        log(`[roco-daily] 到点，开始跑日常（迟到 ${Math.round(lateMin)} 分钟）`)
        const r = await runner.start('schedule')
        writeState({
          lastRunDate: dayKey,
          lastRunAt: new Date().toISOString(),
          lastStatus: r?.report?.status ?? 'unknown',
        })
      } catch (e) {
        log(`[roco-daily] tick error: ${e?.message || e}`)
      }
    }

    // —— 桌宠桥 ---------------------------------------------------------------
    const bridge = createBridge({ pet, getConfig, runner, log })
    state.bridge = bridge
    if (base) bridge.start().catch(() => {})
    else log('[roco-daily] 拿不到 DSH 端口 → 桌宠联动关闭（日常仍可用 CLI 跑）')

    state.timer = setInterval(() => { tick() }, TICK_MS)
    if (state.timer.unref) state.timer.unref()
    setTimeout(() => { tick() }, 20_000)

    // 桌宠归位：等桌宠起来（首次可能会下载 Electron，给足时间）
    setTimeout(() => { restoreAnchor().catch(() => {}) }, 15_000)
    // 之后每 N 秒记一次位置（用户拖动 / 它自己溜达都算"最后位置"）
    const anchorMs = Math.max(3000, Math.min(120_000, Number(state.cfg.petAnchor?.saveEveryMs) || 10_000))
    if (base) {
      anchorTimer = setInterval(() => {
        if (!anchorEnabled()) return
        saveAnchor().catch(() => {})
      }, anchorMs)
      if (anchorTimer.unref) anchorTimer.unref()
    }

    // —— 本地 HTTP：给设置页 / CLI 用 -----------------------------------------
    try {
      const reg = (pathname, handler) => {
        if (!ctx?.webServer?.register) return
        ctx.webServer.register({
          kind: 'exact',
          path: pathname,
          handler: async (req, res) => {
            try { await handler(req, res) } catch (e) { json(res, 500, { ok: false, error: String(e?.message || e) }) }
          },
        })
      }

      reg(`${API}/status`, async (req, res) => {
        const st = readState()
        json(res, 200, {
          ok: true,
          running: runner.running,
          runner: runner.status,
          state: st,
          petBase: base,
          configPath: CONFIG_PATH,
          game: getConfig().game,
          anchor: { path: ANCHOR_PATH, saved: readAnchor() },
        })
      })

      reg(`${API}/run`, async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false })
        const body = await readBody(req)
        let dry = false
        try { dry = JSON.parse(body || '{}').dry === true } catch {}
        const r = await runner.start(dry ? 'dry' : 'api')
        json(res, r.ok ? 200 : 409, r)
      })

      reg(`${API}/stop`, async (req, res) => {
        json(res, 200, { ok: runner.stop() })
      })
    } catch (e) {
      log(`[roco-daily] 路由注册失败: ${e?.message || e}`)
    }

    ctx.effect(() => () => {
      try { clearInterval(state.timer) } catch {}
      try { if (anchorTimer) clearInterval(anchorTimer) } catch {}
      try { bridge.stop() } catch {}
      log('[roco-daily] 已卸载')
    })

    log(`[roco-daily] 已启动（桌宠 ${base || '未连接'} · 排班 ${state.cfg.schedule.enabled ? state.cfg.schedule.time : '关'}）`)
  },
}
