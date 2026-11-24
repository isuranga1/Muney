import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Panel } from '@/components/charts'
import { EnvelopeBadge } from '@/components/badges'
import { OverspendAlerts, approx } from '@/components/budget'
import { MonthNav, ProgressBar, useMonthState } from '@/components/finance'
import { AlertTriangleIcon, CheckIcon, PiggyBankIcon, PlusIcon } from '@/components/icons'
import {
  Button,
  Card,
  ErrorNote,
  Input,
  Modal,
  SectionHeader,
  Select,
  Spinner,
  cx,
} from '@/components/ui'
import { MONTHS, monthLabel, money, percent, seriesColor, signedMoney } from '@/lib/format'
import {
  useBudgetHistory,
  useBudgetMonth,
  useBuckets,
  useCategories,
  useDeleteBucket,
  useFunds,
  useSaveBucket,
  useSaveCategory,
  useSetIncomeBasis,
} from '@/lib/queries'
import type { Bucket, BucketMonth, BudgetMonthStatus } from '@/types'

export default function Budget() {
  const { year, month, set } = useMonthState()
  const status = useBudgetMonth(year, month)
  const funds = useFunds()

  return (
    <div className="animate-rise flex flex-col gap-5">
      <SectionHeader
        title="Budget rule"
        subtitle="Each bucket gets its percentage of every month's income. What isn't spent carries over."
        actions={
          <Link
            to="/funds"
            className="inline-flex items-center gap-1.5 text-sm text-series-1 underline-offset-2 hover:underline"
          >
            <PiggyBankIcon size={15} />
            Balances so far
          </Link>
        }
      />
      {funds.data && <OverspendAlerts data={funds.data} />}
      <MonthNav year={year} month={month} onChange={set} />
      <ErrorNote error={status.error} />
      {status.isLoading ? <Spinner /> : status.data && <MonthStatus status={status.data} />}
      <RuleEditor />
      <CategoryMapping />
      <History />
    </div>
  )
}

/* ---------------------------------------------------------- this month */

