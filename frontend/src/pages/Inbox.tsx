import { useState } from 'react'
import type { FormEvent } from 'react'

import { AccountSelect } from '@/components/finance'
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ClockIcon,
  RefreshIcon,
  SparklesIcon,
} from '@/components/icons'
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
import { localDate, relativeTime, titleCase } from '@/lib/format'
import {
  useAccounts,
  useCategories,
  useConfig,
  useDeleteMessage,
  useIgnoreMessage,
  useMessages,
  useRecordMessage,
  useReprocessMessages,
} from '@/lib/queries'
import type { SmsMessage, TransactionKind } from '@/types'

const FILTERS = ['needs review', 'processed', 'ignored', 'all'] as const
type Filter = (typeof FILTERS)[number]

const ICON = { size: 12, strokeWidth: 2.5 } as const

type Draft = {
  messageId: number
  body: string
  kind: TransactionKind
  amount: string
  currency: string
  merchant: string
  occurred_on: string
  account_id: number | null
  to_account_id: number | null
  category_id: number | null
}

function matches(message: SmsMessage, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'needs review') return ['pending', 'failed', 'queued'].includes(message.status)
  return message.status === filter
}

export default function Inbox() {
  const config = useConfig()
  const messages = useMessages()
  const accounts = useAccounts()
  const categories = useCategories()
  const record = useRecordMessage()
  const ignore = useIgnoreMessage()
  const remove = useDeleteMessage()
  const reprocess = useReprocessMessages()

  const [filter, setFilter] = useState<Filter>('needs review')
  const [draft, setDraft] = useState<Draft | null>(null)

  const base = config.data?.base_currency ?? 'LKR'
  const currencies = config.data?.supported_currencies ?? [base]
  const accountList = accounts.data?.accounts ?? []

  function start(message: SmsMessage) {
    record.reset()
    setDraft({
      messageId: message.id,
      body: message.body,
      kind: 'expense',
      amount: '',
      currency: base,
      merchant: '',
      occurred_on: localDate(message.received_at),
      account_id: null,
      to_account_id: null,
      category_id: null,
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    record.mutate(
      {
        id: draft.messageId,
        kind: draft.kind,
        amount: Number(draft.amount),
        currency: draft.currency,
        merchant: draft.merchant.trim() || null,
        occurred_on: draft.occurred_on || null,
        account_id: draft.account_id,
        to_account_id: draft.kind === 'transfer' ? draft.to_account_id : null,
        category_id: draft.kind === 'transfer' ? null : draft.category_id,
      },
      { onSuccess: () => setDraft(null) },
    )
  }

  if (messages.isLoading) return <Spinner />
  const all = messages.data ?? []
  const visible = all.filter((m) => matches(m, filter))

  return (
    <div className="animate-rise flex flex-col gap-4">
      <SectionHeader
        title="SMS inbox"
        subtitle="Bank messages forwarded from your iPhone. Ones that are read automatically become transactions; the rest wait here."
        actions={
          <Button onClick={() => reprocess.mutate(undefined)} disabled={reprocess.isPending}>
            <RefreshIcon
              size={15}
              className={reprocess.isPending ? 'animate-spin-slow' : undefined}
            />
            Re-run
          </Button>
        }
      />

      {config.data && !config.data.ingest_enabled && (
        <Card className="flex items-start gap-2.5 border-warning/45 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangleIcon size={16} className="mt-px shrink-0 text-warning" />
          <span>
            Forwarding is off. Set <code>INGEST_TOKEN</code> in the server's <code>.env</code>, then
            point your iPhone Shortcut at <code>/api/ingest/sms</code> (see DEPLOYMENT.md §9).
          </span>
        </Card>
      )}
      {config.data && config.data.llm_provider === 'none' && (
        <Card className="flex items-start gap-2.5 px-4 py-3 text-sm">
          <SparklesIcon size={16} className="mt-px shrink-0 text-series-1" />
          <span>
            AI reading is off, so only messages a regex parser knows are recorded automatically. Set{' '}
            <code>LLM_PROVIDER</code> to read any bank's format.
          </span>
        </Card>
      )}

      <ErrorNote error={messages.error ?? ignore.error ?? remove.error ?? reprocess.error} />
      {reprocess.data && (
        <p className="text-xs text-muted">
          Re-checked {reprocess.data.checked}, recorded {reprocess.data.processed}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'secondary'}
            onClick={() => setFilter(f)}
          >
            {titleCase(f.replace(' ', '_'))}
            <span className="tabular opacity-70">{all.filter((m) => matches(m, f)).length}</span>
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'needs review' ? 'All caught up' : 'No messages'}
          hint={
            all.length === 0
              ? 'Once your iPhone Shortcut forwards a bank SMS, it shows up here.'
              : 'Nothing matches this filter.'
          }
        />
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {visible.map((m) => (
            <li key={m.id}>
              <Card className="px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <StatusBadge message={m} />
                    <span className="font-medium text-ink-2">{m.sender || 'Unknown sender'}</span>
                    <span title={new Date(m.received_at).toLocaleString()}>
                      {relativeTime(m.received_at)}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {m.status !== 'processed' && m.status !== 'queued' && (
                      <Button size="sm" variant="primary" onClick={() => start(m)}>
                        Record
                      </Button>
                    )}
                    {(m.status === 'pending' || m.status === 'failed') && (
                      <Button size="sm" variant="ghost" onClick={() => ignore.mutate(m.id)}>
                        Ignore
                      </Button>
                    )}
                    <ConfirmButton
                      onConfirm={() => remove.mutate(m.id)}
                      message="Delete this message? A transaction it created is kept."
                    />
                  </div>
                </div>
                <p className="mt-2 text-sm break-words whitespace-pre-wrap">{m.body}</p>
                {m.error && (
                  <p
                    className={cx(
                      'mt-2 text-xs',
                      m.status === 'failed' ? 'text-critical' : 'text-ink-2',
                    )}
                  >
                    {m.error}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal open={draft !== null} title="Record transaction" onClose={() => setDraft(null)}>
        {draft && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="glass-inset rounded-xl px-3 py-2 text-xs whitespace-pre-wrap text-ink-2">
              {draft.body}
            </p>

            <div className="glass-inset grid grid-cols-3 gap-1 rounded-full p-1">
              {(['expense', 'income', 'transfer'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: k, category_id: null })}
                  className={cx(
                    'spring rounded-full py-1.5 text-sm font-medium',
                    draft.kind === k ? 'bg-series-1 text-white' : 'text-ink-2',
                  )}
                >
                  {titleCase(k)}
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
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={draft.kind === 'income' ? 'Into account' : 'From account'}>
                <AccountSelect
                  accounts={accountList}
                  value={draft.account_id}
                  onChange={(id) => {
                    const a = accountList.find((x) => x.id === id)
                    setDraft({ ...draft, account_id: id, currency: a?.currency ?? draft.currency })
                  }}
                  emptyLabel="Don't move any balance"
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

            {draft.kind !== 'transfer' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={draft.kind === 'expense' ? 'Merchant' : 'From'}>
                  <Input
                    value={draft.merchant}
                    onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
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
                    <option value="">Auto</option>
                    {categories.data
                      ?.filter((c) => c.kind === draft.kind)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.icon ? `${c.icon} ` : ''}
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            )}

            <ErrorNote error={record.error} />

            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={record.isPending}>
                Record
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

function StatusBadge({ message }: { message: SmsMessage }) {
  switch (message.status) {
    case 'processed':
      return (
        <Badge tone="good" icon={<CheckIcon {...ICON} />}>
          recorded{message.parsed_by === 'llm' ? ' by AI' : ''}
        </Badge>
      )
    case 'queued':
      return (
        <Badge tone="info" icon={<ClockIcon {...ICON} />}>
          reading…
        </Badge>
      )
    case 'failed':
      return (
        <Badge tone="critical" icon={<AlertTriangleIcon {...ICON} />}>
          failed
        </Badge>
      )
    case 'ignored':
      return <Badge icon={<BanIcon {...ICON} />}>not a transaction</Badge>
    default:
      return (
        <Badge tone="warning" icon={<ClockIcon {...ICON} />}>
          needs review
        </Badge>
      )
  }
}
