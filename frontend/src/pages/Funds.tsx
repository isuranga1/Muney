import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Panel } from '@/components/charts'
import { ProgressBar } from '@/components/finance'
import { AlertTriangleIcon, CheckIcon, PlusIcon } from '@/components/icons'
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  Spinner,
  cx,
} from '@/components/ui'
import {
  localDate,
  monthLabel,
  money,
  percent,
  seriesColor,
  shortDate,
  signedMoney,
} from '@/lib/format'
import {
  useAddFundEntry,
  useConfig,
  useDeleteFundEntry,
  useFundEntries,
  useFunds,
} from '@/lib/queries'
import type { FundStatus, FundsOverview } from '@/types'

type Adjusting = { fund: FundStatus; direction: 'in' | 'out' }

export default function Funds() {
  const funds = useFunds()
  const [adjusting, setAdjusting] = useState<Adjusting | null>(null)

  if (funds.isLoading) return <Spinner />
  const data = funds.data

  return (
    <div className="animate-rise flex flex-col gap-5">
      <SectionHeader
        title="Funds"
        subtitle={
          data
            ? `What each bucket holds, counted from ${monthLabel(data.since_year, data.since_month)}.`
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
          <Card className="px-5 py-4">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              All funds
            </p>
            <p className="tabular mt-2 text-2xl font-semibold tracking-tight">
              {signedMoney(data.total, data.base_currency)}
            </p>
            {data.secondary_currency && data.secondary_rate && (
              <p className="tabular text-sm text-ink-2">
                ≈ {signedMoney(data.total / data.secondary_rate, data.secondary_currency)}
              </p>
            )}
          </Card>

          <section className="stagger grid gap-3 md:grid-cols-2">
            {data.funds.map((fund, i) => (
              <FundCard
                key={fund.bucket_id}
                fund={fund}
                data={data}
                color={fund.color || seriesColor(i)}
                onAdjust={(direction) => setAdjusting({ fund, direction })}
              />
            ))}
          </section>

          <Earmarks data={data} />
        </>
      )}

      {adjusting && data && (
        <AdjustModal adjusting={adjusting} data={data} onClose={() => setAdjusting(null)} />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- a fund */

function FundCard({
  fund,
  data,
  color,
  onAdjust,
}: {
  fund: FundStatus
  data: FundsOverview
  color: string
  onAdjust: (direction: 'in' | 'out') => void
}) {
  const [history, setHistory] = useState(false)
  const base = data.base_currency
  const saving = fund.goal_type === 'save'
  const net = fund.put_in - fund.taken_out
  // Saving funds are valued at today's rates; the gap is what FX moves did.
  const fxGain = saving ? fund.balance - net : 0
  const progress = saving
    ? fund.goal_to_date > 0
      ? (net / fund.goal_to_date) * 100
      : 0
    : fund.put_in > 0
      ? (fund.taken_out / fund.put_in) * 100
      : 0
  const foreign = fund.holdings.filter((h) => h.currency !== base)

  return (
    <Card className="flex flex-col px-5 py-4">
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
              {saving ? 'Saving' : 'Spending'} · {percent(fund.percent)} of income
            </p>
          </div>
        </div>
        {fund.months_counted > 0 && (
          <Badge
            tone={fund.months_met === fund.months_counted ? 'good' : 'neutral'}
            icon={<CheckIcon size={12} strokeWidth={2.5} />}
          >
            {fund.months_met}/{fund.months_counted} months
          </Badge>
        )}
      </div>

      <p
        className={cx(
          'tabular mt-3 text-2xl font-semibold tracking-tight',
          fund.balance < 0 && 'text-critical',
        )}
      >
        {signedMoney(fund.balance, base)}
      </p>
      <p className="tabular text-xs text-muted">
        {saving
          ? foreign.length
            ? `Held as ${fund.holdings.map((h) => signedMoney(h.amount, h.currency)).join(' + ')}`
            : 'Held in ' + base
          : fund.balance >= 0
            ? 'Budgeted but not yet spent'
            : 'Spent more than budgeted so far'}
        {data.secondary_currency &&
          data.secondary_rate &&
          !foreign.some((h) => h.currency === data.secondary_currency) &&
          ` · ≈ ${signedMoney(fund.balance / data.secondary_rate, data.secondary_currency)}`}
      </p>

      <div className="mt-3">
        <ProgressBar value={progress} color={color} over={!saving && fund.balance < 0} />
        <p className="tabular mt-1.5 text-xs text-muted">
          {saving
            ? `${money(net, base)} put away of ${money(fund.goal_to_date, base)} goal so far`
            : `${money(fund.taken_out, base)} spent of ${money(fund.put_in, base)} budgeted`}
        </p>
        {Math.abs(fxGain) >= 1 && (
          <p className="tabular text-xs text-muted">
            {fxGain > 0 ? '+' : '−'}
            {money(Math.abs(fxGain), base)} from exchange rates
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-hairline pt-3 text-xs">
        {saving ? (
          fund.allocated_this_month ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-good-text">
              <CheckIcon size={13} strokeWidth={2.25} />
              This month set aside
            </span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-ink-2">
              <AlertTriangleIcon size={13} className="text-warning" />
              This month not set aside yet
              {fund.this_month_target > 0 && ` (goal ${money(fund.this_month_target, base)})`} ·
              <Link to="/budget" className="text-series-1 underline-offset-2 hover:underline">
                Set aside
              </Link>
            </span>
          )
        ) : (
          <span className="tabular text-ink-2">
            This month: {money(fund.this_month_actual, base)} of{' '}
            {money(fund.this_month_target, base)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAdjust('in')}>
          <PlusIcon size={14} />
          Add
        </Button>
        <Button size="sm" onClick={() => onAdjust('out')}>
          Take out
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>
          {history ? 'Hide history' : 'History'}
        </Button>
      </div>

      {history && <FundHistory bucketId={fund.bucket_id} base={base} />}
    </Card>
  )
}

function FundHistory({ bucketId, base }: { bucketId: number; base: string }) {
  const entries = useFundEntries(bucketId)
  const remove = useDeleteFundEntry()

  if (entries.isLoading) return <Spinner />
  return (
    <div className="mt-3">
      <ErrorNote error={entries.error ?? remove.error} />
      {!entries.data?.length ? (
        <p className="text-xs text-muted">
          Nothing set aside by hand yet. Transfers into accounts mapped to this bucket, and spending
          in its categories, count too but live in Activity.
        </p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {entries.data.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate">
                  {e.kind === 'monthly'
                    ? `${monthLabel(e.year, e.month)} allocation`
                    : e.note || (e.amount < 0 ? 'Taken out' : 'Added')}
                </p>
                <p className="text-xs text-muted">
                  {shortDate(e.entry_date)}
                  {e.kind === 'monthly' && e.note && ` · ${e.note}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className={cx('tabular font-medium', e.amount < 0 && 'text-critical')}>
                    {signedMoney(e.amount, e.currency)}
                  </p>
                  {e.currency !== base && e.base_amount !== null && (
                    <p className="tabular text-xs text-muted">
                      ≈ {signedMoney(e.base_amount, base)}
                    </p>
                  )}
                </div>
                {e.kind === 'adjust' && (
                  <ConfirmButton
                    label="Delete"
                    message="Delete this entry? The fund's balance changes back."
                    onConfirm={() => remove.mutate(e.id)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {entries.data?.some((e) => e.kind === 'monthly') && (
        <p className="mt-2 text-xs text-muted">
          Monthly allocations are changed or undone on the Budget page.
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- earmarks */

function Earmarks({ data }: { data: FundsOverview }) {
  if (!data.earmarks.length) return null
  return (
    <Panel
      title="Set aside, still in your accounts"
      subtitle="Saving funds you've ticked off without moving the money. What's left is free to spend."
    >
      <div className="scroll-x">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-2 text-left font-medium">Currency</th>
              <th className="py-2 text-right font-medium">In accounts</th>
              <th className="py-2 text-right font-medium">Set aside</th>
              <th className="py-2 text-right font-medium">Free</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {data.earmarks.map((row) => (
              <tr key={row.currency}>
                <td className="py-2 font-medium">{row.currency}</td>
                <td className="tabular py-2 text-right">{money(row.in_accounts, row.currency)}</td>
                <td className="tabular py-2 text-right">{money(row.set_aside, row.currency)}</td>
                <td
                  className={cx(
                    'tabular py-2 text-right font-semibold',
                    row.free < 0 && 'text-critical',
                  )}
                >
                  {signedMoney(row.free, row.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.earmarks.some((row) => row.free < 0) && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-critical">
          <AlertTriangleIcon size={13} className="mt-px shrink-0" />
          More is set aside than the accounts hold — some fund money has been spent. Record it with
          “Take out” on that fund.
        </p>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------ add / out */

function AdjustModal({
  adjusting,
  data,
  onClose,
}: {
  adjusting: Adjusting
  data: FundsOverview
  onClose: () => void
}) {
  const { fund, direction } = adjusting
  const config = useConfig()
  const add = useAddFundEntry()
  const base = data.base_currency
  const currencies = config.data?.supported_currencies ?? [base]
  const saving = fund.goal_type === 'save'
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(
    saving ? (fund.holdings.find((h) => h.currency !== base)?.currency ?? base) : base,
  )
  const [date, setDate] = useState(localDate())
  const [note, setNote] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = Math.abs(Number(amount))
    add.mutate(
      {
        bucketId: fund.bucket_id,
        amount: direction === 'out' ? -value : value,
        currency,
        entry_date: date,
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      open
      title={direction === 'in' ? `Add to ${fund.name}` : `Take out of ${fund.name}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {direction === 'in'
            ? 'For money already saved before you started tracking, or an extra top-up. It adds to the balance but not to any month’s goal.'
            : 'For when you use money from this fund. The purchase itself still shows in Activity as usual.'}
        </p>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Amount">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input
              value={note}
              maxLength={200}
              placeholder={direction === 'in' ? 'Opening balance' : 'Car repair'}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <ErrorNote error={add.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={add.isPending}>
            {direction === 'in' ? 'Add' : 'Take out'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
