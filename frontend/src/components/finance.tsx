/**
 * Building blocks shared by the money pages: month navigation, amounts shown
 * in two currencies, category chips, progress bars, the year chart, and the
 * one transaction form used everywhere (add, edit, record-from-SMS).
 */
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { LlmBadge } from '@/components/badges'
import { ChevronLeftIcon, ChevronRightIcon, SparklesIcon, TransferIcon } from '@/components/icons'
import {
  Button,
  ConfirmButton,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  cx,
} from '@/components/ui'
import { MONTHS, localDate, money, signedMoney } from '@/lib/format'
import {
  useAccounts,
  useCategories,
  useConfig,
  useDeleteTransaction,
  useSaveTransaction,
} from '@/lib/queries'
import type { Account, Category, Transaction, TransactionKind } from '@/types'

/* ------------------------------------------------------------- month nav */

export function MonthNav({
  year,
  month,
  onChange,
  yearOnly = false,
}: {
  year: number
  month: number
  onChange: (year: number, month: number) => void
  yearOnly?: boolean
}) {
  const now = new Date()
  const isCurrent = yearOnly
    ? year === now.getFullYear()
    : year === now.getFullYear() && month === now.getMonth() + 1

  function step(delta: number) {
    if (yearOnly) return onChange(year + delta, month)
    const index = year * 12 + (month - 1) + delta
    onChange(Math.floor(index / 12), (index % 12) + 1)
  }

  const label = yearOnly
    ? String(year)
    : new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={yearOnly ? 'Previous year' : 'Previous month'}
        onClick={() => step(-1)}
        className="spring grid size-10 place-items-center rounded-full text-ink-2 hover:bg-black/5 dark:hover:bg-white/10"
      >
        <ChevronLeftIcon />
      </button>
      <span className="min-w-[9.5rem] text-center text-sm font-semibold">{label}</span>
      <button
        type="button"
        aria-label={yearOnly ? 'Next year' : 'Next month'}
        onClick={() => step(1)}
        className="spring grid size-10 place-items-center rounded-full text-ink-2 hover:bg-black/5 dark:hover:bg-white/10"
      >
        <ChevronRightIcon />
      </button>
      {!isCurrent && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(now.getFullYear(), now.getMonth() + 1)}
        >
          {yearOnly ? 'This year' : 'This month'}
        </Button>
      )}
    </div>
  )
}

/** Year/month state that starts on today. */
export function useMonthState() {
  const now = new Date()
  const [state, setState] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  return {
    ...state,
    set: (year: number, month: number) => setState({ year, month }),
  }
}

/* --------------------------------------------------------------- amounts */

/**
 * An account's balance in its own currency, with its value in the other
 * display currencies beside it: "USD 1,500.00 · ≈ LKR 450,000 ".
 */
export function DualAmount({
  amount,
  currency,
  base,
  baseCurrency,
  secondary,
  secondaryCurrency,
  negative = false,
  size = 'md',
}: {
  amount: number
  currency: string
  base: number | null
  baseCurrency: string
  secondary?: number | null
  secondaryCurrency?: string | null
  negative?: boolean
  size?: 'md' | 'lg'
}) {
  const sign = negative ? -1 : 1
  const others = [
    currency !== baseCurrency && base !== null ? signedMoney(sign * base, baseCurrency) : null,
    secondaryCurrency && currency !== secondaryCurrency && secondary != null
      ? signedMoney(sign * secondary, secondaryCurrency)
      : null,
  ].filter(Boolean)

  return (
    <div className="text-right">
      <p
        className={cx(
          'tabular font-semibold',
          size === 'lg' ? 'text-xl' : 'text-sm',
          negative && amount !== 0 && 'text-critical',
        )}
      >
        {signedMoney(sign * amount, currency)}
      </p>
      {others.length > 0 && (
        <p className="tabular text-xs text-muted">{others.map((o) => `≈ ${o}`).join(' · ')}</p>
      )}
    </div>
  )
}

