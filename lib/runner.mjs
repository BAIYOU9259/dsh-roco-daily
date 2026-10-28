/**
 * 执行器：按配置的步骤跑一遍，不调用任何模型。
 * 每一步 = 「等到画面出现预期色点」→「点一下」→「等一下」。
 */
import { anchorsToSpec, anchorsMatch } from './matcher.mjs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runSteps({ steps, game, ps, dry = false, signal, onEvent = () => {}, sleepFn = sleep, tol = 18 }) {
  const startedAt = new Date()
  const results = []
  const emit = (e) => {
    try { onEvent(e) } catch {}
  }
  const finish = (status) => {
    const endedAt = new Date()
    return {
      status,
      dry,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt - startedAt,
      steps: results,
      summary: summarize(results, status),
    }
  }

  emit({ type: 'start', total: steps.length, dry })
  if (!ps?.available) {
    emit({ type: 'done', status: 'failed', reason: 'windows-only' })
    return finish('failed')
  }

  const win = ps.window(game?.title ?? '')
  if (!win?.ok) {
    results.push({ id: 'window', name: '找窗口', status: 'fail', reason: win?.error || 'window-not-found' })
    emit({ type: 'step', index: 0, total: steps.length, id: 'window', status: 'fail', reason: win?.error || 'window-not-found' })
    emit({ type: 'done', status: 'failed', reason: 'window-not-found' })
    return finish('failed')
  }
  if (game?.activateBeforeRun) ps.activate(game?.title ?? '')
  emit({ type: 'window', title: win.window?.title, w: win.window?.w, h: win.window?.h })

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const base = { id: step.id, name: step.name }
    if (signal?.aborted) {
      emit({ type: 'done', status: 'aborted' })
      return finish('aborted')
    }
    if (!step.anchors?.length) {
      results.push({ ...base, status: 'skip', reason: 'no-anchors' })
      emit({ type: 'step', index: i + 1, total: steps.length, ...base, status: 'skip', reason: 'no-anchors' })
      continue
    }

    const t0 = Date.now()
    let outcome
    if (dry) {
      const probe = ps.probe(game.title, anchorsToSpec(step.anchors))
      const ok = probe?.ok && anchorsMatch(step.anchors, probe.colors, tol)
      outcome = ok ? { ok: true, matched: true } : { ok: true, matched: false, error: probe?.error }
    } else {
      outcome = ps.step({
        title: game.title,
        points: anchorsToSpec(step.anchors),
        tol,
        timeoutMs: step.timeout,
        x: step.click?.x ?? -1,
        y: step.click?.y ?? -1,
      })
    }
    const elapsed = Date.now() - t0

    if (!outcome?.ok) {
      const reason = outcome?.error || 'ps-failed'
      if (reason === 'window-not-found') {
        results.push({ ...base, status: 'fail', reason, elapsed })
        emit({ type: 'done', status: 'aborted', reason })
        return finish('aborted')
      }
      results.push({ ...base, status: step.optional ? 'skip' : 'fail', reason, elapsed })
      emit({ type: 'step', index: i + 1, total: steps.length, ...base, status: step.optional ? 'skip' : 'fail', reason, elapsed })
      if (!step.optional) {
        emit({ type: 'done', status: 'failed', reason: `${step.name}: ${reason}` })
        return finish('failed')
      }
      continue
    }

    if (!outcome.matched) {
      const status = step.optional ? 'skip' : 'fail'
      results.push({ ...base, status, reason: 'not-found', elapsed })
      emit({ type: 'step', index: i + 1, total: steps.length, ...base, status, reason: 'not-found', elapsed })
      if (status === 'fail') {
        emit({ type: 'done', status: 'failed', reason: `${step.name}: not-found` })
        return finish('failed')
      }
      continue
    }

    results.push({ ...base, status: 'ok', elapsed })
    emit({ type: 'step', index: i + 1, total: steps.length, ...base, status: 'ok', elapsed })
    if (step.after) await sleepFn(step.after)
  }

  const failed = results.some((r) => r.status === 'fail')
  const skipped = results.some((r) => r.status === 'skip')
  const status = failed ? 'failed' : skipped ? 'partial' : 'success'
  emit({ type: 'done', status })
  return finish(status)
}

export function summarize(results, status) {
  const ok = results.filter((r) => r.status === 'ok').length
  const skip = results.filter((r) => r.status === 'skip').length
  const fail = results.filter((r) => r.status === 'fail').length
  return { ok, skip, fail, status }
}

/**
 * 一次只跑一个；跑的时候把桌宠当显示器用（锁 → 气泡 → 动作 → 解锁）。
 */
export function createRunner({ getConfig, pet, ps, log = () => {} }) {
  let current = null
  let lastReport = null

  function notify(text) {
    if (!pet?.base) return
    pet.broadcast(text).catch(() => {})
  }

  async function start(reason = 'manual') {
    if (current) return { ok: false, error: 'already-running' }
    const cfg = getConfig()
    if (!cfg.enabled) return { ok: false, error: 'disabled' }
    const ac = new AbortController()
    const usePet = cfg.pet?.enabled !== false && !!pet?.base

    current = { ac, reason, startedAt: new Date() }

    if (usePet) {
      if (cfg.pet?.lock !== false) await pet.acquireLock().catch(() => {})
      await pet.anim('working').catch(() => {})
      notify(`去跑洛克日常了（${reason === 'schedule' ? '定时' : '手动'}）`)
    }

    let report
    try {
      report = await runSteps({
        steps: cfg.steps,
        game: cfg.game,
        ps,
        dry: reason === 'dry',
        signal: ac.signal,
        onEvent: (e) => {
          if (e.type === 'step' && e.status === 'ok') notify(`${e.index}/${e.total} ${e.name} ✓`)
          if (e.type === 'step' && e.status === 'fail') notify(`${e.name} 卡住了：${e.reason}`)
        },
      })
    } catch (e) {
      report = { status: 'failed', steps: [], summary: { status: 'failed' }, error: String(e?.message || e) }
    }

    if (usePet) {
      const s = report.summary || {}
      if (report.status === 'success') {
        await pet.anim('success').catch(() => {})
        notify(`日常清完了：${s.ok || 0} 步 ✓`)
      } else if (report.status === 'partial') {
        notify(`跑了一半：${s.ok || 0} 成 / ${s.skip || 0} 跳`)
      } else {
        await pet.anim('failed').catch(() => {})
        notify(`卡住了：${report.steps?.find((x) => x.status === 'fail')?.name || report.status}`)
      }
      if (cfg.pet?.lock !== false) await pet.releaseLock(true).catch(() => {})
    }

    lastReport = { ...report, reason, at: new Date().toISOString() }
    current = null
    log(`[roco-daily] run ${reason} → ${report.status}`)
    return { ok: true, report: lastReport }
  }

  return {
    start,
    stop() {
      if (!current) return false
      current.ac.abort()
      return true
    },
    get running() {
      return !!current
    },
    get status() {
      return { running: !!current, since: current?.startedAt?.toISOString() || null, last: lastReport }
    },
  }
}
