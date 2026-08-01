import { useState } from 'react'

import { Panel } from '@/components/charts'
import { ManualRateBadge, NoRateBadge, StaleRatesBadge } from '@/components/badges'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, ErrorNote, Input, SectionHeader, Spinner } from '@/components/ui'
import { money, rate as formatRate, relativeTime } from '@/lib/format'
import {
  useClearManualRate,
  useConfig,
  useFx,
  useRefreshFx,
  useSetManualRate,
} from '@/lib/queries'
import { useAuth } from '@/lib/auth'

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
            <RefreshIcon size={15} className={refresh.isPending ? 'animate-spin-slow' : undefined} />
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
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
