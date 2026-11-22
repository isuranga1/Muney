import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Panel } from '@/components/charts'
import { GoalBadge } from '@/components/badges'
import { MonthNav, ProgressBar, useMonthState } from '@/components/finance'
import { AlertTriangleIcon, CheckIcon, PlusIcon } from '@/components/icons'
import {
  Button,
  Card,
  ConfirmButton,
  ErrorNote,
  Input,
  SectionHeader,
  Select,
  Spinner,
  cx,
} from '@/components/ui'
import { MONTHS, money, percent, seriesColor } from '@/lib/format'
import {
  useBudgetHistory,
  useBudgetMonth,
  useBuckets,
  useCategories,
  useDeleteBucket,
  useSaveBucket,
  useSaveCategory,
  useSetIncomeBasis,
} from '@/lib/queries'
import type { Bucket } from '@/types'

export default function Budget() {
  const { year, month, set } = useMonthState()
  const status = useBudgetMonth(year, month)

  return (
    <div className="animate-rise flex flex-col gap-5">
      <SectionHeader
        title="Budget rule"
        subtitle="Split every month's income by percentage, then see whether you stuck to it."
      />
      <MonthNav year={year} month={month} onChange={set} />
      <ErrorNote error={status.error} />
      {status.isLoading ? <Spinner /> : status.data && <MonthStatus year={year} month={month} />}
      <RuleEditor />
      <CategoryMapping />
      <History />
    </div>
  )
}

/* ---------------------------------------------------------- this month */

function MonthStatus({ year, month }: { year: number; month: number }) {
  const status = useBudgetMonth(year, month)
  const setBasis = useSetIncomeBasis()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const s = status.data!
  const base = s.base_currency

  return (
    <>
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Income this rule applies to
            </p>
            <p className="tabular mt-1.5 text-2xl font-semibold">{money(s.income_basis, base)}</p>
            <p className="text-xs text-muted">
              {s.basis_is_override
                ? `Set by hand · actual income so far ${money(s.income_actual, base)}`
                : 'Actual income recorded this month'}
            </p>
          </div>
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setBasis.mutate(
                  { year, month, income_basis: Number(value) },
                  { onSuccess: () => setEditing(false) },
                )
              }}
            >
              <Input
                type="number"
                inputMode="decimal"
                autoFocus
                required
                className="w-40"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary">
                Save
              </Button>
            </form>
          ) : (
            <div className="flex gap-2">
              {s.basis_is_override && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBasis.mutate({ year, month, income_basis: null })}
                >
                  Use actual
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  setValue(String(s.income_basis || ''))
                  setEditing(true)
                }}
              >
                Plan with expected income
              </Button>
            </div>
          )}
        </div>
      </Card>

      <section className="stagger grid gap-3 sm:grid-cols-2">
        {s.buckets.map((b, i) => {
          const over = b.goal_type === 'spend' && b.on_track === false
          const remaining = b.target - b.actual
          return (
            <Card key={b.bucket_id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{b.name}</p>
                  <p className="text-xs text-muted">
                    {b.goal_type === 'save' ? 'Save at least' : 'Spend at most'}{' '}
                    {percent(b.percent)}
                  </p>
                </div>
                <GoalBadge onTrack={b.on_track} goalType={b.goal_type} />
              </div>
              <p className="tabular mt-3 text-xl font-semibold">
                {money(b.actual, base)}
                <span className="text-sm font-normal text-muted"> / {money(b.target, base)}</span>
              </p>
              <div className="mt-2">
                <ProgressBar value={b.progress} color={b.color || seriesColor(i)} over={over} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Actually {percent(b.actual_percent, 1)} of income ·{' '}
                {b.goal_type === 'save'
                  ? remaining > 0
                    ? `${money(remaining, base)} more to go`
                    : 'target met'
                  : remaining >= 0
                    ? `${money(remaining, base)} left`
                    : `${money(-remaining, base)} over`}
              </p>
            </Card>
          )
        })}
      </section>

      {s.unassigned_spend > 0 && (
        <Card className="flex items-start gap-2.5 border-warning/45 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangleIcon size={16} className="mt-px shrink-0 text-warning" />
          <span>
            {money(s.unassigned_spend, base)} of spending this month isn't in any bucket —
            uncategorised, or in a category with no bucket.{' '}
            <Link to="/activity?category=none" className="underline underline-offset-2">
              Review uncategorised
            </Link>{' '}
            or map categories below.
          </span>
        </Card>
      )}
    </>
  )
}

/* --------------------------------------------------------- rule editor */

type BucketDraft = { id?: number; name: string; percent: string; goal_type: string; color: string }

