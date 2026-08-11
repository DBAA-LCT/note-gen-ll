export function formatLocalDate(timestamp = Date.now(), timeZone?: string): string {
  const value = new Date(timestamp)
  const safeValue = Number.isNaN(value.getTime()) ? new Date() : value
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
  try {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).format(safeValue)
  } catch {
    return new Intl.DateTimeFormat('en-CA', options).format(safeValue)
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

export function addLocalDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

export function diffLocalDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T12:00:00Z`)
  const end = Date.parse(`${endDate}T12:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function localWeekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

export function formatChineseDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '正在读取日期…'
  const value = new Date(`${date}T12:00:00`)
  if (Number.isNaN(value.getTime())) return '正在读取日期…'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(value)
}

export function nextStudyDate(date: string, weeklyDays: number[]): string {
  const allowed = new Set(weeklyDays.length ? weeklyDays : [0, 1, 2, 3, 4, 5, 6])
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addLocalDays(date, offset)
    if (allowed.has(localWeekday(candidate))) return candidate
  }
  return addLocalDays(date, 1)
}
