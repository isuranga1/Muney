import type { ReactNode } from 'react'

import { money } from '@/lib/format'
import { Card, cx } from '@/components/ui'

/* ------------------------------------------------------------- stat tiles */

export function StatTile({
  label,
  value,
  currency,
  hero = false,
  delta,
  note,
  tone = 'neutral',
}: {
  label: string
  value: number
  currency: string
  hero?: boolean
  delta?: ReactNode
  note?: ReactNode
  tone?: 'neutral' | 'good' | 'critical'
}) {
  const toneClass =
    tone === 'good' ? 'text-good-text' : tone === 'critical' ? 'text-critical' : 'text-ink'
  return (
    <Card className="px-5 py-5 hover:-translate-y-0.5">
      <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
      {/* Hero figures keep proportional figures; only aligned columns go tabular. */}
      <p
        className={cx(
          'mt-2.5 font-semibold tracking-[-0.03em]',
          hero ? 'text-[2rem] leading-none' : 'text-[1.375rem] leading-none',
          toneClass,
        )}
      >
        {money(value, currency)}
      </p>
      {delta && <p className="mt-2 text-xs">{delta}</p>}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </Card>
  )
}

/* -------------------------------------------------------------- bar lists */

export interface BarSegment {
  label: string
  value: number
  color: string
}

export interface BarRow {
  key: string
  label: string
  segments: BarSegment[]
  note?: string
}

/**
 * Horizontal bars on one shared scale. Every row is direct-labelled, so colour
 * never carries identity alone; a legend appears whenever a row has 2+ segments.
 */
export function BarList({
  rows,
  currency,
  legend,
  emptyLabel = 'Nothing to show yet.',
}: {
  rows: BarRow[]
  currency: string
  legend?: BarSegment[]
  emptyLabel?: string
}) {
  const totals = rows.map((row) => row.segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0))
  const max = Math.max(...totals, 0)

  if (!rows.length) {
    return <p className="py-8 text-sm text-muted">{emptyLabel}</p>
  }

  return (
    <div>
      {legend && legend.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {legend.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px]"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      )}

      <ul className="flex flex-col gap-3.5">
        {rows.map((row, index) => {
          const total = totals[index]
          const width = max > 0 ? (total / max) * 100 : 0
          return (
            <li key={row.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink-2">{row.label}</span>
                <span className="tabular shrink-0 font-medium text-ink">
                  {money(total, currency)}
                </span>
              </div>
              <div className="glass-inset h-2.5 w-full overflow-hidden rounded-full p-0">
                <div
                  className="spring flex h-full gap-[2px]"
                  style={{ width: `${width}%` }}
                >
                  {row.segments
                    .filter((segment) => segment.value > 0)
                    .map((segment, segmentIndex, visible) => (
                      <div
                        key={segment.label}
                        title={`${row.label} · ${segment.label}: ${money(segment.value, currency)}`}
                        className={cx(
                          'h-full min-w-[3px]',
                          segmentIndex === visible.length - 1 ? 'rounded-r-[4px]' : '',
                          segmentIndex === 0 ? 'rounded-l-[4px]' : '',
                        )}
                        style={{
                          backgroundColor: segment.color,
                          flexGrow: Math.max(segment.value, 0),
                        }}
                      />
                    ))}
                </div>
              </div>
              {row.note && <p className="mt-1.5 text-xs text-muted">{row.note}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------ panel shell */

export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="px-5 py-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}
