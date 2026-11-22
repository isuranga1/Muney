import { useState } from 'react'

import { Panel } from '@/components/charts'
import { LlmBadge, ManualRateBadge, NoRateBadge, StaleRatesBadge } from '@/components/badges'
import { PlusIcon, RefreshIcon } from '@/components/icons'
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
import { money, rate as formatRate, relativeTime } from '@/lib/format'
import {
  useBuckets,
  useCategories,
  useClearManualRate,
  useConfig,
  useDeleteCategory,
  useFx,
  useRefreshFx,
  useSaveCategory,
  useSetManualRate,
} from '@/lib/queries'
import { useAuth } from '@/lib/auth'
import type { Category, CategoryKind } from '@/types'

export default function Settings() {
  const { user } = useAuth()
  const config = useConfig()
  const fx = useFx()
  const refresh = useRefreshFx()
  const setManual = useSetManualRate()
  const clearManual = useClearManualRate()

  const [editing, setEditing] = useState<string | null>(null)
  const [draftRate, setDraftRate] = useState('')

  const base = fx.data?.base_currency ?? config.data?.base_currency ?? 'LKR'
  const known = new Set(fx.data?.rates.map((row) => row.base_currency) ?? [])
  const missing = (config.data?.supported_currencies ?? []).filter(
    (code) => code !== base && !known.has(code),
  )

  function startEdit(currency: string, current: number) {
    setEditing(currency)
    setDraftRate(String(current))
  }

  function saveRate(currency: string) {
    const value = Number(draftRate)
    if (!Number.isFinite(value) || value <= 0) return
    setManual.mutate({ currency, rate: value }, { onSuccess: () => setEditing(null) })
  }

  if (fx.isLoading) return <Spinner />

  return (
    <div className="animate-rise flex flex-col gap-6">
      <SectionHeader
        title="Rates & settings"
        subtitle={`Every amount in Muney is converted to ${base}.`}
        actions={
          <Button
            variant="primary"
            onClick={() => refresh.mutate(undefined)}
            disabled={refresh.isPending}
          >
            <RefreshIcon
              size={15}
              className={refresh.isPending ? 'animate-spin-slow' : undefined}
            />
            {refresh.isPending ? 'Fetching…' : 'Refresh rates'}
          </Button>
        }
      />

      <ErrorNote error={fx.error ?? refresh.error ?? setManual.error ?? clearManual.error} />

      <Panel
        title={`Exchange rates to ${base}`}
        subtitle="Fetched from the configured provider. A manual rate you set here always wins and survives every refresh."
        action={
          fx.data?.is_stale ? (
            <StaleRatesBadge />
          ) : (
            <span className="text-xs text-muted">
              updated {relativeTime(fx.data?.last_updated)}
            </span>
          )
        }
      >
        <div className="scroll-x">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-2 text-left font-medium">Currency</th>
                <th className="py-2 text-right font-medium">1 unit =</th>
                <th className="py-2 text-left font-medium">Source</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              <tr>
                <td className="py-2.5 font-medium">{base}</td>
                <td className="tabular py-2.5 text-right text-muted">1.00 {base}</td>
                <td className="py-2.5 text-muted">base currency</td>
                <td />
              </tr>

              {fx.data?.rates.map((row) => (
                <tr key={row.id}>
                  <td className="py-2.5 font-medium">{row.base_currency}</td>
                  <td className="py-2.5 text-right">
                    {editing === row.base_currency ? (
                      <div className="flex justify-end gap-2">
                        <Input
                          type="number"
                          step="0.0001"
                          autoFocus
                          className="w-32 text-right"
                          value={draftRate}
                          onChange={(e) => setDraftRate(e.target.value)}
                        />
                      </div>
                    ) : (
                      <span className="tabular">
                        {formatRate(row.rate)} {base}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {row.is_manual ? (
                      <ManualRateBadge />
                    ) : (
                      <span className="text-xs text-muted">
                        live · {relativeTime(row.fetched_at)}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {editing === row.base_currency ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => saveRate(row.base_currency)}
                          >
                            Save
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(row.base_currency, row.rate)}
                          >
                            Set manually
                          </Button>
                          {row.is_manual && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => clearManual.mutate(row.base_currency)}
                            >
                              Use live
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {missing.map((code) => (
                <tr key={code}>
                  <td className="py-2.5 font-medium">{code}</td>
                  <td className="py-2.5 text-right">
                    {editing === code ? (
                      <div className="flex justify-end">
                        <Input
                          type="number"
                          step="0.0001"
                          autoFocus
                          className="w-32 text-right"
                          value={draftRate}
                          onChange={(e) => setDraftRate(e.target.value)}
                        />
                      </div>
                    ) : (
                      <NoRateBadge />
                    )}
                  </td>
                  <td className="py-2.5 text-xs text-muted">not quoted by the provider</td>
                  <td className="py-2.5 text-right">
                    {editing === code ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => saveRate(code)}>
                          Save
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => startEdit(code, 1)}>
                        Set manually
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted">
          Example: with a rate of {formatRate(fx.data?.rates[0]?.rate ?? 300)}, an account holding{' '}
          {money(100, fx.data?.rates[0]?.base_currency ?? 'USD')} shows as{' '}
          {money(100 * (fx.data?.rates[0]?.rate ?? 300), base)} on the dashboard.
        </p>
      </Panel>

      <CategoriesPanel />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold">Account</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Name</dt>
              <dd>{user?.full_name || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Email</dt>
              <dd className="truncate">{user?.email}</dd>
            </div>
          </dl>
        </Card>

        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold">Configuration</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Base currency</dt>
              <dd>{base}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Also shown in</dt>
              <dd>{config.data?.secondary_currency ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">SMS forwarding</dt>
              <dd>{config.data?.ingest_enabled ? 'on' : 'off — set INGEST_TOKEN'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">AI reading</dt>
              <dd>
                {config.data?.llm_provider === 'llamacpp'
                  ? `on-board · ${config.data.llm_model ?? 'llama.cpp'}`
                  : config.data?.llm_provider === 'anthropic'
                    ? `Claude · ${config.data.llm_model ?? ''}`
                    : 'off — set LLM_PROVIDER'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Currencies</dt>
              <dd className="text-right">{config.data?.supported_currencies.join(', ')}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            Change these in <code>backend/.env</code> and restart the API.
          </p>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- categories */

type CategoryDraft = {
  id?: number
  kind: CategoryKind
  name: string
  icon: string
  color: string
  keywords: string
  bucket_id: number | null
}

function CategoriesPanel() {
  const categories = useCategories()
  const buckets = useBuckets()
  const save = useSaveCategory()
  const remove = useDeleteCategory()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [draft, setDraft] = useState<CategoryDraft | null>(null)

  const list = (categories.data ?? []).filter((c) => c.kind === kind)
  const fromAi = list.filter((c) => c.origin === 'llm')
  const bucketName = new Map((buckets.data ?? []).map((b) => [b.id, b.name]))

  function edit(c: Category) {
    save.reset()
    setDraft({
      id: c.id,
      kind: c.kind,
      name: c.name,
      icon: c.icon ?? '',
      color: c.color ?? '#2a78d6',
      keywords: c.keywords ?? '',
      bucket_id: c.bucket_id,
    })
  }

  function submit() {
    if (!draft || !draft.name.trim()) return
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      icon: draft.icon.trim() || null,
      color: draft.color,
      keywords: draft.keywords.trim() || null,
      bucket_id: draft.kind === 'expense' ? draft.bucket_id : null,
    }
    if (draft.id) body.origin = 'user'
    else body.kind = draft.kind
    save.mutate({ id: draft.id, ...body }, { onSuccess: () => setDraft(null) })
  }

  return (
    <Panel
      title="Categories"
      subtitle="Keywords file transactions instantly (the longest match wins). Anything they miss goes to the AI, which can also suggest a new category — those are marked so you can keep, rename or merge them."
      action={
        <Button
          size="sm"
          onClick={() =>
            setDraft({ kind, name: '', icon: '', color: '#2a78d6', keywords: '', bucket_id: null })
          }
        >
          <PlusIcon size={14} />
          Add
        </Button>
      }
    >
      <div className="mb-4 flex gap-2">
        {(['expense', 'income'] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={kind === k ? 'primary' : 'secondary'}
            onClick={() => setKind(k)}
          >
            {k === 'expense' ? 'Spending' : 'Income'}
          </Button>
        ))}
      </div>

      <ErrorNote error={categories.error ?? save.error ?? remove.error} />

      {fromAi.length > 0 && (
        <p className="mb-3 text-xs text-ink-2">
          The AI added {fromAi.length} categor{fromAi.length === 1 ? 'y' : 'ies'} — open one and
          save to keep it{kind === 'expense' ? ', and give it a budget bucket' : ''}.
        </p>
      )}

      {draft && !draft.id && (
        <CategoryEditor
          draft={draft}
          buckets={buckets.data ?? []}
          onChange={setDraft}
          onSave={submit}
          onCancel={() => setDraft(null)}
        />
      )}

      <ul className="divide-y divide-hairline">
        {list.map((c) =>
          draft?.id === c.id ? (
            <li key={c.id} className="py-2.5">
              <CategoryEditor
                draft={draft}
                buckets={buckets.data ?? []}
                onChange={setDraft}
                onSave={submit}
                onCancel={() => setDraft(null)}
              />
            </li>
          ) : (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-full text-base"
                style={{
                  backgroundColor: `color-mix(in srgb, ${c.color || '#888'} 18%, transparent)`,
                }}
              >
                {c.icon || '•'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {c.name}
                  {c.origin === 'llm' && <LlmBadge label="added by AI" />}
                </p>
                <p className="truncate text-xs text-muted">
                  {c.kind === 'expense' &&
                    (c.bucket_id ? `${bucketName.get(c.bucket_id)} · ` : 'no bucket · ')}
                  {c.keywords || 'no keywords'}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => edit(c)}>
                  Edit
                </Button>
                <ConfirmButton
                  onConfirm={() => remove.mutate(c.id)}
                  message={`Delete "${c.name}"? Its transactions become uncategorised.`}
                />
              </div>
            </li>
          ),
        )}
      </ul>
    </Panel>
  )
}

function CategoryEditor({
  draft,
  buckets,
  onChange,
  onSave,
  onCancel,
}: {
  draft: CategoryDraft
  buckets: { id: number; name: string }[]
  onChange: (draft: CategoryDraft) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="glass-inset mb-3 flex flex-col gap-2 rounded-xl p-3">
      <div className="flex gap-2">
        <input
          type="color"
          aria-label="Colour"
          className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          value={draft.color}
          onChange={(e) => onChange({ ...draft, color: e.target.value })}
        />
        <Input
          aria-label="Emoji"
          placeholder="🛒"
          maxLength={8}
          className="w-16 text-center"
          value={draft.icon}
          onChange={(e) => onChange({ ...draft, icon: e.target.value })}
        />
        <Input
          autoFocus
          placeholder="Name"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <Input
        placeholder="Keywords: keells, cargills, food city"
        value={draft.keywords}
        onChange={(e) => onChange({ ...draft, keywords: e.target.value })}
      />
      <div
        className={cx(
          'flex flex-wrap items-center gap-2',
          draft.kind === 'expense' ? 'justify-between' : 'justify-end',
        )}
      >
        {draft.kind === 'expense' && (
          <Select
            aria-label="Budget bucket"
            className="w-auto py-1.5 text-xs"
            value={draft.bucket_id ?? ''}
            onChange={(e) =>
              onChange({ ...draft, bucket_id: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">No budget bucket</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
