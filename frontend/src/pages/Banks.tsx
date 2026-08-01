import { useState } from 'react'
import type { FormEvent } from 'react'

import {
  Badge,
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
  Textarea,
} from '@/components/ui'
import { money, seriesColor, titleCase } from '@/lib/format'
import {
  useBanks,
  useConfig,
  useCreateAccount,
  useCreateBank,
  useDeleteAccount,
  useDeleteBank,
  useUpdateAccount,
  useUpdateBank,
} from '@/lib/queries'
import type { Account, Bank } from '@/types'

type BankDraft = { id?: number; name: string; short_name: string; country: string; notes: string }
type AccountDraft = {
  id?: number
  bank_id: number
  name: string
  account_type: string
  currency: string
  balance: string
  account_number: string
  notes: string
  is_active: boolean
  is_liability: boolean
}

const EMPTY_BANK: BankDraft = { name: '', short_name: '', country: '', notes: '' }

function emptyAccount(bankId: number, currency: string): AccountDraft {
  return {
    bank_id: bankId,
    name: '',
    account_type: 'savings',
    currency,
    balance: '0',
    account_number: '',
    notes: '',
    is_active: true,
    is_liability: false,
  }
}

export default function Banks() {
  const config = useConfig()
  const banks = useBanks()

  const createBank = useCreateBank()
  const updateBank = useUpdateBank()
  const deleteBank = useDeleteBank()
  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()

  const [bankDraft, setBankDraft] = useState<BankDraft | null>(null)
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null)

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const accountTypes = config.data?.account_types ?? ['savings']

  const mutationError =
    createBank.error ??
    updateBank.error ??
    deleteBank.error ??
    createAccount.error ??
    updateAccount.error ??
    deleteAccount.error

  function submitBank(event: FormEvent) {
    event.preventDefault()
    if (!bankDraft) return
    const body = {
      name: bankDraft.name.trim(),
      short_name: bankDraft.short_name.trim() || null,
      country: bankDraft.country.trim() || null,
      notes: bankDraft.notes.trim() || null,
    }
    const done = { onSuccess: () => setBankDraft(null) }
    if (bankDraft.id) updateBank.mutate({ id: bankDraft.id, ...body }, done)
    else createBank.mutate(body, done)
  }

  function submitAccount(event: FormEvent) {
    event.preventDefault()
    if (!accountDraft) return
    const body = {
      bank_id: accountDraft.bank_id,
      name: accountDraft.name.trim(),
      account_type: accountDraft.account_type,
      currency: accountDraft.currency,
      balance: Number(accountDraft.balance || 0),
      account_number: accountDraft.account_number.trim() || null,
      notes: accountDraft.notes.trim() || null,
      is_active: accountDraft.is_active,
      is_liability: accountDraft.is_liability,
    }
    const done = { onSuccess: () => setAccountDraft(null) }
    if (accountDraft.id) updateAccount.mutate({ id: accountDraft.id, ...body }, done)
    else createAccount.mutate(body, done)
  }

  function editAccount(account: Account): AccountDraft {
    return {
      id: account.id,
      bank_id: account.bank_id,
      name: account.name,
      account_type: account.account_type,
      currency: account.currency,
      balance: String(account.balance),
      account_number: account.account_number ?? '',
      notes: account.notes ?? '',
      is_active: account.is_active,
      is_liability: account.is_liability,
    }
  }

  if (banks.isLoading) return <Spinner />

  return (
    <div>
      <SectionHeader
        title="Banks & accounts"
        subtitle={`Balances are converted to ${base} using the current rates.`}
        actions={
          <Button variant="primary" onClick={() => setBankDraft({ ...EMPTY_BANK })}>
            + Add bank
          </Button>
        }
      />

      <ErrorNote error={banks.error ?? mutationError} />

      {banks.data && banks.data.length === 0 ? (
        <EmptyState
          title="No banks yet"
          hint="Add a bank, then add the accounts you hold there. Each account has its own currency and is converted for you."
          action={
            <Button variant="primary" onClick={() => setBankDraft({ ...EMPTY_BANK })}>
              + Add your first bank
            </Button>
          }
        />
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {banks.data?.map((bank, index) => (
            <BankCard
              key={bank.id}
              bank={bank}
              accent={bank.color || seriesColor(index)}
              base={base}
              onEdit={() =>
                setBankDraft({
                  id: bank.id,
                  name: bank.name,
                  short_name: bank.short_name ?? '',
                  country: bank.country ?? '',
                  notes: bank.notes ?? '',
                })
              }
              onDelete={() => deleteBank.mutate(bank.id)}
              onAddAccount={() => setAccountDraft(emptyAccount(bank.id, base))}
              onEditAccount={(account) => setAccountDraft(editAccount(account))}
              onDeleteAccount={(account) => deleteAccount.mutate(account.id)}
            />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- bank modal */}
      <Modal
        open={bankDraft !== null}
        title={bankDraft?.id ? 'Edit bank' : 'Add bank'}
        onClose={() => setBankDraft(null)}
      >
        {bankDraft && (
          <form id="bank-form" onSubmit={submitBank} className="flex flex-col gap-4">
            <Field label="Bank name">
              <Input
                required
                autoFocus
                value={bankDraft.name}
                onChange={(e) => setBankDraft({ ...bankDraft, name: e.target.value })}
                placeholder="Commercial Bank of Ceylon"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Short name">
                <Input
                  value={bankDraft.short_name}
                  onChange={(e) => setBankDraft({ ...bankDraft, short_name: e.target.value })}
                  placeholder="ComBank"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={bankDraft.country}
                  onChange={(e) => setBankDraft({ ...bankDraft, country: e.target.value })}
                  placeholder="Sri Lanka"
                />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea
                value={bankDraft.notes}
                onChange={(e) => setBankDraft({ ...bankDraft, notes: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setBankDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {bankDraft.id ? 'Save changes' : 'Add bank'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------------------------------------------------- account modal */}
      <Modal
        open={accountDraft !== null}
        title={accountDraft?.id ? 'Edit account' : 'Add account'}
        onClose={() => setAccountDraft(null)}
      >
        {accountDraft && (
          <form onSubmit={submitAccount} className="flex flex-col gap-4">
            <Field label="Account name">
              <Input
                required
                autoFocus
                value={accountDraft.name}
                onChange={(e) => setAccountDraft({ ...accountDraft, name: e.target.value })}
                placeholder="Salary savings"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank">
                <Select
                  value={accountDraft.bank_id}
                  onChange={(e) =>
                    setAccountDraft({ ...accountDraft, bank_id: Number(e.target.value) })
                  }
                >
                  {banks.data?.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  value={accountDraft.account_type}
                  onChange={(e) =>
                    setAccountDraft({ ...accountDraft, account_type: e.target.value })
                  }
                >
                  {accountTypes.map((type) => (
                    <option key={type} value={type}>
                      {titleCase(type)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency">
                <Select
                  value={accountDraft.currency}
                  onChange={(e) => setAccountDraft({ ...accountDraft, currency: e.target.value })}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Balance">
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={accountDraft.balance}
                  onChange={(e) => setAccountDraft({ ...accountDraft, balance: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Account number" hint="Optional — store only what you're comfortable with.">
              <Input
                value={accountDraft.account_number}
                onChange={(e) =>
                  setAccountDraft({ ...accountDraft, account_number: e.target.value })
                }
              />
            </Field>

            <Field label="Notes">
              <Textarea
                value={accountDraft.notes}
                onChange={(e) => setAccountDraft({ ...accountDraft, notes: e.target.value })}
              />
            </Field>

            <div className="glass-inset flex flex-col gap-3 rounded-xl px-4 py-3 text-sm">
              <label className="flex items-center gap-2.5">
                <Checkbox
                  checked={accountDraft.is_liability}
                  onChange={(e) =>
                    setAccountDraft({ ...accountDraft, is_liability: e.target.checked })
                  }
                />
                This account holds debt (credit card, loan) — counts against net worth
              </label>
              <label className="flex items-center gap-2.5">
                <Checkbox
                  checked={accountDraft.is_active}
                  onChange={(e) => setAccountDraft({ ...accountDraft, is_active: e.target.checked })}
                />
                Active
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setAccountDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {accountDraft.id ? 'Save changes' : 'Add account'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

function BankCard({
  bank,
  accent,
  base,
  onEdit,
  onDelete,
  onAddAccount,
  onEditAccount,
  onDeleteAccount,
}: {
  bank: Bank
  accent: string
  base: string
  onEdit: () => void
  onDelete: () => void
  onAddAccount: () => void
  onEditAccount: (account: Account) => void
  onDeleteAccount: (account: Account) => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="h-8 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{bank.name}</h2>
            <p className="text-xs text-muted">
              {[bank.short_name, bank.country].filter(Boolean).join(' · ') || 'No details'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-muted">Total in {base}</p>
            <p className="tabular text-lg font-semibold">{money(bank.total_converted, base)}</p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <ConfirmButton
              onConfirm={onDelete}
              message={`Delete ${bank.name} and all ${bank.accounts.length} of its accounts? This cannot be undone.`}
            />
          </div>
        </div>
      </div>

      {bank.accounts.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-muted">No accounts in this bank yet.</p>
          <Button size="sm" className="mt-3" onClick={onAddAccount}>
            + Add account
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-5 py-2 text-left font-medium">Account</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 text-right font-medium">In {base}</th>
                  <th className="px-5 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {bank.accounts.map((account) => (
                  <tr key={account.id} className={account.is_active ? '' : 'opacity-55'}>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{account.name}</span>
                        {account.is_liability && (
                          <Badge tone="critical" icon="▾">
                            liability
                          </Badge>
                        )}
                        {!account.is_active && <Badge icon="◌">inactive</Badge>}
                      </div>
                      {account.account_number && (
                        <span className="text-xs text-muted">{account.account_number}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">{titleCase(account.account_type)}</td>
                    <td className="tabular px-3 py-2.5 text-right">
                      {money(account.balance, account.currency)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">
                      {account.rate_available ? (
                        money(account.converted_balance, base)
                      ) : (
                        <Badge tone="warning" icon="⚠">
                          no rate
                        </Badge>
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onEditAccount(account)}>
                          Edit
                        </Button>
                        <ConfirmButton
                          onConfirm={() => onDeleteAccount(account)}
                          message={`Delete account "${account.name}"?`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-hairline px-5 py-3">
            <Button size="sm" onClick={onAddAccount}>
              + Add account
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