export function TxnAmount({ txn }: { txn: Transaction }) {
  const text = money(txn.amount, txn.currency)
  if (txn.kind === 'income')
    return <span className="tabular font-semibold text-good-text">+{text}</span>
  if (txn.kind === 'transfer')
    return <span className="tabular font-semibold text-ink-2">{text}</span>
  return <span className="tabular font-semibold">−{text}</span>
}

/* -------------------------------------------------------------- category */

export function CategoryIcon({
  category,
  kind,
  size = 'md',
}: {
  category?: Category | null
  kind?: TransactionKind
  size?: 'sm' | 'md'
}) {
  const fallback = kind === 'transfer' ? <TransferIcon size={16} /> : '•'
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid shrink-0 place-items-center rounded-full',
        size === 'md' ? 'size-10 text-lg' : 'size-7 text-sm',
      )}
      style={{
        backgroundColor: category?.color
          ? `color-mix(in srgb, ${category.color} 18%, transparent)`
          : 'color-mix(in srgb, var(--color-muted, #888) 14%, transparent)',
      }}
    >
      {category?.icon || fallback}
    </span>
  )
}

export function CategoryLabel({ category }: { category?: Category | null }) {
  if (!category) return <span className="text-muted">Uncategorised</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {category.name}
      {category.origin === 'llm' && <LlmBadge label="new" />}
    </span>
  )
}

/* -------------------------------------------------------------- progress */

/** Fill against a target; the part past 100% is drawn in a second tone. */
export function ProgressBar({
  value,
  color,
  over = false,
}: {
  value: number
  color: string
  over?: boolean
}) {
  const width = Math.max(0, Math.min(value, 100))
  return (
    <div className="glass-inset h-2.5 w-full overflow-hidden rounded-full p-0">
      <div
        className="spring h-full rounded-full"
        style={{ width: `${width}%`, backgroundColor: over ? 'var(--critical)' : color }}
      />
    </div>
  )
}

/* ------------------------------------------------------------ year chart */

const INCOME_COLOR = 'var(--series-1)'
const EXPENSE_COLOR = 'var(--series-2)'

