/**
 * dsh-pet 的 HTTP 客户端（本机 127.0.0.1，无鉴权，只做只读/播报）。
 * 设计原则：桌宠不在也绝不炸——每个方法都吞异常，返回 {ok, ...}。
 */

export function petBase(port) {
  return `http://127.0.0.1:${port}/dsh-pet-7340`
}

const DEFAULT_TIMEOUT = 2500

async function req(base, pathname, { method = 'GET', body, timeout = DEFAULT_TIMEOUT, query } = {}) {
  if (!base) return { ok: false, error: 'no-base' }
  const url = new URL(base.replace(/\/$/, '') + pathname)
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v))
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const r = await fetch(url, {
      method,
      signal: ac.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await r.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }
    if (!r.ok) return { ok: false, status: r.status, error: data?.error || data?.reason || `http-${r.status}`, data }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

export function createPetClient({ base, owner = 'roco-daily' } = {}) {
  let lockId = null

  return {
    base,
    get locked() { return !!lockId },

    async ping() {
      return req(base, '/state', { timeout: 1200 })
    },

    async registerMenu(labels) {
      return req(base, '/menu/item', { method: 'POST', body: { owner, labels } })
    },

    async pollMenu(waitSec = 25) {
      return req(base, '/menu/events', { timeout: (waitSec + 5) * 1000, query: { owner, wait: waitSec } })
    },

    async acquireLock() {
      const r = await req(base, '/lock', { method: 'POST' })
      if (r.ok) lockId = r.data?.lockId ?? r.data?.id ?? null
      return r
    },

    async releaseLock(force = false) {
      if (!lockId && !force) return { ok: false, error: 'no-lock' }
      const r = await req(base, '/lock/release', { method: 'POST', query: { lock: lockId, force: force ? 1 : undefined } })
      lockId = null
      return r
    },

    async broadcast(text, { duration } = {}) {
      return req(base, '/broadcast', { method: 'POST', body: { text, ...(duration ? { duration } : {}) }, query: { lock: lockId } })
    },

    async anim(name) {
      if (!name) return { ok: false, error: 'no-name' }
      return req(base, '/anim', { method: 'POST', body: { name }, query: { lock: lockId } })
    },

    async workStatus(state, task) {
      return req(base, '/work-status', { method: 'POST', body: { state, ...(task ? { task } : {}) } })
    },

    /** 当前位姿：{x,y} 为屏内归一化坐标（0~1） */
    async pose(petId = 'main') {
      return req(base, '/pose', { query: { pet: petId }, timeout: 1500 })
    },

    /** 挪到屏内归一化坐标；mode: instant | spring | line */
    async moveTo(x, y, { petId = 'main', mode = 'instant', surface = 'desktop' } = {}) {
      return req(base, '/position', {
        method: 'POST',
        body: { x, y, mode },
        query: { pet: petId, surface },
      })
    },
  }
}
