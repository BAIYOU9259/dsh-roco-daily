import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createBridge } from '../lib/bridge.mjs'
import { createPetClient } from '../lib/pet.mjs'

/** 假桌宠：只实现本插件用到的 4 个端点 */
function fakePet() {
  const seen = { menu: null, broadcast: [], poll: 0 }
  let pending = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
    if (url.pathname.endsWith('/menu/item')) {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { try { seen.menu = JSON.parse(body) } catch {} send(200, { ok: true }) })
      return
    }
    if (url.pathname.endsWith('/menu/events')) {
      seen.poll++
      const batch = pending
      pending = []
      send(200, batch.length ? Object.fromEntries(batch.map((l) => [l, 'main'])) : {})
      return
    }
    if (url.pathname.endsWith('/broadcast')) {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { try { seen.broadcast.push(JSON.parse(body).text) } catch {} send(200, { ok: true }) })
      return
    }
    send(404, { ok: false })
  })
  return { server, seen, push: (label) => pending.push(label) }
}

test('bridge: 注册菜单 → 收到点击 → 触发 runner', async () => {
  const f = fakePet()
  await new Promise((r) => f.server.listen(0, '127.0.0.1', r))
  const port = f.server.address().port
  const pet = createPetClient({ base: `http://127.0.0.1:${port}/dsh-pet-7340` })

  let started = 0
  const runner = { running: false, start: async () => { started++; return { ok: true } }, stop: () => true }
  const bridge = createBridge({
    pet,
    getConfig: () => ({ pet: { enabled: true, labels: ['洛克日常', '停止日常'], owner: 'roco-daily' } }),
    runner,
    log: () => {},
  })
  bridge.start()
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(f.seen.menu, '菜单应该被注册')
  assert.deepEqual(f.seen.menu.labels, ['洛克日常', '停止日常'])

  f.push('洛克日常')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(started, 1)

  await bridge.stop()
  f.server.close()
})
