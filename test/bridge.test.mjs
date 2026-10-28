import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMenuEvents } from '../lib/bridge.mjs'

test('菜单事件：对象形态只认非空值', () => {
  assert.deepEqual(normalizeMenuEvents({ 洛克日常: 'main', 别的: null }), ['洛克日常'])
})

test('菜单事件：数组形态（字符串 / 对象）', () => {
  assert.deepEqual(normalizeMenuEvents(['洛克日常', { label: '停止日常' }]), ['洛克日常', '停止日常'])
})

test('菜单事件：单条 {label} 也认', () => {
  assert.deepEqual(normalizeMenuEvents({ label: '洛克日常' }), ['洛克日常'])
})

test('菜单事件：items 包一层也认', () => {
  assert.deepEqual(normalizeMenuEvents({ items: [{ name: 'A' }] }), ['A'])
})

test('菜单事件：乱七八糟的输入不炸', () => {
  assert.deepEqual(normalizeMenuEvents(null), [])
  assert.deepEqual(normalizeMenuEvents('x'), [])
  assert.deepEqual(normalizeMenuEvents({}), [])
})
