/**
 * Pieces shared by the Budget and Funds pages.
 *
 * Every bucket is an envelope: it gets its percentage of each month's income,
 * spending in its categories comes out, and what's left carries over. When one
 * goes negative, money is moved in from another bucket. The percentages never
 * change; only the balances do.
 */
import { useState } from 'react'
import type { FormEvent } from 'react'

import { AlertTriangleIcon, TransferIcon } from '@/components/icons'
import { Button, Card, ErrorNote, Field, Input, Modal, Select, cx } from '@/components/ui'
import { localDate, money, signedMoney } from '@/lib/format'
import { useConfig, useMoveMoney } from '@/lib/queries'
import type { FundStatus, FundsOverview } from '@/types'

/** "≈ USD 200.00" beside a base-currency amount, when there's a rate. */
export function approx(
  amount: number,
  secondary: string | null,
  rate: number | null,
): string | null {
  if (!secondary || !rate) return null
  return `≈ ${signedMoney(amount / rate, secondary)}`
}

/* ------------------------------------------------------- overspend alert */

/**
 * Every overspent bucket, each with a way to cover it from another bucket.
 * Shown at the top of the Budget and Funds pages.
 */
export function OverspendAlerts({ data }: { data: FundsOverview }) {
  const over = data.funds.filter((f) => f.balance < 0)
  if (!over.length) return null
  return (
    <Card className="border-critical/40 bg-critical/8 px-4 py-4">
      <p className="flex items-center gap-2 font-semibold text-critical">
        <AlertTriangleIcon size={16} />
        {over.length === 1 ? 'A bucket is overspent' : `${over.length} buckets are overspent`}
      </p>
      <p className="mt-1 text-sm text-ink-2">
        Cover it from another bucket. Your percentages stay the same; the money just moves
        between buckets.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {over.map((fund) => (
          // Remount when the balance changes, so the suggested amount follows.
          <CoverRow key={`${fund.bucket_id}-${fund.balance}`} fund={fund} data={data} />
        ))}
      </ul>
    </Card>
  )
}

function CoverRow({ fund, data }: { fund: FundStatus; data: FundsOverview }) {
  const move = useMoveMoney()
  const base = data.base_currency
  const deficit = -fund.balance
  const sources = data.funds
    .filter((f) => f.bucket_id !== fund.bucket_id)
    .sort((a, b) => b.balance - a.balance)
  const [from, setFrom] = useState(sources[0]?.bucket_id ?? 0)
  const [amount, setAmount] = useState(String(deficit))
  const source = sources.find((f) => f.bucket_id === from)
  const leaves = source ? source.balance - (Number(amount) || 0) : 0

  if (!sources.length) return null
  return (
    <li className="rounded-xl border border-hairline bg-surface/60 px-3 py-3">
      <p className="text-sm">
        <span className="font-semibold">{fund.name}</span> is over by{' '}
        <span className="tabular font-semibold text-critical">{money(deficit, base)}</span>
        {approx(deficit, data.secondary_currency, data.secondary_rate) && (
          <span className="text-muted">
            {' '}
            ({approx(deficit, data.secondary_currency, data.secondary_rate)})
          </span>
        )}
      </p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          move.mutate({
            from_bucket_id: from,
            to_bucket_id: fund.bucket_id,
            amount: Number(amount),
            note: `Cover ${fund.name}`,
          })
        }}
      >
        <span className="text-sm text-ink-2">Take</span>
        <Input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          required
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 py-2"
        />
        <span className="text-sm text-ink-2">from</span>
        <Select
          aria-label="Take it from"
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
          className="w-auto min-w-44 flex-1 py-2"
        >
          {sources.map((s) => (
            <option key={s.bucket_id} value={s.bucket_id}>
              {s.name} · {signedMoney(s.balance, base)}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="primary" disabled={move.isPending}>
          <TransferIcon size={14} />
          Cover
        </Button>
      </form>
      {source && leaves < 0 && (
        <p className="mt-1.5 text-xs text-warning">
          That leaves {source.name} overspent by {money(-leaves, base)}.
        </p>
      )}
      <ErrorNote error={move.error} />
    </li>
  )
}

/* ------------------------------------------------------------ move money */

export type MoveMode = 'move' | 'add' | 'out'

const MODE_TEXT: Record<MoveMode, { title: string; hint: string; action: string }> = {
  move: {
    title: 'Move money from',
    hint: 'Shift part of this bucket to another one. The percentages stay the same.',
    action: 'Move',
  },
  add: {
    title: 'Add money to',
    hint: 'For money you’d already saved before tracking it here, or an extra top-up.',
    action: 'Add',
  },
  out: {
    title: 'Take money out of',
    hint: 'For spending from this bucket that isn’t in one of its categories.',
    action: 'Take out',
  },
}

export function MoveModal({
  fund,
  mode,
  data,
  onClose,
}: {
  fund: FundStatus
  mode: MoveMode
  data: FundsOverview
  onClose: () => void
}) {
  const config = useConfig()
  const move = useMoveMoney()
  const base = data.base_currency
  const currencies = config.data?.supported_currencies ?? [base]
  const others = data.funds.filter((f) => f.bucket_id !== fund.bucket_id)
  const [to, setTo] = useState(others[0]?.bucket_id ?? 0)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(base)
  const [date, setDate] = useState(localDate())
  const [note, setNote] = useState('')
  const text = MODE_TEXT[mode]

  function submit(event: FormEvent) {
    event.preventDefault()
    move.mutate(
      {
        from_bucket_id: mode === 'add' ? null : fund.bucket_id,
        to_bucket_id: mode === 'out' ? null : mode === 'add' ? fund.bucket_id : to,
        amount: Number(amount),
        currency,
        moved_on: date,
        note: note.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal open title={`${text.title} ${fund.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          {text.hint} It holds{' '}
          <span className={cx('tabular font-medium', fund.balance < 0 && 'text-critical')}>
            {signedMoney(fund.balance, base)}
          </span>{' '}
          now.
        </p>
        {mode === 'move' && (
          <Field label="To">
            <Select value={to} onChange={(e) => setTo(Number(e.target.value))}>
              {others.map((f) => (
                <option key={f.bucket_id} value={f.bucket_id}>
                  {f.name} · {signedMoney(f.balance, base)}
                </option>
              ))}
            </Select>
          </Field>
        )}
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
        {currency !== base && (
          <p className="-mt-2 text-xs text-muted">
            Converted to {base} at today’s rate. Buckets are kept in {base}.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input
              value={note}
              maxLength={150}
              placeholder={mode === 'add' ? 'Opening balance' : mode === 'out' ? 'Car repair' : ''}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
        <ErrorNote error={move.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={move.isPending || (mode === 'move' && !to)}
          >
            {text.action}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
