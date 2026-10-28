/**
 * 桌宠桥：注册右键菜单 → 长轮询点击 → 触发执行器。
 * 桌宠不在时安静退避，不打断任何东西。
 */
import { sleep } from './runner.mjs'

export function normalizeMenuEvents(data) {
  if (!data) return []
  if (Array.isArray(data)) {
    return data
      .map((x) => (typeof x === 'string' ? x : x?.label || x?.name || null))
      .filter(Boolean)
  }
  if (typeof data === 'object') {
    if (Array.isArray(data.items)) return normalizeMenuEvents(data.items)
    if (typeof data.label === 'string') return [data.label]
    // 形如 { "洛克日常": "main", "别的": null } —— 只认非空值
    return Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k]) => k)
  }
  return []
}

export function createBridge({ pet, getConfig, runner, log = () => {} }) {
  let stopped = false
  let loopPromise = null

  async function handleLabel(label) {
    const cfg = getConfig()
    const stopLabel = (cfg.pet?.labels || []).find((l) => /停/.test(l))
    if (stopLabel && label === stopLabel) {
      const ok = runner.stop()
      pet.broadcast(ok ? '停了。' : '现在没在跑。').catch(() => {})
      return
    }
    const started = await runner.start('menu')
    if (!started.ok) {
      pet.broadcast(started.error === 'already-running' ? '正在跑了，别催。' : `起不来：${started.error}`).catch(() => {})
    }
  }

  async function main() {
    const cfg = getConfig()
    if (cfg.pet?.enabled === false || !pet?.base) return
    const labels = cfg.pet?.labels || ['洛克日常']
    let backoff = 1000
    let registered = false

    while (!stopped) {
      if (!registered) {
        const r = await pet.registerMenu(labels).catch(() => ({ ok: false }))
        if (r.ok) {
          registered = true
          backoff = 1000
          log('[roco-daily] 桌宠菜单已注册')
        } else {
          await sleep(backoff)
          backoff = Math.min(backoff * 2, 60_000)
          continue
        }
      }

      const r = await pet.pollMenu(25).catch(() => ({ ok: false }))
      if (stopped) break
      if (!r.ok) {
        registered = false
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 60_000)
        continue
      }
      backoff = 1000
      for (const label of normalizeMenuEvents(r.data)) {
        if (stopped) break
        try { await handleLabel(label) } catch (e) { log(`[roco-daily] menu handler: ${e?.message || e}`) }
      }
      await sleep(300)
    }
  }

  return {
    start() {
      if (loopPromise) return loopPromise
      loopPromise = main().catch((e) => log(`[roco-daily] bridge exit: ${e?.message || e}`))
      return loopPromise
    },
    async stop() {
      stopped = true
      try { await pet.releaseLock(true) } catch {}
    },
  }
}
