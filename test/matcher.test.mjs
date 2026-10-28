import test from 'node:test'
import assert from 'node:assert/strict'
import { anchorsMatch, anchorsToSpec, colorMatches, pointsToSpec } from '../lib/matcher.mjs'

test('colorMatches: 容差内为真，超差为假', () => {
  assert.equal(colorMatches([10, 20, 30], [10, 20, 30]), true)
  assert.equal(colorMatches([10, 20, 30], [28, 20, 30], 18), true)
  assert.equal(colorMatches([10, 20, 30], [29, 20, 30], 18), false)
  assert.equal(colorMatches([10, 20, 30], [-1, -1, -1]), false)
  assert.equal(colorMatches([10, 20, 30], null), false)
})

test('colorMatches: 没有期望色时恒真（只校验窗口在）', () => {
  assert.equal(colorMatches(null, [1, 2, 3]), true)
})

test('anchorsMatch: 全部命中才算', () => {
  const anchors = [{ rgb: [1, 2, 3] }, { rgb: [200, 100, 50] }]
  assert.equal(anchorsMatch(anchors, [[1, 2, 3], [200, 100, 50]]), true)
  assert.equal(anchorsMatch(anchors, [[1, 2, 3], [200, 100, 80]]), false)
})

test('anchorsMatch: 空锚点 / 颜色不足 → 直接假（不会盲点）', () => {
  assert.equal(anchorsMatch([], []), false)
  assert.equal(anchorsMatch([{ rgb: [0, 0, 0] }], []), false)
})

test('spec 序列化格式与 win.ps1 对齐', () => {
  assert.equal(anchorsToSpec([{ x: 1, y: 2, rgb: [3, 4, 5] }]), '1,2,3,4,5')
  assert.equal(pointsToSpec([{ x: 1, y: 2 }, { x: 3, y: 4 }]), '1,2;3,4')
})
