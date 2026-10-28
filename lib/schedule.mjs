/**
 * 排班：纯函数，方便单测。
 * days 用 ISO 星期（1=周一 … 7=周日）。
 */

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, min }
}

export function isoDay(date) {
  const d = date.getDay()
  return d === 0 ? 7 : d
}

/** 下一次触发时刻（严格晚于 now）；当天已过则顺延到下一个匹配的星期。 */
export function nextRunAt(now, schedule) {
  const t = parseHHMM(schedule?.time)
  if (!t) return null
  const days = Array.isArray(schedule?.days) && schedule.days.length ? schedule.days : [1, 2, 3, 4, 5, 6, 7]
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now.getTime())
    d.setDate(d.getDate() + offset)
    d.setHours(t.h, t.min, 0, 0)
    if (d.getTime() <= now.getTime()) continue
    if (!days.includes(isoDay(d))) continue
    return d
  }
  return null
}

/** 今天这个时间点是不是已经过了（用于开机补跑判断）。 */
export function todaySlotPassed(now, schedule) {
  const t = parseHHMM(schedule?.time)
  if (!t) return false
  const days = Array.isArray(schedule?.days) && schedule.days.length ? schedule.days : [1, 2, 3, 4, 5, 6, 7]
  if (!days.includes(isoDay(now))) return false
  const slot = new Date(now.getTime())
  slot.setHours(t.h, t.min, 0, 0)
  return now.getTime() >= slot.getTime()
}

/** 本地日期串，用作「今天跑过没有」的键。 */
export function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