function RuleEditor() {
  const buckets = useBuckets()
  const save = useSaveBucket()
  const remove = useDeleteBucket()
  const [drafts, setDrafts] = useState<BucketDraft[]>([])

  useEffect(() => {
    if (buckets.data) {
      setDrafts(
        buckets.data.map((b: Bucket) => ({
          id: b.id,
          name: b.name,
          percent: String(b.percent),
          goal_type: b.goal_type,
          color: b.color ?? '#2a78d6',
        })),
      )
    }
  }, [buckets.data])

  const total = drafts.reduce((sum, d) => sum + (Number(d.percent) || 0), 0)
  const dirty =
    JSON.stringify(drafts) !==
    JSON.stringify(
      (buckets.data ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        percent: String(b.percent),
        goal_type: b.goal_type,
        color: b.color ?? '#2a78d6',
      })),
    )

  function update(index: number, patch: Partial<BucketDraft>) {
    setDrafts(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  async function saveAll() {
    for (const [i, d] of drafts.entries()) {
      await save.mutateAsync({
        id: d.id,
        name: d.name.trim(),
        percent: Number(d.percent) || 0,
        goal_type: d.goal_type,
        color: d.color,
        sort_order: i,
      })
    }
  }

  return (
    <Panel
      title="Your rule"
      subtitle="Saving buckets are met by reaching the target; spending buckets by staying under it."
      action={
        <span
          className={cx(
            'inline-flex items-center gap-1 text-xs font-semibold',
            total === 100 ? 'text-good-text' : 'text-warning',
          )}
        >
          {total === 100 ? <CheckIcon size={13} /> : <AlertTriangleIcon size={13} />}
          {percent(total)} allocated
        </span>
      }
    >
      <ErrorNote error={save.error ?? remove.error} />
      <ul className="flex flex-col gap-2">
        {drafts.map((d, i) => (
          <li
            key={d.id ?? `new-${i}`}
            className="grid grid-cols-[auto_1fr_5.5rem] items-center gap-2 sm:grid-cols-[auto_1fr_6rem_8rem_auto]"
          >
            <input
              type="color"
              aria-label="Colour"
              value={d.color}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded-lg border border-line bg-transparent"
            />
            <Input value={d.name} onChange={(e) => update(i, { name: e.target.value })} />
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                value={d.percent}
                onChange={(e) => update(i, { percent: e.target.value })}
                className="pr-7 text-right"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">
                %
              </span>
            </div>
            <Select
              value={d.goal_type}
              onChange={(e) => update(i, { goal_type: e.target.value })}
              className="col-span-2 sm:col-span-1"
            >
              <option value="save">Save ≥</option>
              <option value="spend">Spend ≤</option>
            </Select>
            {d.id ? (
              <ConfirmButton
                label="Remove"
                onConfirm={() => remove.mutate(d.id!)}
                message={`Remove "${d.name}"? Categories mapped to it become unassigned.`}
              />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
              >
                Cancel
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button
          size="sm"
          onClick={() =>
            setDrafts([...drafts, { name: '', percent: '0', goal_type: 'spend', color: '#6b7280' }])
          }
        >
          <PlusIcon size={14} />
          Add bucket
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || save.isPending || drafts.some((d) => !d.name.trim())}
          onClick={() => void saveAll()}
        >
          {save.isPending ? 'Saving…' : 'Save rule'}
        </Button>
      </div>
    </Panel>
  )
}

/* ---------------------------------------------------- category mapping */

function CategoryMapping() {
  const categories = useCategories()
  const buckets = useBuckets()
  const save = useSaveCategory()
  const expense = (categories.data ?? []).filter((c) => c.kind === 'expense')

  return (
    <Panel
      title="What counts toward each bucket"
      subtitle="Spending in a category counts toward its bucket. Put savings in a category like “Emergency fund”, or map a savings account on the Accounts page."
    >
      <ErrorNote error={save.error} />
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {expense.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-1">
            <span className="truncate text-sm">
              {c.icon} {c.name}
            </span>
            <Select
              value={c.bucket_id ?? ''}
              onChange={(e) =>
                save.mutate({ id: c.id, bucket_id: e.target.value ? Number(e.target.value) : null })
              }
              className={cx('w-40 py-1.5 text-xs', !c.bucket_id && 'text-muted')}
            >
              <option value="">No bucket</option>
              {buckets.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* -------------------------------------------------------------- history */

function History() {
  const history = useBudgetHistory(12)
  const buckets = useBuckets()
  if (!history.data || !buckets.data?.length) return null

  return (
    <Panel title="Last 12 months" subtitle="Did each month follow the rule?">
      <div className="scroll-x">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-2 text-left font-medium">Month</th>
              {buckets.data.map((b) => (
                <th key={b.id} className="px-2 py-2 text-center font-medium">
                  {b.name}
                </th>
              ))}
              <th className="py-2 text-right font-medium">Income</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {history.data.map((m) => (
              <tr key={`${m.year}-${m.month}`}>
                <td className="py-2 whitespace-nowrap">
                  {MONTHS[m.month - 1]} {m.year}
                </td>
                {buckets.data.map((b) => {
                  const s = m.buckets.find((x) => x.bucket_id === b.id)
                  if (!s || s.on_track === null)
                    return (
                      <td key={b.id} className="px-2 py-2 text-center text-muted">
                        ·
                      </td>
                    )
                  return (
                    <td key={b.id} className="px-2 py-2 text-center">
                      <span
                        title={`${money(s.actual, m.base_currency)} of ${money(s.target, m.base_currency)}`}
                        className={cx(
                          'inline-flex items-center gap-1 text-xs font-medium',
                          s.on_track ? 'text-good-text' : 'text-critical',
                        )}
                      >
                        {s.on_track ? <CheckIcon size={13} /> : <AlertTriangleIcon size={13} />}
                        {percent(s.actual_percent)}
                      </span>
                    </td>
                  )
                })}
                <td className="tabular py-2 text-right text-ink-2">
                  {money(m.income_basis, m.base_currency, { compact: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
