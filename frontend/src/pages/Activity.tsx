import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Panel } from '@/components/charts'
import {
  MonthBars,
  MonthNav,
  TransactionModal,
  TransactionRow,
  useMonthState,
} from '@/components/finance'
import { Button, Card, EmptyState, ErrorNote, Input, Select, Spinner, cx } from '@/components/ui'
import { MONTHS, dayLabel, money, signedMoney } from '@/lib/format'
import {
  useAccounts,
  useCategories,
  useConfig,
  useMonthReport,
  useTransactions,
  useYearReport,
} from '@/lib/queries'
import { AddButton } from '@/pages/Home'
import type { CategoryYearRow, Transaction, TransactionKind } from '@/types'

type View = 'month' | 'year'

export default function Activity() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'year' ? 'year' : 'month'
  const { year, month, set } = useMonthState()

  function setView(next: View) {
    const copy = new URLSearchParams(params)
    copy.set('view', next)
    setParams(copy, { replace: true })
  }

  return (
    <div className="animate-rise flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <div className="glass-inset flex gap-1 rounded-full p-1">
          {(['month', 'year'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cx(
                'spring rounded-full px-4 py-1.5 text-sm font-medium',
                view === v ? 'bg-series-1 text-white' : 'text-ink-2',
              )}
            >
              {v === 'month' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        <MonthView year={year} month={month} onChange={set} />
      ) : (
        <YearView
          year={year}
          onChange={(y) => set(y, month)}
          onOpenMonth={(m) => {
            set(year, m)
            setView('month')
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- month view */

function MonthView({
  year,
  month,
  onChange,
}: {
  year: number
  month: number
  onChange: (year: number, month: number) => void
}) {
  const [params] = useSearchParams()
  const [kind, setKind] = useState<TransactionKind | ''>('')
  const [categoryFilter, setCategoryFilter] = useState(params.get('category') ?? '')
  const [accountId, setAccountId] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [adding, setAdding] = useState(false)

  const config = useConfig()
  const accounts = useAccounts()
  const categories = useCategories()
  const report = useMonthReport(year, month)
  const txns = useTransactions({
    year,
    month,
    kind: kind || undefined,
    uncategorized: categoryFilter === 'none',
    category_id: categoryFilter && categoryFilter !== 'none' ? Number(categoryFilter) : undefined,
    account_id: accountId ? Number(accountId) : undefined,
    q: search || undefined,
  })

  const base = config.data?.base_currency ?? 'LKR'
  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]))
  const accountById = new Map((accounts.data?.accounts ?? []).map((a) => [a.id, a]))

  const days = useMemo(() => {
    const groups = new Map<string, Transaction[]>()
    for (const t of txns.data ?? []) {
      const list = groups.get(t.occurred_on) ?? []
      list.push(t)
      groups.set(t.occurred_on, list)
    }
    return [...groups.entries()]
  }, [txns.data])

  const r = report.data

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav year={year} month={month} onChange={onChange} />
        {r && (
          <div className="flex gap-4 text-sm">
            <span>
              <span className="text-muted">In </span>
              <span className="tabular font-semibold text-good-text">{money(r.income, base)}</span>
            </span>
            <span>
              <span className="text-muted">Out </span>
              <span className="tabular font-semibold">{money(r.expense, base)}</span>
            </span>
            <span>
              <span className="text-muted">Net </span>
              <span className={cx('tabular font-semibold', r.net < 0 && 'text-critical')}>
                {signedMoney(r.net, base)}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          placeholder="Search merchant or note"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 sm:col-span-1"
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value as TransactionKind | '')}>
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </Select>
        <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          <option value="none">Uncategorised</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ''}
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </Select>
      </div>

      <ErrorNote error={txns.error ?? report.error} />

      {txns.isLoading ? (
        <Spinner />
      ) : days.length === 0 ? (
        <EmptyState
          title="Nothing here"
          hint="Transactions forwarded from your phone and ones you add by hand show up here."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add a transaction
            </Button>
          }
        />
      ) : (
        <div className="stagger flex flex-col gap-3">
          {days.map(([day, list]) => {
            const out = list
              .filter((t) => t.kind === 'expense')
              .reduce((s, t) => s + (t.base_amount ?? 0), 0)
            return (
              <Card key={day} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
                  <span className="font-semibold text-ink-2">{dayLabel(day)}</span>
                  {out > 0 && <span className="tabular text-muted">−{money(out, base)}</span>}
                </div>
                <ul className="divide-y divide-hairline">
                  {list.map((t) => (
                    <TransactionRow
                      key={t.id}
                      txn={t}
                      category={t.category_id ? categoryById.get(t.category_id) : null}
                      accountName={t.account_id ? accountById.get(t.account_id)?.name : undefined}
                      toAccountName={
                        t.to_account_id ? accountById.get(t.to_account_id)?.name : undefined
                      }
                      baseCurrency={base}
                      onClick={() => setEditing(t)}
                    />
                  ))}
                </ul>
              </Card>
            )
          })}
        </div>
      )}

      <AddButton onClick={() => setAdding(true)} />
      <TransactionModal
        open={adding || editing !== null}
        transaction={editing}
        defaults={{
          occurred_on:
            year === new Date().getFullYear() && month === new Date().getMonth() + 1
              ? undefined
              : `${year}-${String(month).padStart(2, '0')}-01`,
        }}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
      />
    </>
  )
}

