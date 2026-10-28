import test from 'node:test'
import assert from 'node:assert/strict'
import { normalize, merge } from '../lib/config.mjs'

test('normalize: 空配置也能用，且默认不盲点', () => {
  const cfg = normalize(null)
  assert.equal(cfg.enabled, true)
  assert.ok(cfg.steps.length >= 3)
  for (const s of cfg.steps) assert.equal(s.anchors.length, 0)
})

test('normalize: 坏数据被压平，不抛', () => {
  const cfg = normalize({
    enabled: 'yes',
    schedule: { time: '99:99', days: [0, 9, 'x', 3, 3] },
    steps: [null, 5, { id: 'a', anchors: [{ x: 'q', y: 2, rgb: [999, -5, 'z'] }] }],
  })
  assert.equal(cfg.schedule.time, '21:30')
  assert.deepEqual(cfg.schedule.days, [3])
  assert.equal(cfg.steps.length, 1)
  assert.deepEqual(cfg.steps[0].anchors[0].rgb, [255, 0, 0])
})

test('normalize: 锚点少了 rgb 会被丢掉（宁可不点）', () => {
  const cfg = normalize({ steps: [{ id: 'x', anchors: [{ x: 1, y: 2 }, { x: 3, y: 4, rgb: [1, 2, 3] }] }] })
  assert.equal(cfg.steps[0].anchors.length, 1)
})

test('normalize: after / timeout 被夹到安全区间', () => {
  const cfg = normalize({ steps: [{ id: 'x', after: 1e9, timeout: 1, anchors: [] }] })
  assert.equal(cfg.steps[0].after, 60_000)
  assert.equal(cfg.steps[0].timeout, 500)
})

test('normalize: 没给 days 时补全七天', () => {
  const cfg = normalize({ schedule: { time: '08:00', days: [] } })
  assert.deepEqual(cfg.schedule.days, [1, 2, 3, 4, 5, 6, 7])
})

test('merge: 深合并且不污染默认值', () => {
  const base = { a: { x: 1, y: 2 }, b: 1 }
  const out = merge(base, { a: { y: 9 } })
  assert.deepEqual(out, { a: { x: 1, y: 9 }, b: 1 })
  assert.deepEqual(base, { a: { x: 1, y: 2 }, b: 1 })
})
