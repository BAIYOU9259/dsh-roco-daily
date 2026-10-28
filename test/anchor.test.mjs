import test from 'node:test'
import assert from 'node:assert/strict'
import { makeAnchor, pickScreen, planRestore, screenOfRect, toAbsolute } from '../lib/anchor.mjs'

const S1 = { deviceName: '\\\\.\\DISPLAY1', x: 0, y: 0, w: 2048, h: 1152, primary: true }
const S2 = { deviceName: '\\\\.\\DISPLAY5', x: -1920, y: 0, w: 1920, h: 1080, primary: false }
const BOTH = [S1, S2]

test('screenOfRect: 按中心点归属', () => {
  assert.equal(screenOfRect(BOTH, { x: 100, y: 100, w: 200, h: 200 }).deviceName, S1.deviceName)
  assert.equal(screenOfRect(BOTH, { x: -1800, y: 100, w: 200, h: 200 }).deviceName, S2.deviceName)
})

test('screenOfRect: 都在屏幕外时给最近的', () => {
  const far = screenOfRect(BOTH, { x: -5000, y: -5000, w: 10, h: 10 })
  assert.ok(far)
})

test('pickScreen: 同 deviceName 优先', () => {
  assert.equal(pickScreen(BOTH, { screen: { deviceName: S2.deviceName } }).deviceName, S2.deviceName)
})

test('pickScreen: 屏幕没了 → 退回主屏（这就是"单屏时按比例落位"的前提）', () => {
  const saved = { screen: { deviceName: '\\\\.\\GONE', x: -3000, y: 0, w: 1000, h: 800 } }
  assert.equal(pickScreen([S1], saved).deviceName, S1.deviceName)
})

test('toAbsolute: 归一化按目标屏尺寸等比换算', () => {
  assert.deepEqual(toAbsolute(S1, 0.5, 0.5), { x: 1024, y: 576 })
  assert.deepEqual(toAbsolute(S2, 0.5, 0.5), { x: -960, y: 540 })
})

test('makeAnchor: 有窗口矩形就带上屏幕信息', () => {
  const a = makeAnchor({ pose: { x: 0.25, y: 0.75 }, screens: BOTH, rect: { x: -1800, y: 100, w: 300, h: 300 } })
  assert.equal(a.nx, 0.25)
  assert.equal(a.ny, 0.75)
  assert.equal(a.screen.deviceName, S2.deviceName)
})

test('makeAnchor: 拿不到矩形也能存（screen 记 null）', () => {
  const a = makeAnchor({ pose: { x: 0.25, y: 0.75 }, screens: [], rect: null })
  assert.equal(a.screen, null)
  assert.equal(a.nx, 0.25)
})

test('makeAnchor: 没有位姿就返回 null', () => {
  assert.equal(makeAnchor({ pose: null, screens: BOTH, rect: null }), null)
})

test('planRestore: 没存档 → 不动', () => {
  assert.equal(planRestore({ saved: null, screens: BOTH, pose: { x: 0.1, y: 0.1 } }).apply, false)
})

test('planRestore: 同屏同位置 → 不动', () => {
  const saved = makeAnchor({ pose: { x: 0.3, y: 0.4 }, screens: BOTH, rect: { x: 100, y: 100, w: 200, h: 200 } })
  const p = planRestore({ saved, screens: BOTH, pose: { x: 0.302, y: 0.401 } })
  assert.equal(p.apply, false)
  assert.equal(p.reason, 'already-there')
})

test('planRestore: 同屏但位置变了 → 挪回去', () => {
  const saved = makeAnchor({ pose: { x: 0.3, y: 0.4 }, screens: BOTH, rect: { x: 100, y: 100, w: 200, h: 200 } })
  const p = planRestore({ saved, screens: BOTH, pose: { x: 0.8, y: 0.9 } })
  assert.equal(p.apply, true)
  assert.equal(p.reason, 'restore-same-screen')
  assert.equal(p.x, 0.3)
})

test('planRestore: 原来的屏没了 → 用同一组比例落到剩下的屏', () => {
  const saved = { nx: 0.9, ny: 0.8, screen: { deviceName: '\\\\.\\GONE', x: -3000, y: 0, w: 1000, h: 800 } }
  const p = planRestore({ saved, screens: [S1], pose: null })
  assert.equal(p.apply, true)
  assert.equal(p.reason, 'restore-proportional')
  assert.equal(p.screen.deviceName, S1.deviceName)
  assert.equal(p.x, 0.9)
  assert.equal(p.y, 0.8)
})

test('planRestore: 拿不到屏幕信息时仍按坐标恢复', () => {
  const saved = { nx: 0.2, ny: 0.3, screen: null }
  const p = planRestore({ saved, screens: [], pose: { x: 0.9, y: 0.9 } })
  assert.equal(p.apply, true)
  assert.equal(p.reason, 'no-screen-info')
})
