import { Link } from 'react-router-dom'

import { BarList, Panel, StatTile } from '@/components/charts'
import { Badge, Card, ErrorNote, Spinner } from '@/components/ui'
import { money, seriesColor, shortDate } from '@/lib/format'
import { useDashboard } from '@/lib/queries'
import type { BarRow } from '@/components/charts'

const PAID_COLOR = 'var(--series-1)'
const OUTSTANDING_COLOR = 'var(--series-2)'

export default function Dashboard() {
  const { data, isLoading, error } = useDashboard()

  if (isLoading) return <Spinner label="Loading your board…" />
  if (error) return <ErrorNote error={error} />
  if (!data) return null

  const base = data.base_currency
  const month = data.this_month

  const bankRows: BarRow[] = data.by_bank.map((bank, index) => ({
    key: String(bank.bank_id),
    label: bank.bank_name,
    note: `${bank.account_count} account${bank.account_count === 1 ? '' : 's'}`,
    segments: [
      {
        label: 'Balance',
        value: bank.converted_total,
        color: bank.color || seriesColor(index),
      },
    ],
  }))

  const groupRows: BarRow[] = data.expenses_by_group.map((group) => ({
    key: String(group.group_id ?? 'ungrouped'),
    label: group.group_name,
    segments: [
      { label: 'Paid', value: group.paid_converted, color: PAID_COLOR },
      { label: 'Outstanding', value: group.outstanding_converted, color: OUTSTANDING_COLOR },
    ],
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-2">
            Everything converted to {base} · {shortDate(month.period_start)} –{' '}
            {shortDate(month.period_end)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.fx_is_stale && (
            <Badge tone="warning" icon="⚠">
              FX rates are stale
            </Badge>
          )}
          {data.overdue_count > 0 && (
            <Badge tone="critical" icon="●">
              {data.overdue_count} overdue · {money(data.overdue_total, base)}
            </Badge>
          )}
        </div>
      </div>

      {data.unconvertible_currencies.length > 0 && (
        <Card className="border-warning/45 bg-warning/10 px-4 py-3 text-sm">
          <span aria-hidden="true">⚠ </span>
          No {base} rate for {data.unconvertible_currencies.join(', ')} — amounts in{' '}
          {data.unconvertible_currencies.length === 1 ? 'that currency are' : 'those currencies are'}{' '}
          left out of the totals below.{' '}
          <Link to="/settings" className="underline underline-offset-2">
            Set a rate
          </Link>
          .
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net worth"
          value={data.net_worth}
          currency={base}
          hero
          note={`${data.account_count} accounts across ${data.bank_count} banks`}
        />
        <StatTile label="Assets" value={data.assets_total} currency={base} tone="good" />
        <StatTile
          label="Liabilities"
          value={data.liabilities_total}
          currency={base}
          tone={data.liabilities_total > 0 ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Net this month"
          value={month.net_actual}
          currency={base}
          tone={month.net_actual >= 0 ? 'good' : 'critical'}
          note={`Projected ${money(month.net_projected, base)}`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Balances by bank" subtitle={`Net of liabilities, in ${base}`}>
          <BarList
            rows={bankRows}
            currency={base}
            emptyLabel="No accounts yet — add a bank to get started."
          />
        </Panel>

        <Panel title="Expenses by group" subtitle="Paid versus still outstanding">
          <BarList
            rows={groupRows}
            currency={base}
            legend={[
              { label: 'Paid', value: 0, color: PAID_COLOR },
              { label: 'Outstanding', value: 0, color: OUTSTANDING_COLOR },
            ]}
            emptyLabel="No expenses recorded yet."
          />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="This month" subtitle="Money in and out of the current calendar month">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-hairline">
              {[
                ['Income received', month.income_received, 'text-good-text'],
                ['Income still expected', month.income_expected, 'text-ink-2'],
                ['Expenses paid', month.expenses_paid, 'text-ink'],
                ['Expenses outstanding', month.expenses_outstanding, 'text-ink-2'],
              ].map(([label, value, tone]) => (
                <tr key={label as string}>
                  <td className="py-2 text-ink-2">{label as string}</td>
                  <td className={`tabular py-2 text-right font-medium ${tone as string}`}>
                    {money(value as number, base)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-line">
                <td className="py-2 font-medium">Net (actual)</td>
                <td
                  className={`tabular py-2 text-right font-semibold ${
                    month.net_actual >= 0 ? 'text-good-text' : 'text-critical'
                  }`}
                >
                  {money(month.net_actual, base)}
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Holdings by currency" subtitle={`Original amount and its ${base} value`}>
          {data.by_currency.length === 0 ? (
            <p className="py-6 text-sm text-muted">No accounts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="pb-2 text-left font-medium">Currency</th>
                  <th className="pb-2 text-right font-medium">Held</th>
                  <th className="pb-2 text-right font-medium">In {base}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.by_currency.map((row) => (
                  <tr key={row.currency}>
                    <td className="py-2">
                      {row.currency}
                      {!row.rate_available && (
                        <span className="ml-2">
                          <Badge tone="warning" icon="⚠">
                            no rate
                          </Badge>
                        </span>
                      )}
                      <span className="ml-2 text-xs text-muted">
                        {row.account_count} acct{row.account_count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="tabular py-2 text-right text-ink-2">
                      {money(row.original_total, row.currency)}
                    </td>
                    <td className="tabular py-2 text-right font-medium">
                      {row.rate_available ? money(row.converted_total, base) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </section>
    </div>
  )
}
