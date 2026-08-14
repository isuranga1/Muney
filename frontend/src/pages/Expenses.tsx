import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { ExpenseStatusBadge, NoRateBadge } from '@/components/badges'
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
  useBulkExpenseStatus,
  useConfig,
  useCreateExpense,
  useCreateExpenseGroup,
  useDeleteExpense,
  useDeleteExpenseGroup,
  useExpenseGroups,
  useUngroupedExpenses,
  useUpdateExpense,
  useUpdateExpenseGroup,
} from '@/lib/queries'
import type { Expense, ExpenseGroup } from '@/types'

type GroupDraft = { id?: number; name: string; description: string }
type ExpenseDraft = {
  id?: number
  group_id: number | null
  name: string
  amount: string
  currency: string
  status: string
  due_date: string
  recurrence: string
  account_id: number | null
  vendor: string
  notes: string
}

const STATUS_FILTERS = ['all', 'pending', 'paid', 'cancelled'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function Expenses() {
  const config = useConfig()
  const groups = useExpenseGroups()
  const ungrouped = useUngroupedExpenses()
  const accounts = useAccounts()

  const createGroup = useCreateExpenseGroup()
  const updateGroup = useUpdateExpenseGroup()
  const deleteGroup = useDeleteExpenseGroup()
  const createExpense = useCreateExpense()
  const updateExpense = useUpdateExpense()
  const deleteExpense = useDeleteExpense()
  const bulkStatus = useBulkExpenseStatus()

  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null)
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const recurrences = config.data?.recurrences ?? ['none']
  const statuses = config.data?.expense_statuses ?? ['pending', 'paid', 'cancelled']

  const error =
    groups.error ??
    ungrouped.error ??
    createGroup.error ??
    updateGroup.error ??
    deleteGroup.error ??
    createExpense.error ??
    updateExpense.error ??
    deleteExpense.error ??
    bulkStatus.error

  const ungroupedGroup = useMemo<ExpenseGroup | null>(() => {
    const items = ungrouped.data ?? []
    if (!items.length) return null
    const live = items.filter((item) => item.status !== 'cancelled')
    const paid = live.filter((item) => item.status === 'paid')
    const sum = (list: Expense[]) =>
      list.reduce((total, item) => total + (item.converted_amount ?? 0), 0)
    return {
      id: -1,
      name: 'Ungrouped',
      description: 'Expenses that are not in any group',
      color: null,
      sort_order: 9999,
      is_archived: false,
      expenses: items,
      converted_currency: base,
      total_converted: sum(live),
      paid_converted: sum(paid),
      outstanding_converted: sum(live) - sum(paid),
      expense_count: live.length,
      paid_count: paid.length,
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
    bulkStatus.mutate(
      { ids: [...selected], status },
      { onSuccess: () => setSelected(new Set()) },
    )
  }

  function submitGroup(event: FormEvent) {
    event.preventDefault()
    if (!groupDraft) return
    const body = {
      name: groupDraft.name.trim(),
      description: groupDraft.description.trim() || null,
    }
    const done = { onSuccess: () => setGroupDraft(null) }
    if (groupDraft.id) updateGroup.mutate({ id: groupDraft.id, ...body }, done)
    else createGroup.mutate(body, done)
  }

  function submitExpense(event: FormEvent) {
    event.preventDefault()
    if (!expenseDraft) return
    const body = {
      group_id: expenseDraft.group_id,
      name: expenseDraft.name.trim(),
      amount: Number(expenseDraft.amount || 0),
      currency: expenseDraft.currency,
      status: expenseDraft.status,
      due_date: expenseDraft.due_date || null,
      recurrence: expenseDraft.recurrence,
      account_id: expenseDraft.account_id,
      vendor: expenseDraft.vendor.trim() || null,
      notes: expenseDraft.notes.trim() || null,
    }
    const done = { onSuccess: () => setExpenseDraft(null) }
    if (expenseDraft.id) updateExpense.mutate({ id: expenseDraft.id, ...body }, done)
    else createExpense.mutate(body, done)
  }

  function newExpense(groupId: number | null): ExpenseDraft {
    return {
      group_id: groupId,
      name: '',
      amount: '',
      currency: base,
      status: 'pending',
      due_date: today(),
      recurrence: 'none',
      account_id: null,
      vendor: '',
      notes: '',
    }
  }

  function editExpense(expense: Expense): ExpenseDraft {
    return {
      id: expense.id,
      group_id: expense.group_id,
      name: expense.name,
      amount: String(expense.amount),
      currency: expense.currency,
      status: expense.status,
      due_date: expense.due_date ?? '',
      recurrence: expense.recurrence,
      account_id: expense.account_id,
      vendor: expense.vendor ?? '',
      notes: expense.notes ?? '',
    }
  }

  if (groups.isLoading) return <Spinner />

  const allGroups = [...(groups.data ?? []), ...(ungroupedGroup ? [ungroupedGroup] : [])]

  return (
    <div className="pb-20">
      <SectionHeader
        title="Expenses"
        subtitle={`Group them, tick off what's paid. Totals are shown in ${base}.`}
        actions={
          <>
            <Button onClick={() => setGroupDraft({ name: '', description: '' })}>
              <PlusIcon size={15} />
              New group
            </Button>
            <Button variant="primary" onClick={() => setExpenseDraft(newExpense(null))}>
              <PlusIcon size={15} />
              Add expense
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

      {allGroups.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          hint="Create a group like “Monthly bills” or “Trip to Japan”, then add the expenses that belong to it."
          action={
            <Button variant="primary" onClick={() => setGroupDraft({ name: '', description: '' })}>
              <PlusIcon size={15} />
              Create your first group
            </Button>
          }
        />
      ) : (
        <div className="stagger flex flex-col gap-4">
          {allGroups.map((group, index) => (
            <GroupCard
              key={group.id}
              group={group}
              accent={group.color || seriesColor(index)}
              base={base}
              filter={filter}
              selected={selected}
              onToggleSelect={toggleSelected}
              onAddExpense={() => setExpenseDraft(newExpense(group.id > 0 ? group.id : null))}
              onEditGroup={
                group.id > 0
                  ? () =>
                      setGroupDraft({
                        id: group.id,
                        name: group.name,
                        description: group.description ?? '',
                      })
                  : undefined
              }
              onDeleteGroup={group.id > 0 ? () => deleteGroup.mutate(group.id) : undefined}
              onEditExpense={(expense) => setExpenseDraft(editExpense(expense))}
              onDeleteExpense={(expense) => deleteExpense.mutate(expense.id)}
              onTogglePaid={(expense) =>
                updateExpense.mutate({
                  id: expense.id,
                  status: expense.status === 'paid' ? 'pending' : 'paid',
                })
              }
            />
          ))}
        </div>
      )}

      {/* Bulk action bar. Sits above the phone tab bar; on desktop there is no
          tab bar, so it drops back to the bottom edge. */}
      {selected.size > 0 && (
        <div className="glass-chrome fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t px-4 py-3 shadow-[0_-8px_32px_rgb(0_0_0/0.12)] lg:bottom-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-2">{selected.size} selected</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
              <Button size="sm" onClick={() => applyBulk('pending')}>
                Mark unpaid
              </Button>
              <Button size="sm" variant="primary" onClick={() => applyBulk('paid')}>
                Mark paid
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------ group modal */}
      <Modal
        open={groupDraft !== null}
        title={groupDraft?.id ? 'Edit group' : 'New expense group'}
        onClose={() => setGroupDraft(null)}
      >
        {groupDraft && (
          <form onSubmit={submitGroup} className="flex flex-col gap-4">
            <Field label="Group name">
              <Input
                required
                autoFocus
                value={groupDraft.name}
                onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                placeholder="Monthly bills"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={groupDraft.description}
                onChange={(e) => setGroupDraft({ ...groupDraft, description: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setGroupDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {groupDraft.id ? 'Save changes' : 'Create group'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------------------------------------------------- expense modal */}
      <Modal
        open={expenseDraft !== null}
        title={expenseDraft?.id ? 'Edit expense' : 'Add expense'}
        onClose={() => setExpenseDraft(null)}
      >
        {expenseDraft && (
          <form onSubmit={submitExpense} className="flex flex-col gap-4">
            <Field label="What is it?">
              <Input
                required
                autoFocus
                value={expenseDraft.name}
                onChange={(e) => setExpenseDraft({ ...expenseDraft, name: e.target.value })}
                placeholder="Electricity bill"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Amount" className="sm:col-span-2">
                <Input
                  type="number"
                  step="0.01"
                  required
                  value={expenseDraft.amount}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, amount: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={expenseDraft.currency}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, currency: e.target.value })}
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
              <Field label="Group">
                <Select
                  value={expenseDraft.group_id ?? ''}
                  onChange={(e) =>
                    setExpenseDraft({
                      ...expenseDraft,
                      group_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">Ungrouped</option>
                  {groups.data?.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={expenseDraft.status}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, status: e.target.value })}
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
              <Field label="Due date">
                <Input
                  type="date"
                  value={expenseDraft.due_date}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, due_date: e.target.value })}
                />
              </Field>
              <Field label="Repeats">
                <Select
                  value={expenseDraft.recurrence}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, recurrence: e.target.value })}
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
              <Field label="Paid from">
                <Select
                  value={expenseDraft.account_id ?? ''}
                  onChange={(e) =>
                    setExpenseDraft({
                      ...expenseDraft,
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
              <Field label="Vendor">
                <Input
                  value={expenseDraft.vendor}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, vendor: e.target.value })}
                  placeholder="CEB"
                />
              </Field>
            </div>

            <Field label="Notes">
              <Textarea
                value={expenseDraft.notes}
                onChange={(e) => setExpenseDraft({ ...expenseDraft, notes: e.target.value })}
              />
            </Field>

            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setExpenseDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {expenseDraft.id ? 'Save changes' : 'Add expense'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

function GroupCard({
  group,
  accent,
  base,
  filter,
  selected,
  onToggleSelect,
  onAddExpense,
  onEditGroup,
  onDeleteGroup,
  onEditExpense,
  onDeleteExpense,
  onTogglePaid,
}: {
  group: ExpenseGroup
  accent: string
  base: string
  filter: StatusFilter
  selected: Set<number>
  onToggleSelect: (id: number) => void
  onAddExpense: () => void
  onEditGroup?: () => void
  onDeleteGroup?: () => void
  onEditExpense: (expense: Expense) => void
  onDeleteExpense: (expense: Expense) => void
  onTogglePaid: (expense: Expense) => void
}) {
  const visible = group.expenses.filter(
    (expense) => filter === 'all' || expense.status === filter,
  )
  const progress =
    group.total_converted > 0 ? (group.paid_converted / group.total_converted) * 100 : 0

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
            <h2 className="truncate text-base font-semibold">{group.name}</h2>
            <p className="text-xs text-muted">
              {group.paid_count} of {group.expense_count} paid
              {group.description ? ` · ${group.description}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="tabular text-lg font-semibold">
              {money(group.outstanding_converted, base)}
            </p>
            <p className="text-xs text-muted">
              outstanding of {money(group.total_converted, base)}
            </p>
          </div>
          <div className="flex gap-1">
            {onEditGroup && (
              <Button size="sm" variant="ghost" onClick={onEditGroup}>
                Edit
              </Button>
            )}
            {onDeleteGroup && (
              <ConfirmButton
                onConfirm={onDeleteGroup}
                message={`Delete group "${group.name}" and its ${group.expenses.length} expenses?`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Paid share of the group, on the group's own scale. */}
      <div className="h-1 w-full bg-grid">
        <div
          className="spring h-full rounded-r-full bg-series-1"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {visible.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted">
          {group.expenses.length === 0 ? 'No expenses here yet.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <>
        {/* Phones get cards; the 720px table below is desktop only. */}
        <ul className="divide-y divide-hairline md:hidden">
          {visible.map((expense) => {
            const paid = expense.status === 'paid'
            return (
              <li
                key={expense.id}
                className={cx('px-4 py-3', expense.status === 'cancelled' && 'opacity-55')}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    className="mt-1"
                    aria-label={`Select ${expense.name}`}
                    checked={selected.has(expense.id)}
                    onChange={() => onToggleSelect(expense.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onTogglePaid(expense)}
                      className="text-left"
                    >
                      <span className={cx('font-medium', paid && 'text-muted line-through')}>
                        {expense.name}
                      </span>
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <ExpenseStatusBadge
                        status={expense.status}
                        paidDate={expense.paid_date}
                        isOverdue={expense.is_overdue}
                      />
                      <span>due {shortDate(expense.due_date)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cx('tabular font-semibold', paid && 'line-through')}>
                      {money(expense.amount, expense.currency)}
                    </p>
                    <p className="tabular text-xs text-muted">
                      {expense.rate_available ? money(expense.converted_amount, base) : '—'}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-2 pl-[30px]">
                  <Button size="sm" variant="secondary" onClick={() => onEditExpense(expense)}>
                    Edit
                  </Button>
                  <ConfirmButton
                    onConfirm={() => onDeleteExpense(expense)}
                    message={`Delete "${expense.name}"?`}
                  />
                </div>
              </li>
            )
          })}
        </ul>

        <div className="scroll-x hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-10 px-5 py-2" />
                <th className="px-3 py-2 text-left font-medium">Expense</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">In {base}</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {visible.map((expense) => {
                const paid = expense.status === 'paid'
                const cancelled = expense.status === 'cancelled'
                return (
                  <tr key={expense.id} className={cancelled ? 'opacity-55' : ''}>
                    <td className="px-5 py-2.5">
                      <Checkbox
                        aria-label={`Select ${expense.name}`}
                        checked={selected.has(expense.id)}
                        onChange={() => onToggleSelect(expense.id)}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => onTogglePaid(expense)}
                        title={paid ? 'Mark as unpaid' : 'Mark as paid'}
                        className="group/row flex items-center gap-2.5 text-left"
                      >
                        <span
                          aria-hidden="true"
                          className={cx(
                            'spring grid size-[18px] shrink-0 place-items-center rounded-md border',
                            paid
                              ? 'border-good bg-good/15 text-good-text'
                              : 'border-line text-transparent group-hover/row:text-muted',
                          )}
                        >
                          <CheckIcon size={12} strokeWidth={2.75} />
                        </span>
                        <span className={cx('font-medium', paid && 'text-muted line-through')}>
                          {expense.name}
                        </span>
                      </button>
                      {expense.vendor && (
                        <span className="ml-6 text-xs text-muted">{expense.vendor}</span>
                      )}
                    </td>
                    <td className={cx('tabular px-3 py-2.5 text-right', paid && 'line-through')}>
                      {money(expense.amount, expense.currency)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-2">
                      {expense.rate_available ? money(expense.converted_amount, base) : <NoRateBadge />}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">
                      {shortDate(expense.due_date)}
                      {expense.recurrence !== 'none' && (
                        <span className="ml-1 text-xs text-muted">
                          ({titleCase(expense.recurrence)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <ExpenseStatusBadge
                        status={expense.status}
                        paidDate={expense.paid_date}
                        isOverdue={expense.is_overdue}
                      />
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onEditExpense(expense)}>
                          Edit
                        </Button>
                        <ConfirmButton
                          onConfirm={() => onDeleteExpense(expense)}
                          message={`Delete "${expense.name}"?`}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <div className="border-t border-hairline px-5 py-3">
        <Button size="sm" onClick={onAddExpense}>
          <PlusIcon size={14} />
          Add expense
        </Button>
      </div>
    </Card>
  )
}
