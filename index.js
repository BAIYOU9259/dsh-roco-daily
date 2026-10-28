/**
 * dsh-roco-daily —— 宿主半边
 *
 * 生命周期：DSH 启动时 apply() 跑一次 → 桌宠菜单挂上、排班计时器起来。
 * 运行时零 LLM 调用：全部是本地脚本 + 本地 HTTP。
 */
import { CONFIG_PATH, readConfig, readState, writeState } from './lib/config.mjs'
import { makePs } from './lib/ps.mjs'
import { createPetClient, petBase } from './lib/pet.mjs'
import { createRunner } from './lib/runner.mjs'
import { createBridge } from './lib/bridge.mjs'
import { localDateKey, todaySlotPassed } from './lib/schedule.mjs'

const API = '/roco-daily/api'
const TICK_MS = 30_000

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
      try { bridge.stop() } catch {}
      log('[roco-daily] 已卸载')
    })

    log(`[roco-daily] 已启动（桌宠 ${base || '未连接'} · 排班 ${state.cfg.schedule.enabled ? state.cfg.schedule.time : '关'}）`)
  },
}
