import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { IncomeStatusBadge, NoRateBadge } from '@/components/badges'
import { CheckIcon, PlusIcon } from '@/components/icons'
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
  Textarea,
  cx,
} from '@/components/ui'
import { money, seriesColor, shortDate, titleCase, today } from '@/lib/format'
import {
  useAccounts,
  useBulkIncomeStatus,
  useConfig,
  useCreateIncome,
  useCreateIncomeSource,
  useDeleteIncome,
  useDeleteIncomeSource,
  useIncomeSources,
  useUngroupedIncomes,
  useUpdateIncome,
  useUpdateIncomeSource,
} from '@/lib/queries'
import type { Income, IncomeSource } from '@/types'

type SourceDraft = { id?: number; name: string; description: string }
type IncomeDraft = {
  id?: number
  source_id: number | null
  name: string
  amount: string
  currency: string
  status: string
  expected_date: string
  recurrence: string
  account_id: number | null
  payer: string
  notes: string
}

const STATUS_FILTERS = ['all', 'expected', 'received', 'cancelled'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function IncomePage() {
  const config = useConfig()
  const sources = useIncomeSources()
  const ungrouped = useUngroupedIncomes()
  const accounts = useAccounts()

  const createSource = useCreateIncomeSource()
  const updateSource = useUpdateIncomeSource()
  const deleteSource = useDeleteIncomeSource()
  const createIncome = useCreateIncome()
  const updateIncome = useUpdateIncome()
  const deleteIncome = useDeleteIncome()
  const bulkStatus = useBulkIncomeStatus()

  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null)
  const [incomeDraft, setIncomeDraft] = useState<IncomeDraft | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const recurrences = config.data?.recurrences ?? ['none']
  const statuses = config.data?.income_statuses ?? ['expected', 'received', 'cancelled']

  const error =
    sources.error ??
    ungrouped.error ??
    createSource.error ??
    updateSource.error ??
    deleteSource.error ??
    createIncome.error ??
    updateIncome.error ??
    deleteIncome.error ??
    bulkStatus.error

  const ungroupedSource = useMemo<IncomeSource | null>(() => {
    const items = ungrouped.data ?? []
    if (!items.length) return null
    const live = items.filter((item) => item.status !== 'cancelled')
    const received = live.filter((item) => item.status === 'received')
    const sum = (list: Income[]) =>
      list.reduce((total, item) => total + (item.converted_amount ?? 0), 0)
    return {
      id: -1,
      name: 'Unassigned',
      description: 'Income not linked to a source',
      color: null,
      sort_order: 9999,
      is_archived: false,
      incomes: items,
      converted_currency: base,
      total_converted: sum(live),
      received_converted: sum(received),
      expected_converted: sum(live) - sum(received),
      income_count: live.length,
      received_count: received.length,
    }
  }, [ungrouped.data, base])

  function toggleSelected(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyBulk(status: string) {
    bulkStatus.mutate({ ids: [...selected], status }, { onSuccess: () => setSelected(new Set()) })
  }

  function submitSource(event: FormEvent) {
    event.preventDefault()
    if (!sourceDraft) return
    const body = {
      name: sourceDraft.name.trim(),
      description: sourceDraft.description.trim() || null,
    }
    const done = { onSuccess: () => setSourceDraft(null) }
    if (sourceDraft.id) updateSource.mutate({ id: sourceDraft.id, ...body }, done)
    else createSource.mutate(body, done)
  }

  function submitIncome(event: FormEvent) {
    event.preventDefault()
    if (!incomeDraft) return
    const body = {
      source_id: incomeDraft.source_id,
      name: incomeDraft.name.trim(),
      amount: Number(incomeDraft.amount || 0),
      currency: incomeDraft.currency,
      status: incomeDraft.status,
      expected_date: incomeDraft.expected_date || null,
      recurrence: incomeDraft.recurrence,
      account_id: incomeDraft.account_id,
      payer: incomeDraft.payer.trim() || null,
      notes: incomeDraft.notes.trim() || null,
    }
    const done = { onSuccess: () => setIncomeDraft(null) }
    if (incomeDraft.id) updateIncome.mutate({ id: incomeDraft.id, ...body }, done)
    else createIncome.mutate(body, done)
  }

  function newIncome(sourceId: number | null): IncomeDraft {
    return {
      source_id: sourceId,
      name: '',
      amount: '',
      currency: base,
      status: 'expected',
      expected_date: today(),
      recurrence: 'none',
      account_id: null,
      payer: '',
      notes: '',
    }
  }

  function editIncome(income: Income): IncomeDraft {
    return {
      id: income.id,
      source_id: income.source_id,
      name: income.name,
      amount: String(income.amount),
      currency: income.currency,
      status: income.status,
      expected_date: income.expected_date ?? '',
      recurrence: income.recurrence,
      account_id: income.account_id,
      payer: income.payer ?? '',
      notes: income.notes ?? '',
    }
  }

  if (sources.isLoading) return <Spinner />

  const allSources = [...(sources.data ?? []), ...(ungroupedSource ? [ungroupedSource] : [])]

  return (
    <div className="pb-20">
      <SectionHeader
        title="Income"
        subtitle={`Salary, freelance, dividends — recorded and converted to ${base}.`}
        actions={
          <>
            <Button onClick={() => setSourceDraft({ name: '', description: '' })}>
              <PlusIcon size={15} />
              New source
            </Button>
            <Button variant="primary" onClick={() => setIncomeDraft(newIncome(null))}>
              <PlusIcon size={15} />
              Add income
            </Button>
          </>
        }
      />

      <ErrorNote error={error} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Show</span>
        {STATUS_FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'primary' : 'secondary'}
            onClick={() => setFilter(value)}
          >
            {titleCase(value)}
          </Button>
        ))}
      </div>

      {allSources.length === 0 ? (
        <EmptyState
          title="No income recorded yet"
          hint="Add a source such as “Salary” or a freelance client, then record what you expect and what has landed."
          action={
            <Button variant="primary" onClick={() => setSourceDraft({ name: '', description: '' })}>
              <PlusIcon size={15} />
              Create your first source
            </Button>
          }
        />
      ) : (
        <div className="stagger flex flex-col gap-4">
          {allSources.map((source, index) => (
            <SourceCard
              key={source.id}
              source={source}
              accent={source.color || seriesColor(index)}
              base={base}
              filter={filter}
              selected={selected}
              onToggleSelect={toggleSelected}
              onAddIncome={() => setIncomeDraft(newIncome(source.id > 0 ? source.id : null))}
              onEditSource={
                source.id > 0
                  ? () =>
                      setSourceDraft({
                        id: source.id,
                        name: source.name,
                        description: source.description ?? '',
                      })
                  : undefined
              }
              onDeleteSource={source.id > 0 ? () => deleteSource.mutate(source.id) : undefined}
              onEditIncome={(income) => setIncomeDraft(editIncome(income))}
              onDeleteIncome={(income) => deleteIncome.mutate(income.id)}
              onToggleReceived={(income) =>
                updateIncome.mutate({
                  id: income.id,
                  status: income.status === 'received' ? 'expected' : 'received',
                })
              }
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="glass-chrome fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 shadow-[0_-8px_32px_rgb(0_0_0/0.12)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-2">{selected.size} selected</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button size="sm" onClick={() => applyBulk('expected')}>
                Mark expected
              </Button>
              <Button size="sm" variant="primary" onClick={() => applyBulk('received')}>
                Mark received
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- source modal */}
      <Modal
        open={sourceDraft !== null}
        title={sourceDraft?.id ? 'Edit source' : 'New income source'}
        onClose={() => setSourceDraft(null)}
      >
        {sourceDraft && (
          <form onSubmit={submitSource} className="flex flex-col gap-4">
            <Field label="Source name">
              <Input
                required
                autoFocus
                value={sourceDraft.name}
                onChange={(e) => setSourceDraft({ ...sourceDraft, name: e.target.value })}
                placeholder="Salary"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={sourceDraft.description}
                onChange={(e) => setSourceDraft({ ...sourceDraft, description: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setSourceDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {sourceDraft.id ? 'Save changes' : 'Create source'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ----------------------------------------------------- income modal */}
      <Modal
        open={incomeDraft !== null}
        title={incomeDraft?.id ? 'Edit income' : 'Add income'}
        onClose={() => setIncomeDraft(null)}
      >
        {incomeDraft && (
          <form onSubmit={submitIncome} className="flex flex-col gap-4">
            <Field label="What is it?">
              <Input
                required
                autoFocus
                value={incomeDraft.name}
                onChange={(e) => setIncomeDraft({ ...incomeDraft, name: e.target.value })}
                placeholder="July salary"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Amount" className="sm:col-span-2">
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={incomeDraft.amount}
                  onChange={(e) => setIncomeDraft({ ...incomeDraft, amount: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={incomeDraft.currency}
                  onChange={(e) => setIncomeDraft({ ...incomeDraft, currency: e.target.value })}
                >
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source">
                <Select
                  value={incomeDraft.source_id ?? ''}
                  onChange={(e) =>
                    setIncomeDraft({
                      ...incomeDraft,
                      source_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {sources.data?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={incomeDraft.status}
                  onChange={(e) => setIncomeDraft({ ...incomeDraft, status: e.target.value })}
                >
                  {statuses.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expected on">
                <Input
                  type="date"
                  value={incomeDraft.expected_date}
                  onChange={(e) =>
                    setIncomeDraft({ ...incomeDraft, expected_date: e.target.value })
                  }
                />
              </Field>
              <Field label="Repeats">
                <Select
                  value={incomeDraft.recurrence}
                  onChange={(e) => setIncomeDraft({ ...incomeDraft, recurrence: e.target.value })}
                >
                  {recurrences.map((value) => (
                    <option key={value} value={value}>
                      {titleCase(value)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paid into">
                <Select
                  value={incomeDraft.account_id ?? ''}
                  onChange={(e) =>
                    setIncomeDraft({
                      ...incomeDraft,
                      account_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Not set</option>
                  {accounts.data?.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From">
                <Input
                  value={incomeDraft.payer}
                  onChange={(e) => setIncomeDraft({ ...incomeDraft, payer: e.target.value })}
                  placeholder="Employer or client"
                />
              </Field>
            </div>

            <Field label="Notes">
              <Textarea
                value={incomeDraft.notes}
                onChange={(e) => setIncomeDraft({ ...incomeDraft, notes: e.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setIncomeDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {incomeDraft.id ? 'Save changes' : 'Add income'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

function SourceCard({
  source,
  accent,
  base,
  filter,
  selected,
  onToggleSelect,
  onAddIncome,
  onEditSource,
  onDeleteSource,
  onEditIncome,
  onDeleteIncome,
  onToggleReceived,
}: {
  source: IncomeSource
  accent: string
  base: string
  filter: StatusFilter
  selected: Set<number>
  onToggleSelect: (id: number) => void
  onAddIncome: () => void
  onEditSource?: () => void
  onDeleteSource?: () => void
  onEditIncome: (income: Income) => void
  onDeleteIncome: (income: Income) => void
  onToggleReceived: (income: Income) => void
}) {
  const visible = source.incomes.filter((income) => filter === 'all' || income.status === filter)
  const progress =
    source.total_converted > 0 ? (source.received_converted / source.total_converted) * 100 : 0

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="h-8 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{source.name}</h2>
            <p className="text-xs text-muted">
              {source.received_count} of {source.income_count} received
              {source.description ? ` · ${source.description}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="tabular text-lg font-semibold text-good-text">
              {money(source.received_converted, base)}
            </p>
            <p className="text-xs text-muted">received of {money(source.total_converted, base)}</p>
          </div>
          <div className="flex gap-1">
            {onEditSource && (
              <Button size="sm" variant="ghost" onClick={onEditSource}>
                Edit
              </Button>
            )}
            {onDeleteSource && (
              <ConfirmButton
                onConfirm={onDeleteSource}
                message={`Delete source "${source.name}" and its ${source.incomes.length} entries?`}
              />
            )}
          </div>
        </div>
      </div>

      <div className="h-1 w-full bg-grid">
        <div
          className="spring h-full rounded-r-full bg-series-3"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted">
          {source.incomes.length === 0 ? 'Nothing recorded yet.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-10 px-5 py-2" />
                <th className="px-3 py-2 text-left font-medium">Income</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">In {base}</th>
                <th className="px-3 py-2 text-left font-medium">Expected</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visible.map((income) => {
                const received = income.status === 'received'
                const cancelled = income.status === 'cancelled'
                return (
                  <tr key={income.id} className={cancelled ? 'opacity-55' : ''}>
                    <td className="px-5 py-2.5">
                      <Checkbox
                        aria-label={`Select ${income.name}`}
                        checked={selected.has(income.id)}
                        onChange={() => onToggleSelect(income.id)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => onToggleReceived(income)}
                        title={received ? 'Mark as not yet received' : 'Mark as received'}
                        className="group/row flex items-center gap-2.5 text-left"
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            'spring grid size-[18px] shrink-0 place-items-center rounded-md border',
                            received
                              ? 'border-good bg-good/15 text-good-text'
                              : 'border-line text-transparent group-hover/row:text-muted',
                          )}
                        >
                          <CheckIcon size={12} strokeWidth={2.75} />
                        </span>
                        <span className={cx('font-medium', received && 'text-muted line-through')}>
                          {income.name}
                        </span>
                      </button>
                      {income.payer && (
                        <span className="ml-6 text-xs text-muted">{income.payer}</span>
                      )}
                    </td>
                    <td className={cx('tabular px-3 py-2.5 text-right', received && 'line-through')}>
                      {money(income.amount, income.currency)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">
                      {income.rate_available ? money(income.converted_amount, base) : <NoRateBadge />}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">
                      {shortDate(income.expected_date)}
                      {income.recurrence !== 'none' && (
                        <span className="ml-1 text-xs text-muted">
                          ({titleCase(income.recurrence)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <IncomeStatusBadge
                        status={income.status}
                        receivedDate={income.received_date}
                        isLate={income.is_late}
                      />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onEditIncome(income)}>
                          Edit
                        </Button>
                        <ConfirmButton
                          onConfirm={() => onDeleteIncome(income)}
                          message={`Delete "${income.name}"?`}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-hairline px-5 py-3">
        <Button size="sm" onClick={onAddIncome}>
          <PlusIcon size={14} />
          Add income
        </Button>
      </div>
    </Card>
  )
}