/* -------------------------------------------------------------- year view */

function YearView({
  year,
  onChange,
  onOpenMonth,
}: {
  year: number
  onChange: (year: number) => void
  onOpenMonth: (month: number) => void
}) {
  const report = useYearReport(year)
  const [tab, setTab] = useState<'expense' | 'income'>('expense')

  if (report.isLoading) return <Spinner />
  if (!report.data) return <ErrorNote error={report.error} />
  const r = report.data
  const base = r.base_currency
  const rows = tab === 'expense' ? r.expense_categories : r.income_categories
  const activeMonths = r.months.filter((m) => m.income || m.expense).length || 1

  return (
    <>
      <MonthNav year={year} month={1} yearOnly onChange={(y) => onChange(y)} />

      <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Income', money(r.income, base), 'text-good-text'],
          ['Spending', money(r.expense, base), 'text-ink'],
          ['Net', signedMoney(r.net, base), r.net >= 0 ? 'text-good-text' : 'text-critical'],
          ['Avg spend / month', money(r.expense / activeMonths, base), 'text-ink'],
        ].map(([label, value, tone]) => (
          <Card key={label} className="px-4 py-4">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              {label}
            </p>
            <p className={cx('tabular mt-2 text-lg font-semibold', tone)}>{value}</p>
          </Card>
        ))}
      </section>

      <Panel title="Month by month" subtitle={`In ${base} · tap a month to open it`}>
        <MonthBars months={r.months} currency={base} onSelect={onOpenMonth} />
      </Panel>

      <Panel
        title="Categories across the year"
        action={
          <Select
            value={tab}
            onChange={(e) => setTab(e.target.value as 'expense' | 'income')}
            className="w-auto py-1.5 text-xs"
          >
            <option value="expense">Spending</option>
            <option value="income">Income</option>
          </Select>
        }
      >
        <CategoryMatrix rows={rows} currency={base} onOpenMonth={onOpenMonth} />
      </Panel>
    </>
  )
}

function CategoryMatrix({
  rows,
  currency,
  onOpenMonth,
}: {
  rows: CategoryYearRow[]
  currency: string
  onOpenMonth: (month: number) => void
}) {
  if (!rows.length) return <p className="py-6 text-sm text-muted">Nothing recorded.</p>
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[56rem] text-xs">
        <thead>
          <tr className="text-muted">
            <th className="sticky left-0 bg-transparent py-2 pr-3 text-left font-medium">
              Category
            </th>
            {MONTHS.map((m, i) => (
              <th key={m} className="px-1.5 py-2 text-right font-medium">
                <button type="button" onClick={() => onOpenMonth(i + 1)} className="hover:text-ink">
                  {m}
                </button>
              </th>
            ))}
            <th className="py-2 pl-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => (
            <tr key={row.category_id ?? 'none'}>
              <td className="py-2 pr-3 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: row.color || 'var(--series-8)' }}
                  />
                  {row.icon} {row.name}
                </span>
              </td>
              {row.months.map((v, i) => (
                <td key={i} className={cx('tabular px-1.5 py-2 text-right', !v && 'text-muted')}>
                  {v ? money(v, currency, { compact: true }) : '·'}
                </td>
              ))}
              <td className="tabular py-2 pl-3 text-right font-semibold">
                {money(row.total, currency, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
