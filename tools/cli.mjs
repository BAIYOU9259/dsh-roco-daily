#!/usr/bin/env node
/**
 * dsh-roco-daily CLI
 *
 *   node tools/cli.mjs status
 *   node tools/cli.mjs probe
 *   node tools/cli.mjs calibrate --step gubiji
 *   node tools/cli.mjs run [--dry]
 *   node tools/cli.mjs pet-test
 */
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_PATH, STATE_DIR, readConfig, writeConfig, readState } from '../lib/config.mjs'
import { makeAnchor, planRestore } from '../lib/anchor.mjs'
import { makePs } from '../lib/ps.mjs'
import { runSteps } from '../lib/runner.mjs'
import { createPetClient } from '../lib/pet.mjs'
import { colorMatches } from '../lib/matcher.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'status'
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const ps = makePs()
const cfg = readConfig()

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

async function main() {
  if (!ps.available) die('这个插件只支持 Windows（依赖 user32 / gdi32）。')

  if (cmd === 'status') {
    const st = readState()
    console.log(JSON.stringify({ configPath: CONFIG_PATH, enabled: cfg.enabled, schedule: cfg.schedule, steps: cfg.steps.map((s) => ({ id: s.id, name: s.name, calibrated: s.anchors.length > 0 })), state: st }, null, 2))
    return
  }

  if (cmd === 'probe') {
    const win = ps.window(cfg.game.title)
    if (!win.ok) die(`找不到窗口「${cfg.game.title}」。先打开游戏（窗口化），必要时改配置里的 game.title。`)
    console.log('窗口：', JSON.stringify(win.window))
    const out = path.resolve(flag('out', 'roco-probe.png'))
    const shot = ps.shot(cfg.game.title, out)
    console.log(shot.ok ? `截图：${shot.path}` : `截图失败：${shot.error}`)
    console.log('\n提示：看这张图，量出按钮在窗口内的坐标（左上角为 0,0），再用 calibrate 记下来。')
    return
  }

  if (cmd === 'calibrate') {
    const stepId = flag('step')
    if (!stepId) {
      console.log('用法：node tools/cli.mjs calibrate --step <id>\n\n可选步骤：')
      for (const s of cfg.steps) console.log(`  ${s.id.padEnd(12)} ${s.name}${s.anchors.length ? '  (已校准)' : ''}`)
      return
    }
    const step = cfg.steps.find((s) => s.id === stepId)
    if (!step) die(`配置里没有步骤 ${stepId}`)
    const win = ps.window(cfg.game.title)
    if (!win.ok) die(`找不到窗口「${cfg.game.title}」`)

    ps.activate(cfg.game.title)
    const rl = readline.createInterface({ input, output })
    console.log(`\n校准「${step.name}」`)
    console.log('把鼠标移到这个按钮/图标的正中间，停稳，然后按回车。')
    await rl.question('> ')
    const cur = ps.cursor()
    rl.close()
    if (!cur.ok) die('读不到鼠标位置')

    const rel = { x: cur.cursor.x - win.window.x, y: cur.cursor.y - win.window.y }
    if (rel.x < 0 || rel.y < 0 || rel.x >= win.window.w || rel.y >= win.window.h) {
      die(`鼠标不在游戏窗口内（相对坐标 ${rel.x},${rel.y}；窗口 ${win.window.w}×${win.window.h}）`)
    }

    const probe = ps.probe(cfg.game.title, `${rel.x},${rel.y}`)
    if (!probe.ok || !probe.colors?.length) die(`取色失败：${probe.error || 'no-color'}`)
    const rgb = probe.colors[0]

    step.anchors = [{ x: rel.x, y: rel.y, rgb }]
    step.click = { x: rel.x, y: rel.y }
    writeConfig(cfg)

    const check = ps.probe(cfg.game.title, `${rel.x},${rel.y}`)
    const okNow = check.ok && colorMatches(rgb, check.colors?.[0], 18)
    console.log(`\n已写入 ${CONFIG_PATH}`)
    console.log(`锚点 (${rel.x}, ${rel.y})  颜色 rgb(${rgb.join(', ')})`)
    console.log(okNow ? '✓ 回读校验通过' : '⚠ 回读不一致，可能画面在动，再校准一次')
    return
  }

  if (cmd === 'run') {
    const dry = has('dry')
    console.log(`跑一遍${dry ? '（演练，不点击）' : ''}…\n`)
    const report = await runSteps({
      steps: cfg.steps,
      game: cfg.game,
      ps,
      dry,
      onEvent: (e) => {
        if (e.type === 'start') console.log(`开始，共 ${e.total} 步`)
        else if (e.type === 'window') console.log(`窗口 ${e.title} ${e.w}×${e.h}`)
        else if (e.type === 'step') console.log(`  [${e.index}/${e.total}] ${e.name} → ${e.status}${e.reason ? ` (${e.reason})` : ''}`)
        else if (e.type === 'done') console.log(`\n结束：${e.status}${e.reason ? ` (${e.reason})` : ''}`)
      },
    })
    console.log(`\n${report.summary.ok} 成 / ${report.summary.skip} 跳 / ${report.summary.fail} 败 · ${report.durationMs}ms`)
    process.exit(report.status === 'success' || report.status === 'partial' ? 0 : 1)
  }

  if (cmd === 'pet-test') {
    const base = flag('base') || readState().petBase
    if (!base) die('不知道桌宠地址。先重启 DSH 让插件把 petBase 写进 state.json，或用 --base http://127.0.0.1:<端口>/dsh-pet-7340')
    const pet = createPetClient({ base, owner: cfg.pet.owner })
    const ping = await pet.ping()
    console.log('ping:', ping.ok ? '✓ 桌宠在线' : `✗ ${ping.error}`)
    const b = await pet.broadcast('桌宠联动测试：这句话是 dsh-roco-daily 发的。')
    console.log('broadcast:', b.ok ? '✓' : `✗ ${b.error}`)
    return
  }

  if (cmd === 'anchor') {
    const base = flag('base') || readState().petBase
    if (!base) die('不知道桌宠地址。先重启 DSH 让插件写入 petBase，或用 --base')
    const pet = createPetClient({ base, owner: cfg.pet.owner })
    const anchorPath = path.join(STATE_DIR, 'pet-anchor.json')
    const readAnchor = () => { try { return JSON.parse(fs.readFileSync(anchorPath, 'utf8')) } catch { return null } }

    const pose = await pet.pose('main')
    const scr = ps.screens()
    const rect = ps.petRect('electron')
    const cur = pose.ok ? makeAnchor({ pose: pose.data, screens: scr.ok ? scr.screens : [], rect: rect.ok ? rect.rect : null }) : null

    if (has('save')) {
      if (!cur) die('读不到桌宠位姿')
      fs.mkdirSync(STATE_DIR, { recursive: true })
      fs.writeFileSync(anchorPath, JSON.stringify(cur, null, 2), 'utf8')
      console.log('已保存锚点：', JSON.stringify(cur))
      return
    }

    if (has('restore')) {
      const saved = readAnchor()
      const plan = planRestore({ saved, screens: scr.ok ? scr.screens : [], pose: pose.ok ? pose.data : null, tolerance: cfg.petAnchor.tolerance })
      console.log('计划：', JSON.stringify({ apply: plan.apply, reason: plan.reason, x: plan.x, y: plan.y }))
      if (plan.apply) {
        const r = await pet.moveTo(plan.x, plan.y)
        console.log(r.ok ? '✓ 已归位' : `✗ ${r.error}`)
      }
      return
    }

    console.log(JSON.stringify({
      anchorPath,
      saved: readAnchor(),
      current: cur,
      pose: pose.ok ? pose.data : pose.error,
      petWindow: rect.ok ? rect.rect : rect.error,
      screens: scr.ok ? scr.screens : scr.error,
    }, null, 2))
    return
  }

  die(`未知命令 ${cmd}（可用：status / probe / calibrate / run / pet-test / anchor）`)
}

main().catch((e) => die(String(e?.stack || e)))
