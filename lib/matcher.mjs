/**
 * 色点匹配：和 win.ps1 里的 Test-OneAnchor 保持同一套语义。
 * 这里是为了能在没有 Windows 的环境下单测，也能在 calibrate 时自检。
 */

export function colorMatches(want, got, tol = 18) {
  if (!want) return true
  if (!got) return false
  if (got[0] < 0) return false
  return (
    Math.abs(want[0] - got[0]) <= tol &&
    Math.abs(want[1] - got[1]) <= tol &&
    Math.abs(want[2] - got[2]) <= tol
  )
}

export function anchorsMatch(anchors, colors, tol = 18) {
  if (!Array.isArray(anchors) || anchors.length === 0) return false
  if (!Array.isArray(colors) || colors.length < anchors.length) return false
  for (let i = 0; i < anchors.length; i++) {
    if (!colorMatches(anchors[i]?.rgb, colors[i], tol)) return false
  }
  return true
}

/** "x,y,r,g,b;x,y,r,g,b" —— 传给 win.ps1 -Points 的格式 */
export function anchorsToSpec(anchors) {
  return anchors
    .map((a) => `${a.x},${a.y},${a.rgb[0]},${a.rgb[1]},${a.rgb[2]}`)
    .join(';')
}

export function pointsToSpec(points) {
  return points.map((p) => `${p.x},${p.y}`).join(';')
}