function MonthStatus({ status: s }: { status: BudgetMonthStatus }) {
  const setBasis = useSetIncomeBasis()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const base = s.base_currency
  const { year, month } = s

  return (
    <>
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Income shared out this month
            </p>
            <p className="tabular mt-1.5 text-2xl font-semibold">{money(s.income_basis, base)}</p>
            <p className="text-xs text-muted">
              {s.basis_is_override
                ? `Set by hand · actual income so far ${money(s.income_actual, base)}`
                : 'Actual income recorded this month'}
              {approx(s.income_basis, s.secondary_currency, s.secondary_rate) &&
                ` · ${approx(s.income_basis, s.secondary_currency, s.secondary_rate)}`}
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
        {s.rule_frozen && (
          <p className="mt-3 border-t border-hairline pt-3 text-xs text-muted">
            {monthLabel(year, month)} keeps the percentages it had. Rule changes apply from the
            current month on.
          </p>
        )}
      </Card>

      <section className="stagger grid gap-3 sm:grid-cols-2">
        {s.buckets.map((b, i) => (
          <Envelope key={b.bucket_id} b={b} base={base} color={b.color || seriesColor(i)} />
        ))}
      </section>

      {s.unassigned_spend > 0 && (
        <Card className="flex items-start gap-2.5 border-warning/45 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangleIcon size={16} className="mt-px shrink-0 text-warning" />
          <span>
            {money(s.unassigned_spend, base)} of spending this month isn't in any bucket, so it
            doesn't come out of any balance. It's uncategorised, or its category has no bucket.{' '}
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

/** One bucket's month: what came in, what went out, what's left. */
function Envelope({ b, base, color }: { b: BucketMonth; base: string; color: string }) {
  const saving = b.goal_type === 'save'
  const pool = Math.max(b.opening, 0) + b.share + b.moved_in
  const used = b.spent + b.moved_out + Math.max(-b.opening, 0)
  const rows: [string, number][] = [
    ['From last month', b.opening],
    [`This month's ${percent(b.percent)}`, b.share],
    ['Moved in', b.moved_in],
    ['Spent', -b.spent],
    ['Moved out', -b.moved_out],
  ]

  return (
    <Card className={cx('px-5 py-4', b.over && 'border-critical/45')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <div>
            <p className="font-semibold">{b.name}</p>
            <p className="text-xs text-muted">
              {percent(b.percent)} of income · {saving ? 'fund' : 'monthly spending'}
            </p>
          </div>
        </div>
        <EnvelopeBadge over={b.over} />
      </div>

      <p
        className={cx(
          'tabular mt-3 text-xl font-semibold',
          b.over && 'text-critical',
        )}
      >
        {signedMoney(b.available, base)}
        <span className="ml-1.5 text-sm font-normal text-muted">
          {b.over ? 'overspent' : saving ? 'in the fund' : 'left'}
        </span>
      </p>
      {!saving && (
        <div className="mt-2">
          <ProgressBar
            value={pool > 0 ? (used / pool) * 100 : used > 0 ? 100 : 0}
            color={color}
            over={b.over}
          />
        </div>
      )}

      <dl className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-xs">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className={cx('tabular', v < 0 ? 'text-ink-2' : 'text-ink')}>
                {signedMoney(v, base)}
              </dd>
            </div>
          ))}
        {b.used_percent !== null && b.spent > 0 && (
          <p className="mt-1 text-muted">
            Spent {percent(b.used_percent, 1)} of income against {percent(b.percent)} planned.
          </p>
        )}
      </dl>
    </Card>
  )
}

/* --------------------------------------------------------- rule editor */

type BucketDraft = { id?: number; name: string; percent: string; goal_type: string; color: string }

function toDraft(b: Bucket): BucketDraft {
  return {
    id: b.id,
    name: b.name,
    percent: String(b.percent),
    goal_type: b.goal_type,
    color: b.color ?? '#2a78d6',
  }
}

function RuleEditor() {
  const buckets = useBuckets()
  const save = useSaveBucket()
  const [drafts, setDrafts] = useState<BucketDraft[]>([])
  const [removing, setRemoving] = useState<Bucket | null>(null)

  useEffect(() => {
    if (buckets.data) setDrafts(buckets.data.map(toDraft))
  }, [buckets.data])

  // Only send the buckets that changed (or moved position).
  const saved = new Map(
    (buckets.data ?? []).map((b, i) => [b.id, JSON.stringify([toDraft(b), i])]),
  )
  const changed = drafts.filter(
    (d, i) => !d.id || saved.get(d.id) !== JSON.stringify([d, i]),
  )
  const total = drafts.reduce((sum, d) => sum + (Number(d.percent) || 0), 0)

  function update(index: number, patch: Partial<BucketDraft>) {
    setDrafts(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  async function saveAll() {
    for (const d of changed) {
      await save.mutateAsync({
        id: d.id,
        name: d.name.trim(),
        percent: Number(d.percent) || 0,
        goal_type: d.goal_type,
        color: d.color,
        sort_order: drafts.indexOf(d),
      })
    }
  }

  return (
    <Panel
      title="Your rule"
      subtitle="Add, remove or change buckets any time. Changes apply from this month on; past months keep the rule they had."
      action={
        <span
          className={cx(
            'inline-flex items-center gap-1 text-xs font-semibold',
            total === 100 ? 'text-good-text' : 'text-warning',
          )}
        >
          {total === 100 ? <CheckIcon size={13} /> : <AlertTriangleIcon size={13} />}
          {percent(total)} of income
        </span>
      }
    >
      <ErrorNote error={save.error} />
      <ul className="flex flex-col gap-2">
        {drafts.map((d, i) => (
          <li
            key={d.id ?? `new-${i}`}
            className="grid grid-cols-[auto_1fr_5.5rem] items-center gap-2 sm:grid-cols-[auto_1fr_6rem_9rem_auto]"
          >
            <input
              type="color"
              aria-label="Colour"
              value={d.color}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-9 w-9 cursor-pointer rounded-lg border border-line bg-transparent"
            />
            <Input
              value={d.name}
              aria-label="Name"
              placeholder="Bucket name"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <div className="relative">
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                aria-label="Percent of income"
                value={d.percent}
                onChange={(e) => update(i, { percent: e.target.value })}
                className="pr-7 text-right"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">
                %
              </span>
            </div>
            <Select
              aria-label="Kind"
              value={d.goal_type}
              onChange={(e) => update(i, { goal_type: e.target.value })}
              className="col-span-2 sm:col-span-1"
            >
              <option value="save">Fund (saves up)</option>
              <option value="spend">Monthly spending</option>
            </Select>
            {d.id ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemoving(buckets.data?.find((b) => b.id === d.id) ?? null)}
              >
                Remove
              </Button>
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
      {total !== 100 && drafts.length > 0 && (
        <p className="mt-3 text-xs text-warning">
          {total < 100
            ? `${percent(100 - total)} of income isn't going to any bucket.`
            : `That's ${percent(total - 100)} more than your income.`}
        </p>
      )}
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
          disabled={!changed.length || save.isPending || drafts.some((d) => !d.name.trim())}
          onClick={() => void saveAll()}
        >
          {save.isPending ? 'Saving…' : 'Save rule'}
        </Button>
      </div>
      {removing && <RemoveBucket bucket={removing} onClose={() => setRemoving(null)} />}
    </Panel>
  )
}

/** Removing a bucket: its balance goes to another bucket, or is dropped. */
function RemoveBucket({ bucket, onClose }: { bucket: Bucket; onClose: () => void }) {
  const funds = useFunds()
  const remove = useDeleteBucket()
  const fund = funds.data?.funds.find((f) => f.bucket_id === bucket.id)
  const others = funds.data?.funds.filter((f) => f.bucket_id !== bucket.id) ?? []
  const [moveTo, setMoveTo] = useState<number | 0>(others[0]?.bucket_id ?? 0)
  const base = funds.data?.base_currency ?? ''
  const balance = fund?.balance ?? 0

  return (
    <Modal open title={`Remove ${bucket.name}?`} onClose={onClose}>
      {funds.isLoading ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-ink-2">
            Categories in it become unassigned. Past months keep their numbers.
          </p>
          {balance !== 0 && (
            <label className="flex flex-col gap-1.5">
              <span>
                It {balance > 0 ? 'holds' : 'is overspent by'}{' '}
                <span className={cx('tabular font-semibold', balance < 0 && 'text-critical')}>
                  {money(Math.abs(balance), base)}
                </span>
                . {balance > 0 ? 'Move it to' : 'Cover it from'}:
              </span>
              <Select value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}>
                {others.map((f) => (
                  <option key={f.bucket_id} value={f.bucket_id}>
                    {f.name}
                  </option>
                ))}
                <option value={0}>{balance > 0 ? 'Nowhere, drop it' : 'Nowhere, ignore it'}</option>
              </Select>
            </label>
          )}
          <ErrorNote error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { id: bucket.id, moveTo: balance !== 0 ? moveTo || null : null },
                  { onSuccess: onClose },
                )
              }
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </Modal>
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
      title="What comes out of each bucket"
      subtitle="Spending in a category is taken from its bucket. Spending in no bucket isn't taken from any."
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
    <Panel
      title="Last 12 months"
      subtitle="Share of income each bucket spent, and its balance at the month's end."
    >
      <div className="scroll-x">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-2 text-left font-medium">Month</th>
              {buckets.data.map((b) => (
                <th key={b.id} className="px-2 py-2 text-right font-medium">
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
                  if (!s || (s.share === 0 && s.spent === 0 && s.available === 0))
                    return (
                      <td key={b.id} className="px-2 py-2 text-right text-muted">
                        ·
                      </td>
                    )
                  return (
                    <td key={b.id} className="px-2 py-2 text-right">
                      <span
                        className={cx(
                          'tabular inline-flex items-center gap-1 text-xs font-medium',
                          s.over ? 'text-critical' : 'text-ink',
                        )}
                      >
                        {s.over && <AlertTriangleIcon size={12} />}
                        {money(s.available, m.base_currency, { compact: true })}
                      </span>
                      {s.used_percent !== null && (
                        <span className="block text-[0.6875rem] text-muted">
                          spent {percent(s.used_percent)} / {percent(s.percent)}
                        </span>
                      )}
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
