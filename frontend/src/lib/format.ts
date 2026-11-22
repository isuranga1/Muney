const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`
  let existing = formatters.get(key)
  if (!existing) {
    existing = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
      minimumFractionDigits: compact ? 0 : 2,
    })
    formatters.set(key, existing)
  }
  return existing
}

export function money(
  value: number | null | undefined,
  currency: string,
  options: { compact?: boolean } = {},
): string {
  if (value === null || value === undefined) return '—'
  try {
    return formatter(currency, options.compact ?? false).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

export function signedMoney(value: number, currency: string, compact = false): string {
  const text = money(Math.abs(value), currency, { compact })
  return value < 0 ? `−${text}` : text
}

export function rate(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
  }).format(value)
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Categorical slots in validated order — index into it, never cycle past 8. */
export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

export function seriesColor(index: number): string {
  return SERIES[Math.min(index, SERIES.length - 1)]
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function monthLabel(year: number, month: number, long = true): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: long ? 'long' : 'short',
    year: 'numeric',
  })
}

export function dayLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`)
  const now = new Date()
  const diff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - parsed.getTime()) /
      86_400_000,
  )
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Local YYYY-MM-DD — toISOString() would give the UTC date. */
export function localDate(value: Date | string = new Date()): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
