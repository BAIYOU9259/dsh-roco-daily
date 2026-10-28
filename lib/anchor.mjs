/**
 * 桌宠"锚点"：记住它上次在哪（归一化坐标 + 当时在哪块屏），
 * 下次 DSH 启动时放回去；屏幕变了就用同一组比例落到现有屏幕上。
 *
 * 为什么是归一化坐标：dsh-pet 的 /pose 与 /position 都是 0~1 的屏内相对值，
 * 天然满足"换屏按比例"——同一组 nx/ny 落到不同尺寸的屏上就是等比位置。
 */

export function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

/** 矩形中心落在哪块屏；都不在就给最近的一块。 */
export function screenOfRect(screens, rect) {
  if (!Array.isArray(screens) || !screens.length || !rect) return null
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const inside = screens.find((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h)
  if (inside) return inside
  let best = screens[0]
  let bestD = Infinity
  for (const s of screens) {
    const dx = cx - (s.x + s.w / 2)
    const dy = cy - (s.y + s.h / 2)
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}

/**
 * 从存档里挑这次要用的屏幕：
 * 同 deviceName → 同尺寸/位置 → 主屏 → 面积最大。
 */
export function pickScreen(screens, saved) {
  if (!Array.isArray(screens) || !screens.length) return null
  const want = saved?.screen
  if (want) {
    const byName = screens.find((s) => want.deviceName && s.deviceName === want.deviceName)
    if (byName) return byName
    const byGeom = screens.find(
      (s) => s.x === want.x && s.y === want.y && s.w === want.w && s.h === want.h,
    )
    if (byGeom) return byGeom
  }
  const primary = screens.find((s) => s.primary)
  if (primary) return primary
  return screens.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0]
}

/** 归一化 → 该屏上的绝对像素（中心点），仅用于展示/排查。 */
export function toAbsolute(screen, nx, ny) {
  if (!screen) return null
  return {
    x: Math.round(screen.x + clamp01(nx) * screen.w),
    y: Math.round(screen.y + clamp01(ny) * screen.h),
  }
}

/**
 * 由当前真实状态生成存档。
 * rect 为空（拿不到窗口矩形）时只存归一化坐标，screen 记为 null。
 */
export function makeAnchor({ pose, screens, rect, now = Date.now() }) {
  if (!pose || !Number.isFinite(Number(pose.x))) return null
  const screen = rect ? screenOfRect(screens, rect) : null
  return {
    nx: Number(clamp01(pose.x).toFixed(6)),
    ny: Number(clamp01(pose.y).toFixed(6)),
    screen: screen
      ? { deviceName: screen.deviceName, x: screen.x, y: screen.y, w: screen.w, h: screen.h }
      : null,
    at: new Date(now).toISOString(),
  }
}

/**
 * 决定这次启动要不要挪回去。
 *   no-anchor      没有存档
 *   no-screen-info 拿不到屏幕信息，但仍有坐标 → 照比例放（就是当前屏的等比位置）
 *   already-there  同屏且偏差在容差内 → 不动
 *   restore-same-screen / restore-proportional → 挪
 */
export function planRestore({ saved, screens, pose, tolerance = 0.01 }) {
  if (!saved || !Number.isFinite(saved.nx) || !Number.isFinite(saved.ny)) {
    return { apply: false, reason: 'no-anchor' }
  }
  const list = Array.isArray(screens) ? screens : []
  const screen = pickScreen(list, saved)

  if (!screen) {
    const same = pose && Number.isFinite(pose.x)
      && Math.abs(pose.x - saved.nx) <= tolerance
      && Math.abs(pose.y - saved.ny) <= tolerance
    if (same) return { apply: false, reason: 'already-there', x: saved.nx, y: saved.ny, screen: null }
    return { apply: true, x: saved.nx, y: saved.ny, screen: null, reason: 'no-screen-info' }
  }

  const sameScreen = !!saved.screen?.deviceName && saved.screen.deviceName === screen.deviceName
  if (sameScreen && pose && Number.isFinite(pose.x)) {
    if (Math.abs(pose.x - saved.nx) <= tolerance && Math.abs(pose.y - saved.ny) <= tolerance) {
      return { apply: false, reason: 'already-there', x: saved.nx, y: saved.ny, screen }
    }
  }
  return {
    apply: true,
    x: saved.nx,
    y: saved.ny,
    screen,
    reason: sameScreen ? 'restore-same-screen' : 'restore-proportional',
  }
}
