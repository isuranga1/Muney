import { useState } from 'react'
import type { FormEvent } from 'react'

import { InactiveBadge, LiabilityBadge } from '@/components/badges'
import { DualAmount } from '@/components/finance'
import { PlusIcon } from '@/components/icons'
import {
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  Spinner,
} from '@/components/ui'
import { signedMoney, titleCase } from '@/lib/format'
import { useAccounts, useConfig, useDeleteAccount, useSaveAccount } from '@/lib/queries'
import type { Account } from '@/types'

type Draft = {
  id?: number
  name: string
  institution: string
  account_type: string
  currency: string
  balance: string
  last_digits: string
  color: string
  include_in_total: boolean
  is_archived: boolean
  notes: string
}

const COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#4a3aa7',
  '#e34948',
  '#6b7280',
]

export default function Accounts() {
  const config = useConfig()
  const accounts = useAccounts()
  const save = useSaveAccount()
  const remove = useDeleteAccount()
  const [draft, setDraft] = useState<Draft | null>(null)

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const types = config.data?.account_types ?? ['savings']

  function startNew() {
    save.reset()
    setDraft({
      name: '',
      institution: '',
      account_type: 'savings',
      currency: base,
      balance: '',
      last_digits: '',
      color: COLORS[(accounts.data?.accounts.length ?? 0) % COLORS.length],
      include_in_total: true,
      is_archived: false,
      notes: '',
    })
  }

  function startEdit(a: Account) {
    save.reset()
    setDraft({
      id: a.id,
      name: a.name,
      institution: a.institution ?? '',
      account_type: a.account_type,
      currency: a.currency,
      balance: String(a.balance),
      last_digits: a.last_digits ?? '',
      color: a.color ?? COLORS[0],
      include_in_total: a.include_in_total,
      is_archived: a.is_archived,
      notes: a.notes ?? '',
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    save.mutate(
      {
        id: draft.id,
        name: draft.name.trim(),
        institution: draft.institution.trim() || null,
        account_type: draft.account_type,
        currency: draft.currency,
        balance: Number(draft.balance || 0),
        last_digits: draft.last_digits.replace(/\D/g, '') || null,
        color: draft.color,
        include_in_total: draft.include_in_total,
        notes: draft.notes.trim() || null,
        ...(draft.id ? { is_archived: draft.is_archived } : {}),
      },
      { onSuccess: () => setDraft(null) },
    )
  }

  if (accounts.isLoading) return <Spinner />
  const data = accounts.data
  const second = data?.secondary_currency ?? null

  return (
    <div className="animate-rise">
      <SectionHeader
        title="Accounts"
        subtitle="Each balance in its own currency, with its converted value beside it."
        actions={
          <Button variant="primary" onClick={startNew}>
            <PlusIcon size={15} />
            Add account
          </Button>
        }
      />

      <ErrorNote error={accounts.error ?? remove.error} />

      {data && data.accounts.length > 0 && (
        <section className="stagger mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="px-5 py-4 sm:col-span-2 lg:col-span-1">
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Net worth
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {signedMoney(data.net_worth, data.base_currency)}
            </p>
            {second && data.net_worth_secondary !== null && (
              <p className="tabular text-sm text-ink-2">
                ≈ {signedMoney(data.net_worth_secondary, second)}
              </p>
            )}
          </Card>
          {data.by_currency.map((row) => (
            <Card key={row.currency} className="px-5 py-4">
              <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
                {row.currency} accounts · {row.account_count}
              </p>
              <p className="tabular mt-2 text-xl font-semibold">
                {signedMoney(row.total, row.currency)}
              </p>
              {row.currency !== data.base_currency && row.base_total !== null && (
                <p className="tabular text-sm text-ink-2">
                  ≈ {signedMoney(row.base_total, data.base_currency)}
                </p>
              )}
            </Card>
          ))}
        </section>
      )}

      {!data?.accounts.length ? (
        <EmptyState
          title="No accounts yet"
          hint="Add each bank account, card and cash wallet in its own currency. Put the last 4 digits in so forwarded SMS find the right account."
          action={
            <Button variant="primary" onClick={startNew}>
              <PlusIcon size={15} />
              Add your first account
            </Button>
          }
        />
      ) : (
        <ul className="stagger flex flex-col gap-2.5">
          {data.accounts.map((a) => (
            <li key={a.id}>
              <Card className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => startEdit(a)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left"
                >
                  <span
                    aria-hidden="true"
                    className="h-10 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color || 'var(--series-1)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{a.name}</span>
                      {a.is_liability && <LiabilityBadge />}
                      {!a.include_in_total && <InactiveBadge />}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[
                        a.institution,
                        titleCase(a.account_type),
                        a.last_digits && `··${a.last_digits.slice(-4)}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <DualAmount
                    amount={a.balance}
                    currency={a.currency}
                    base={a.base_balance}
                    baseCurrency={data.base_currency}
                    secondary={a.secondary_balance}
                    secondaryCurrency={second}
                    negative={a.is_liability}
                    size="lg"
                  />
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={draft !== null}
        title={draft?.id ? 'Edit account' : 'New account'}
        onClose={() => setDraft(null)}
      >
        {draft && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  required
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Savings"
                />
              </Field>
              <Field label="Bank">
                <Input
                  value={draft.institution}
                  onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
                  placeholder="Commercial Bank"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select
                  value={draft.account_type}
                  onChange={(e) => setDraft({ ...draft, account_type: e.target.value })}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency">
                <Select
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={
                  draft.account_type === 'credit_card' || draft.account_type === 'loan'
                    ? 'Amount owed'
                    : 'Current balance'
                }
                hint={draft.id ? 'Changing this re-syncs with your bank.' : undefined}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={draft.balance}
                  onChange={(e) => setDraft({ ...draft, balance: e.target.value })}
                />
              </Field>
              <Field
                label="Account number"
                hint="Full number, or at least the last 4 digits. Bank SMS show it masked (09802XXXXX06) — that's how they find this account."
              >
                <Input
                  inputMode="numeric"
                  maxLength={32}
                  value={draft.last_digits}
                  onChange={(e) => setDraft({ ...draft, last_digits: e.target.value })}
                  placeholder="098022…2106"
                />
              </Field>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-2">
                Colour
              </span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className="size-8 rounded-full ring-offset-2 ring-offset-transparent"
                    style={{
                      backgroundColor: c,
                      boxShadow:
                        draft.color === c
                          ? `0 0 0 2px var(--surface, #fff), 0 0 0 4px ${c}`
                          : undefined,
                    }}
                  />
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.include_in_total}
                onChange={(e) => setDraft({ ...draft, include_in_total: e.target.checked })}
              />
              Include in net worth
            </label>
            {draft.id && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.is_archived}
                  onChange={(e) => setDraft({ ...draft, is_archived: e.target.checked })}
                />
                Archived (hidden, history kept)
              </label>
            )}

            <ErrorNote error={save.error} />

            <div className="flex items-center justify-between gap-2">
              <div>
                {draft.id && (
                  <ConfirmButton
                    onConfirm={() => remove.mutate(draft.id!, { onSuccess: () => setDraft(null) })}
                    message={`Delete "${draft.name}"? Its transactions stay in your history.`}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={save.isPending}>
                  {draft.id ? 'Save' : 'Add account'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
