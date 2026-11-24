import { useState } from 'react'
import { Link } from 'react-router-dom'

import { EnvelopeBadge } from '@/components/badges'
import { MoveModal, OverspendAlerts, approx } from '@/components/budget'
import type { MoveMode } from '@/components/budget'
import { AlertTriangleIcon, PlusIcon, TransferIcon } from '@/components/icons'
import {
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  SectionHeader,
  Spinner,
  cx,
} from '@/components/ui'
import { monthLabel, money, percent, seriesColor, shortDate, signedMoney } from '@/lib/format'
import { useDeleteMove, useFunds, useMoves } from '@/lib/queries'
import type { FundMove, FundStatus, FundsOverview } from '@/types'

type Moving = { fund: FundStatus; mode: MoveMode }

export default function Funds() {
  const funds = useFunds()
  const [moving, setMoving] = useState<Moving | null>(null)

  if (funds.isLoading) return <Spinner />
  const data = funds.data

  return (
    <div className="animate-rise flex flex-col gap-5">
      <SectionHeader
        title="Funds"
        subtitle={
          data
            ? `What each bucket holds now, counted from ${monthLabel(data.since_year, data.since_month)}.`
            : undefined
        }
      />
      <ErrorNote error={funds.error} />

      {data && !data.funds.length && (
        <EmptyState
          title="No buckets yet"
          hint="Set up your percentage rule on the Budget page first."
        />
      )}

      {data && data.funds.length > 0 && (
        <>
          <OverspendAlerts data={data} />

          <Card className="px-5 py-4">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              All buckets
            </p>
            <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
              {signedMoney(data.total, data.base_currency)}
            </p>
            {approx(data.total, data.secondary_currency, data.secondary_rate) && (
              <p className="tabular text-sm text-ink-2">
                {approx(data.total, data.secondary_currency, data.secondary_rate)}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              Income shared out so far, minus what was spent from each bucket. The money itself
              stays in whichever account it's in.
            </p>
          </Card>

          <section className="stagger grid gap-3 md:grid-cols-2">
            {data.funds.map((fund, i) => (
              <FundCard
                key={fund.bucket_id}
                fund={fund}
                data={data}
                color={fund.color || seriesColor(i)}
                onMove={(mode) => setMoving({ fund, mode })}
              />
            ))}
          </section>

          {data.unassigned_spend > 0 && (
            <Card className="flex items-start gap-2.5 border-warning/45 bg-warning/10 px-4 py-3 text-sm">
              <AlertTriangleIcon size={16} className="mt-px shrink-0 text-warning" />
              <span>
                {money(data.unassigned_spend, data.base_currency)} of spending so far isn't in any
                bucket, so no balance above includes it.{' '}
                <Link to="/budget" className="underline underline-offset-2">
                  Map its categories
                </Link>{' '}
                to a bucket.
              </span>
            </Card>
          )}
        </>
      )}

      {moving && data && (
        <MoveModal
          fund={moving.fund}
          mode={moving.mode}
          data={data}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- a fund */

function FundCard({
  fund,
  data,
  color,
  onMove,
}: {
  fund: FundStatus
  data: FundsOverview
  color: string
  onMove: (mode: MoveMode) => void
}) {
  const [history, setHistory] = useState(false)
  const base = data.base_currency
  const saving = fund.goal_type === 'save'
  const over = fund.balance < 0
  const rows: [string, number][] = [
    ['Shared out to it', fund.total_share],
    ['Moved in', fund.moved_in],
    ['Spent', -fund.total_spent],
    ['Moved out', -fund.moved_out],
  ]

  return (
    <Card className={cx('flex flex-col px-5 py-4', over && 'border-critical/45')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div>
            <p className="font-semibold">{fund.name}</p>
            <p className="text-xs text-muted">
              {percent(fund.percent)} of income · {saving ? 'fund' : 'monthly spending'}
            </p>
          </div>
        </div>
        <EnvelopeBadge over={over} />
      </div>

      <p
        className={cx('tabular mt-3 text-2xl font-semibold tracking-tight', over && 'text-critical')}
      >
        {signedMoney(fund.balance, base)}
      </p>
      {approx(fund.balance, data.secondary_currency, data.secondary_rate) && (
        <p className="tabular text-xs text-muted">
          {approx(fund.balance, data.secondary_currency, data.secondary_rate)}
        </p>
      )}

      <dl className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-xs">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular">{signedMoney(v, base)}</dd>
            </div>
          ))}
        <div className="mt-1 flex justify-between gap-3">
          <dt className="text-muted">This month</dt>
          <dd className="tabular text-ink-2">
            {money(fund.this_month_spent, base)} spent of {money(fund.this_month_share, base)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onMove('move')} disabled={data.funds.length < 2}>
          <TransferIcon size={14} />
          Move
        </Button>
        <Button size="sm" onClick={() => onMove('add')}>
          <PlusIcon size={14} />
          Add
        </Button>
        <Button size="sm" onClick={() => onMove('out')}>
          Take out
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>
          {history ? 'Hide moves' : 'Moves'}
        </Button>
      </div>

      {history && <MoveHistory fund={fund} data={data} />}
    </Card>
  )
}

function describe(move: FundMove, bucketId: number, names: Map<number, string>): string {
  const other = move.from_bucket_id === bucketId ? move.to_bucket_id : move.from_bucket_id
  if (move.from_bucket_id === bucketId) {
    return other ? `To ${names.get(other) ?? 'a removed bucket'}` : 'Taken out'
  }
  return other ? `From ${names.get(other) ?? 'a removed bucket'}` : 'Added'
}

function MoveHistory({ fund, data }: { fund: FundStatus; data: FundsOverview }) {
  const moves = useMoves(fund.bucket_id)
  const remove = useDeleteMove()
  const base = data.base_currency
  const names = new Map(data.funds.map((f) => [f.bucket_id, f.name]))

  if (moves.isLoading) return <Spinner />
  return (
    <div className="mt-3">
      <ErrorNote error={moves.error ?? remove.error} />
      {!moves.data?.length ? (
        <p className="text-xs text-muted">
          No money moved in or out yet. Its share of income and spending in its categories are
          counted automatically.
        </p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {moves.data.map((m) => {
            const into = m.to_bucket_id === fund.bucket_id
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{describe(m, fund.bucket_id, names)}</p>
                  <p className="truncate text-xs text-muted">
                    {shortDate(m.moved_on)}
                    {m.note && ` · ${m.note}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <p className={cx('tabular font-medium', !into && 'text-ink-2')}>
                    {signedMoney(into ? m.amount : -m.amount, base)}
                  </p>
                  <ConfirmButton
                    label="Undo"
                    message="Undo this move? Both balances go back."
                    onConfirm={() => remove.mutate(m.id)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
