import { createRoot } from 'react-dom/client'

import * as Icons from '@/components/icons'
import {
  ExpenseStatusBadge,
  IncomeStatusBadge,
  InactiveBadge,
  LiabilityBadge,
  ManualRateBadge,
  NoRateBadge,
  StaleRatesBadge,
} from '@/components/badges'
import '@/index.css'

const entries = Object.entries(Icons).filter(([name]) => name.endsWith('Icon'))

createRoot(document.getElementById('root')!).render(
  <div className="mx-auto max-w-4xl p-10">
    <div className="glass rounded-glass p-8">
      <h1 className="mb-6 text-xl font-semibold">Icons ({entries.length})</h1>
      <div className="grid grid-cols-4 gap-4 sm:grid-cols-6">
        {entries.map(([name, Icon]) => (
          <div key={name} className="glass-inset flex flex-col items-center gap-2 rounded-xl p-3">
            <Icon size={22} />
            <span className="text-center text-[10px] text-muted">{name.replace('Icon', '')}</span>
          </div>
        ))}
      </div>

      <h2 className="mt-10 mb-4 text-base font-semibold">Status badges</h2>
      <div className="flex flex-wrap gap-2">
        <ExpenseStatusBadge status="paid" paidDate="2026-07-14" isOverdue={false} />
        <ExpenseStatusBadge status="pending" paidDate={null} isOverdue={false} />
        <ExpenseStatusBadge status="pending" paidDate={null} isOverdue />
        <ExpenseStatusBadge status="cancelled" paidDate={null} isOverdue={false} />
        <IncomeStatusBadge status="received" receivedDate="2026-07-01" isLate={false} />
        <IncomeStatusBadge status="expected" receivedDate={null} isLate={false} />
        <IncomeStatusBadge status="expected" receivedDate={null} isLate />
        <NoRateBadge />
        <StaleRatesBadge />
        <ManualRateBadge />
        <LiabilityBadge />
        <InactiveBadge />
      </div>
    </div>
  </div>,
)
