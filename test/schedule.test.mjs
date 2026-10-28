import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateKey, nextRunAt, parseHHMM, todaySlotPassed, isoDay } from '../lib/schedule.mjs'

const at = (s) => new Date(s)

test('parseHHMM', () => {
  assert.deepEqual(parseHHMM('21:30'), { h: 21, min: 30 })
  assert.deepEqual(parseHHMM('0:05'), { h: 0, min: 5 })
  assert.equal(parseHHMM('24:00'), null)
  assert.equal(parseHHMM('abc'), null)
})

test('isoDay: 周日=7', () => {
  assert.equal(isoDay(at('2026-10-25T12:00:00')), 7) // 2026-10-25 是周日
  assert.equal(isoDay(at('2026-10-26T12:00:00')), 1)
})

test('nextRunAt: 今天还没到 → 今天', () => {
  const now = at('2026-10-28T08:00:00')
  const next = nextRunAt(now, { time: '21:30', days: [1, 2, 3, 4, 5, 6, 7] })
  assert.equal(localDateKey(next), '2026-10-28')
  assert.equal(next.getHours(), 21)
})

test('nextRunAt: 今天已过 → 明天', () => {
  const now = at('2026-10-28T23:00:00')
  const next = nextRunAt(now, { time: '21:30', days: [1, 2, 3, 4, 5, 6, 7] })
  assert.equal(localDateKey(next), '2026-10-29')
})

test('nextRunAt: 跳过不匹配的星期', () => {
  // 2026-10-28 是周三；只排周一 → 下一个周一是 11-02
  const now = at('2026-10-28T08:00:00')
  const next = nextRunAt(now, { time: '09:00', days: [1] })
  assert.equal(localDateKey(next), '2026-11-02')
})

test('todaySlotPassed', () => {
  const sch = { time: '21:30', days: [3] }
  assert.equal(todaySlotPassed(at('2026-10-28T21:00:00'), sch), false)
  assert.equal(todaySlotPassed(at('2026-10-28T21:31:00'), sch), true)
  assert.equal(todaySlotPassed(at('2026-10-28T22:00:00'), { time: '21:30', days: [1] }), false)
})

test('localDateKey 补零', () => {
  assert.equal(localDateKey(at('2026-01-05T10:00:00')), '2026-01-05')
})