/** Income vs spending per month: paired columns on one shared axis. */
export function MonthBars({
  months,
  currency,
  onSelect,
}: {
  months: { month: number; income: number; expense: number }[]
  currency: string
  onSelect?: (month: number) => void
}) {
  const max = Math.max(...months.flatMap((m) => [m.income, m.expense]), 0)
  if (max === 0) return <p className="py-10 text-sm text-muted">Nothing recorded this year yet.</p>

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink-2">
        {[
          ['Income', INCOME_COLOR],
          ['Spending', EXPENSE_COLOR],
        ].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="scroll-x">
        <div className="flex h-44 min-w-[34rem] items-end gap-1.5 border-b border-line">
          {months.map((m) => (
            <button
              key={m.month}
              type="button"
              onClick={() => onSelect?.(m.month)}
              title={`${MONTHS[m.month - 1]} — income ${money(m.income, currency)}, spending ${money(m.expense, currency)}`}
              className="group flex h-full flex-1 flex-col justify-end rounded-t-md hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            >
              <div className="flex h-full items-end justify-center gap-[2px] px-0.5">
                {[
                  [m.income, INCOME_COLOR],
                  [m.expense, EXPENSE_COLOR],
                ].map(([value, color], i) => (
                  <div
                    key={i}
                    className="spring w-full max-w-4 rounded-t-[4px]"
                    style={{
                      height: `${((value as number) / max) * 100}%`,
                      minHeight: (value as number) > 0 ? 2 : 0,
                      backgroundColor: color as string,
                    }}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className="flex min-w-[34rem] gap-1.5 pt-1.5">
          {months.map((m) => (
            <span key={m.month} className="flex-1 text-center text-[11px] text-muted">
              {MONTHS[m.month - 1]}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------ transaction form */

type Draft = {
  id?: number
  kind: TransactionKind
  amount: string
  currency: string
  account_id: number | null
  to_account_id: number | null
  to_amount: string
  category_id: number | null
  merchant: string
  occurred_on: string
  note: string
}

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
]

function draftFrom(txn: Transaction | null, defaults: Partial<Draft>, base: string): Draft {
  if (txn) {
    return {
      id: txn.id,
      kind: txn.kind,
      amount: String(txn.amount),
      currency: txn.currency,
      account_id: txn.account_id,
      to_account_id: txn.to_account_id,
      to_amount: txn.to_account_delta ? String(Math.abs(txn.to_account_delta)) : '',
      category_id: txn.category_id,
      merchant: txn.merchant ?? '',
      occurred_on: txn.occurred_on,
      note: txn.note ?? '',
    }
  }
  return {
    kind: 'expense',
    amount: '',
    currency: base,
    account_id: null,
    to_account_id: null,
    to_amount: '',
    category_id: null,
    merchant: '',
    occurred_on: localDate(),
    note: '',
    ...defaults,
  }
}

export function TransactionModal({
  open,
  transaction,
  defaults = {},
  onClose,
}: {
  open: boolean
  transaction: Transaction | null
  defaults?: Partial<Draft>
  onClose: () => void
}) {
  const config = useConfig()
  const accounts = useAccounts()
  const categories = useCategories()
  const save = useSaveTransaction()
  const remove = useDeleteTransaction()

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const llmOn = (config.data?.llm_provider ?? 'none') !== 'none'
  const [draft, setDraft] = useState<Draft>(() => draftFrom(transaction, defaults, base))

  // Reset whenever the modal opens on a different row.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(transaction, defaults, base))
      save.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id])

  const accountList = (accounts.data?.accounts ?? []).filter((a) => !a.is_archived)
  const accountById = new Map(accountList.map((a) => [a.id, a] as [number, Account]))
  const kindCategories = (categories.data ?? []).filter((c) => c.kind === draft.kind)
  const target = draft.to_account_id ? accountById.get(draft.to_account_id) : undefined
  const crossCurrency = draft.kind === 'transfer' && target && target.currency !== draft.currency

  function setAccount(id: number | null) {
    const account = id ? accountById.get(id) : undefined
    // The amount is normally in the account's currency — follow it.
    setDraft({ ...draft, account_id: id, currency: account?.currency ?? draft.currency })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const body: Record<string, unknown> = {
      kind: draft.kind,
      amount: Number(draft.amount),
      currency: draft.currency,
      account_id: draft.account_id,
      to_account_id: draft.kind === 'transfer' ? draft.to_account_id : null,
      category_id: draft.kind === 'transfer' ? null : draft.category_id,
      merchant: draft.merchant.trim() || null,
      occurred_on: draft.occurred_on || null,
      note: draft.note.trim() || null,
    }
    if (crossCurrency && draft.to_amount) body.to_amount = Number(draft.to_amount)
    save.mutate({ id: draft.id, ...body }, { onSuccess: onClose })
  }

  return (
    <Modal open={open} title={draft.id ? 'Edit transaction' : 'New transaction'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="glass-inset grid grid-cols-3 gap-1 rounded-full p-1">
          {KINDS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setDraft({ ...draft, kind: value, category_id: null })}
              className={cx(
                'spring rounded-full py-1.5 text-sm font-medium',
                draft.kind === value ? 'bg-series-1 text-white' : 'text-ink-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount" className="col-span-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              autoFocus
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
          </Field>
          <Field label="Currency">
            <Select
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
            >
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={draft.kind === 'income' ? 'Into account' : 'From account'}>
            <AccountSelect
              accounts={accountList}
              value={draft.account_id}
              onChange={setAccount}
              emptyLabel={draft.kind === 'transfer' ? 'Choose…' : 'No account'}
              required={draft.kind === 'transfer'}
            />
          </Field>
          {draft.kind === 'transfer' ? (
            <Field label="To account">
              <AccountSelect
                accounts={accountList.filter((a) => a.id !== draft.account_id)}
                value={draft.to_account_id}
                onChange={(id) => setDraft({ ...draft, to_account_id: id })}
                emptyLabel="Choose…"
                required
              />
            </Field>
          ) : (
            <Field label="Date">
              <Input
                type="date"
                value={draft.occurred_on}
                onChange={(e) => setDraft({ ...draft, occurred_on: e.target.value })}
              />
            </Field>
          )}
        </div>

        {crossCurrency && (
          <Field
            label={`Amount received in ${target.currency}`}
            hint="Leave empty to convert at today's rate."
          >
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={draft.to_amount}
              onChange={(e) => setDraft({ ...draft, to_amount: e.target.value })}
            />
          </Field>
        )}

        {draft.kind !== 'transfer' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={draft.kind === 'income' ? 'From (payer)' : 'Merchant'}>
              <Input
                value={draft.merchant}
                onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
                placeholder={draft.kind === 'income' ? 'Employer' : 'Keells Super'}
              />
            </Field>
            <Field label="Category">
              <Select
                value={draft.category_id ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    category_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">{llmOn ? '✨ Auto (rules, then AI)' : 'Auto (by keyword)'}</option>
                {kindCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ''}
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {draft.kind === 'transfer' && (
          <Field label="Date">
            <Input
              type="date"
              value={draft.occurred_on}
              onChange={(e) => setDraft({ ...draft, occurred_on: e.target.value })}
            />
          </Field>
        )}

        <Field label="Note">
          <Textarea
            rows={2}
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </Field>

        {transaction?.source === 'sms' && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <SparklesIcon size={13} />
            Recorded from a bank SMS
            {transaction.categorized_by ? ` · category by ${transaction.categorized_by}` : ''}
          </p>
        )}

        <ErrorNote error={save.error ?? remove.error} />

        <div className="flex items-center justify-between gap-2">
          <div>
            {draft.id && (
              <ConfirmButton
                onConfirm={() => remove.mutate(draft.id!, { onSuccess: onClose })}
                message="Delete this transaction? Account balances are put back."
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : draft.id ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  emptyLabel = 'No account',
  required = false,
}: {
  accounts: Account[]
  value: number | null
  onChange: (id: number | null) => void
  emptyLabel?: string
  required?: boolean
}) {
  return (
    <Select
      value={value ?? ''}
      required={required}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{emptyLabel}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} · {a.currency}
          {a.last_digits ? ` ··${a.last_digits.slice(-4)}` : ''}
        </option>
      ))}
    </Select>
  )
}

/* --------------------------------------------------------- transaction row */

export function TransactionRow({
  txn,
  category,
  accountName,
  toAccountName,
  baseCurrency,
  onClick,
  trailing,
}: {
  txn: Transaction
  category?: Category | null
  accountName?: string
  toAccountName?: string
  baseCurrency: string
  onClick: () => void
  trailing?: ReactNode
}) {
  const title =
    txn.kind === 'transfer'
      ? `${accountName ?? '?'} → ${toAccountName ?? '?'}`
      : txn.merchant || category?.name || (txn.kind === 'income' ? 'Income' : 'Expense')
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="spring flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
      >
        <CategoryIcon category={category} kind={txn.kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-muted">
            {txn.kind === 'transfer' ? 'Transfer' : <CategoryLabel category={category} />}
            {accountName && txn.kind !== 'transfer' ? ` · ${accountName}` : ''}
            {txn.source === 'sms' ? ' · SMS' : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <TxnAmount txn={txn} />
          {txn.currency !== baseCurrency && txn.base_amount !== null && (
            <p className="tabular text-xs text-muted">≈ {money(txn.base_amount, baseCurrency)}</p>
          )}
        </div>
        {trailing}
      </button>
    </li>
  )
}
