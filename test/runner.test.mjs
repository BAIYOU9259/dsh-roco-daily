import test from 'node:test'
import assert from 'node:assert/strict'
import { runSteps, summarize } from '../lib/runner.mjs'

const step = (over = {}) => ({
  id: 's',
  name: '步骤',
  anchors: [{ x: 10, y: 10, rgb: [1, 2, 3] }],
  click: { x: 10, y: 10 },
  after: 0,
  timeout: 1000,
  optional: false,
  ...over,
})

const okWindow = () => ({ ok: true, window: { title: 'T', w: 100, h: 100 } })

function fakePs(overrides = {}) {
  const calls = []
  const ps = {
    available: true,
    calls,
    window: () => okWindow(),
    activate: () => ({ ok: true }),
    step: (o) => { calls.push(['step', o]); return { ok: true, matched: true, clicked: { x: o.x, y: o.y } } },
    probe: () => ({ ok: true, colors: [[1, 2, 3]] }),
    ...overrides,
  }
  return ps
}

test('全部命中 → success，且按顺序点击', async () => {
  const ps = fakePs()
  const report = await runSteps({ steps: [step({ id: 'a' }), step({ id: 'b' })], game: { title: 'T' }, ps })
  assert.equal(report.status, 'success')
  assert.equal(report.summary.ok, 2)
  assert.equal(ps.calls.length, 2)
  assert.equal(ps.calls[1][1].x, 10)
})

test('未校准（无锚点）→ skip，不点', async () => {
  const ps = fakePs()
  const report = await runSteps({ steps: [step({ anchors: [] })], game: { title: 'T' }, ps })
  assert.equal(ps.calls.length, 0)
  assert.equal(report.steps[0].reason, 'no-anchors')
  assert.equal(report.status, 'partial')
})

test('可选步骤找不到 → skip，继续往下', async () => {
  const ps = fakePs({
    step: (o) => (o.points.startsWith('10,10') && ps.calls.length === 0
      ? (ps.calls.push(['step', o]), { ok: true, matched: false })
      : (ps.calls.push(['step', o]), { ok: true, matched: true })),
  })
  const report = await runSteps({ steps: [step({ optional: true }), step({ id: 'b' })], game: { title: 'T' }, ps })
  assert.equal(report.steps[0].status, 'skip')
  assert.equal(report.steps[1].status, 'ok')
  assert.equal(report.status, 'partial')
})

test('必选步骤找不到 → failed，立刻停', async () => {
  const seen = []
  const ps = fakePs({ step: (o) => { seen.push(o); return { ok: true, matched: false } } })
  const report = await runSteps({ steps: [step(), step({ id: 'b' })], game: { title: 'T' }, ps })
  assert.equal(report.status, 'failed')
  assert.equal(seen.length, 1)
})

test('窗口不存在 → failed，一步都不点', async () => {
  const ps = fakePs({ window: () => ({ ok: false, error: 'window-not-found' }) })
  const report = await runSteps({ steps: [step()], game: { title: 'T' }, ps })
  assert.equal(report.status, 'failed')
  assert.equal(ps.calls.length, 0)
})

test('跑到一半窗口没了 → aborted', async () => {
  const ps = fakePs({ step: () => ({ ok: false, error: 'window-not-found' }) })
  const report = await runSteps({ steps: [step(), step({ id: 'b' })], game: { title: 'T' }, ps })
  assert.equal(report.status, 'aborted')
})

test('signal 中止 → aborted', async () => {
  const ac = new AbortController()
  const ps = fakePs({ step: () => { ac.abort(); return { ok: true, matched: true } } })
  const report = await runSteps({ steps: [step(), step({ id: 'b' })], game: { title: 'T' }, ps, signal: ac.signal })
  assert.equal(report.status, 'aborted')
})

test('演练模式只取色、绝不点击', async () => {
  let clicked = 0
  const ps = fakePs({
    probe: () => ({ ok: true, colors: [[1, 2, 3]] }),
    step: () => { clicked++; return { ok: true, matched: true } },
  })
  const report = await runSteps({ steps: [step()], game: { title: 'T' }, ps, dry: true })
  assert.equal(clicked, 0)
  assert.equal(report.status, 'success')
})

test('非 Windows → failed 且给出原因', async () => {
  const report = await runSteps({ steps: [step()], game: {}, ps: { available: false } })
  assert.equal(report.status, 'failed')
})

test('summarize', () => {
  assert.deepEqual(
    summarize([{ status: 'ok' }, { status: 'skip' }], 'partial'),
    { ok: 1, skip: 1, fail: 0, status: 'partial' },
  )
})
