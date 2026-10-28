/**
 * 调 win.ps1 的薄封装。所有调用都是「同步子进程 + JSON 解析」。
 * 失败永远返回 {ok:false, error}，不抛。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'win.ps1')

export const isWindows = process.platform === 'win32'

function psExe() {
  return process.env.ROCO_POWERSHELL || (isWindows ? 'powershell.exe' : 'pwsh')
}

/**
 * @param {object} opts  { action, title, points, tol, timeoutMs, pollMs, x, y, out }
 */
export function runPs(opts, { timeoutMs = 60_000 } = {}) {
  if (!isWindows) return { ok: false, error: 'windows-only' }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', opts.action]
  if (opts.title !== undefined) args.push('-Title', String(opts.title))
  if (opts.points !== undefined) args.push('-Points', String(opts.points))
  if (opts.tol !== undefined) args.push('-Tol', String(opts.tol))
  if (opts.timeout !== undefined) args.push('-TimeoutMs', String(opts.timeout))
  if (opts.pollMs !== undefined) args.push('-PollMs', String(opts.pollMs))
  if (opts.x !== undefined) args.push('-X', String(opts.x))
  if (opts.y !== undefined) args.push('-Y', String(opts.y))
  if (opts.out !== undefined) args.push('-Out', String(opts.out))

  const r = spawnSync(psExe(), args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (r.error) return { ok: false, error: `spawn:${r.error.code || r.error.message}` }
  const raw = String(r.stdout || '').trim()
  if (!raw) return { ok: false, error: `empty-output:${String(r.stderr || '').slice(0, 300)}` }
  try {
    return JSON.parse(raw)
  } catch {
    return { ok: false, error: `bad-json:${raw.slice(0, 300)}` }
  }
}

export function makePs() {
  return {
    available: isWindows,
    window: (title) => runPs({ action: 'window', title }),
    activate: (title) => runPs({ action: 'activate', title }),
    cursor: () => runPs({ action: 'cursor' }),
    probe: (title, points) => runPs({ action: 'probe', title, points }),
    shot: (title, out) => runPs({ action: 'shot', title, out }),
    step: ({ title, points, tol, timeoutMs, pollMs, x, y }) =>
      runPs({ action: 'step', title, points, tol, timeoutMs, pollMs, x, y }, { timeoutMs: (timeoutMs || 6000) + 30_000 }),
  }
}
