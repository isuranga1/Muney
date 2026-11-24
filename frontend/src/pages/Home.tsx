import { useState } from 'react'
import { Link } from 'react-router-dom'

import { BarList, Panel } from '@/components/charts'
import { EnvelopeBadge, StaleRatesBadge } from '@/components/badges'
import {
  DualAmount,
  MonthNav,
  ProgressBar,
  TransactionModal,
  TransactionRow,
  useMonthState,
} from '@/components/finance'
import { PlusIcon } from '@/components/icons'
import { Button, Card, ErrorNote, Spinner, cx } from '@/components/ui'
import { money, percent, seriesColor, signedMoney } from '@/lib/format'
import {
  useAccounts,
  useBudgetMonth,
  useCategories,
  useFx,
  useMonthReport,
  useTransactions,
} from '@/lib/queries'
import type { BarRow } from '@/components/charts'
import type { Transaction } from '@/types'

function change(current: number, previous: number): string | null {
  if (!previous) return null
  const delta = ((current - previous) / previous) * 100
  return `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)}% vs last month`
}

export default function Home() {
  const { year, month, set } = useMonthState()
  const accounts = useAccounts()
  const report = useMonthReport(year, month)
  const budget = useBudgetMonth(year, month)
  const recent = useTransactions({ year, month, limit: 8 })
  const categories = useCategories()
  const fx = useFx()

  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)

  if (accounts.isLoading || report.isLoading) return <Spinner label="Loading your money…" />
  const error = accounts.error ?? report.error ?? budget.error ?? recent.error
  if (!accounts.data || !report.data) return <ErrorNote error={error} />

  const overview = accounts.data
  const r = report.data
  const base = overview.base_currency
  const second = overview.secondary_currency
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]))
  const accountById = new Map(overview.accounts.map((a) => [a.id, a]))

  const categoryRows: BarRow[] = r.expense_by_category.slice(0, 7).map((c, i) => ({
    key: String(c.category_id ?? 'none'),
    label: `${c.icon ? `${c.icon} ` : ''}${c.name}`,
    note: `${percent(c.share)} of spending · ${c.count} transaction${c.count === 1 ? '' : 's'}`,
    segments: [{ label: c.name, value: c.total, color: c.color || seriesColor(i) }],
  }))

  return (
    <div className="animate-rise flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <div className="flex items-center gap-2">
          {fx.data?.is_stale && <StaleRatesBadge />}
          <MonthNav year={year} month={month} onChange={set} />
        </div>
      </div>

      <ErrorNote error={error} />

      {/* ------------------------------------------------------ net worth */}
      <Card className="px-5 py-5">
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
          Total balance
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-[2rem] leading-none font-semibold tracking-[-0.03em]">
            {signedMoney(overview.net_worth, base)}
          </p>
          {second && overview.net_worth_secondary !== null && (
            <p className="tabular text-lg text-ink-2">
              ≈ {signedMoney(overview.net_worth_secondary, second)}
            </p>
          )}
        </div>
        {overview.unconvertible.length > 0 && (
          <p className="mt-2 text-xs text-warning">
            No rate for {overview.unconvertible.join(', ')} — left out of the total.
          </p>
        )}

        {overview.accounts.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            <Link to="/accounts" className="underline underline-offset-2">
              Add your first account
            </Link>{' '}
            to start tracking.
          </p>
        ) : (
          <div className="scroll-x -mx-1 mt-4">
            <div className="flex gap-2.5 px-1 pb-1">
              {overview.accounts.map((a) => (
                <Link
                  key={a.id}
                  to="/accounts"
                  className="glass-inset spring min-w-[11rem] shrink-0 rounded-xl px-3 py-2.5 hover:-translate-y-0.5"
                  style={{ borderLeft: `3px solid ${a.color || 'var(--series-1)'}` }}
                >
                  <p className="truncate text-xs text-muted">
                    {a.institution ? `${a.institution} · ` : ''}
                    {a.name}
                  </p>
                  <div className="mt-1 [&>div]:text-left">
                    <DualAmount
                      amount={a.balance}
                      currency={a.currency}
                      base={a.base_balance}
                      baseCurrency={base}
                      secondary={a.secondary_balance}
                      secondaryCurrency={second}
                      negative={a.is_liability}
                    />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* --------------------------------------------------- month totals */}
      <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: 'Income',
            value: money(r.income, base),
            tone: 'text-good-text',
            note: change(r.income, r.previous_income),
          },
          {
            label: 'Spending',
            value: money(r.expense, base),
            tone: 'text-ink',
            note: change(r.expense, r.previous_expense),
          },
          {
            label: 'Net',
            value: signedMoney(r.net, base),
            tone: r.net >= 0 ? 'text-good-text' : 'text-critical',
            note:
              second && r.secondary_rate
                ? `≈ ${signedMoney(r.net / r.secondary_rate, second)}`
                : null,
          },
          {
            label: 'Saved',
            value: percent(r.savings_rate),
            tone: (r.savings_rate ?? 0) >= 0 ? 'text-ink' : 'text-critical',
            note: `${r.transaction_count} transactions`,
          },
        ].map((tile) => (
          <Card key={tile.label} className="px-4 py-4">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              {tile.label}
            </p>
            <p className={cx('tabular mt-2 text-lg leading-tight font-semibold', tile.tone)}>
              {tile.value}
            </p>
            {tile.note && <p className="mt-1 text-xs text-muted">{tile.note}</p>}
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------------------------------- budget rule */}
        <Panel
          title="Monthly rule"
          subtitle={
            budget.data
              ? `${budget.data.over_count ? `${budget.data.over_count} overspent` : 'All in budget'} · ${money(budget.data.income_basis, base)} income shared out`
              : undefined
          }
          action={
            <Link to="/budget" className="text-xs text-series-1 underline-offset-2 hover:underline">
              Details
            </Link>
          }
        >
          {budget.data?.buckets.length ? (
            <ul className="flex flex-col gap-4">
              {budget.data.buckets.map((b, i) => (
                <li key={b.bucket_id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      <span className="text-xs text-muted">{percent(b.percent)}</span>
                    </span>
                    <EnvelopeBadge over={b.over} />
                  </div>
                  <ProgressBar
                    value={(() => {
                      const pool = Math.max(b.opening, 0) + b.share + b.moved_in
                      const used = b.spent + b.moved_out + Math.max(-b.opening, 0)
                      return pool > 0 ? (used / pool) * 100 : used > 0 ? 100 : 0
                    })()}
                    color={b.color || seriesColor(i)}
                    over={b.over}
                  />
                  <p className="tabular mt-1 text-xs text-muted">
                    {money(b.spent, base)} spent ·{' '}
                    <span className={cx(b.over && 'font-medium text-critical')}>
                      {signedMoney(b.available, base)} {b.over ? 'over' : 'left'}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted">No rule set up yet.</p>
          )}
        </Panel>

        {/* ----------------------------------------------- spending by cat */}
        <Panel title="Where it went" subtitle="Spending by category this month">
          <BarList rows={categoryRows} currency={base} emptyLabel="No spending this month yet." />
        </Panel>
      </section>

      {/* ----------------------------------------------------------- recent */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold">Recent</h2>
          <Link to="/activity" className="text-xs text-series-1 underline-offset-2 hover:underline">
            All transactions
          </Link>
        </div>
        {recent.data?.length ? (
          <ul className="divide-y divide-hairline pb-1">
            {recent.data.map((t) => (
              <TransactionRow
                key={t.id}
                txn={t}
                category={t.category_id ? categoryById.get(t.category_id) : null}
                accountName={t.account_id ? accountById.get(t.account_id)?.name : undefined}
                toAccountName={t.to_account_id ? accountById.get(t.to_account_id)?.name : undefined}
                baseCurrency={base}
                onClick={() => setEditing(t)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-5 text-sm text-muted">Nothing recorded this month.</p>
        )}
      </Card>

      <AddButton onClick={() => setAdding(true)} />

      <TransactionModal
        open={adding || editing !== null}
        transaction={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
      />
    </div>
  )
}

/** Floating "+" — sits above the phone tab bar, bottom-right on desktop. */
export function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="primary"
      onClick={onClick}
      aria-label="Add transaction"
      className="fixed right-5 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full! p-0! shadow-[0_8px_24px_rgb(42_120_214/0.45)] lg:right-10 lg:bottom-10"
    >
      <PlusIcon size={24} strokeWidth={2.25} />
    </Button>
  )
}
