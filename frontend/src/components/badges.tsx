/**
 * Status pills, in one place.
 *
 * The status → (icon, tone, wording) mapping lives here and nowhere else, so
 * changing how "overdue" looks is a one-line edit rather than a hunt through
 * three pages. Every pill pairs an icon with a word: colour alone is not a
 * usable signal for a colourblind reader, and several of these tones are
 * deliberately close together.
 */
import { Badge } from '@/components/ui'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  ClockIcon,
  DebtIcon,
  PauseIcon,
  PencilIcon,
} from '@/components/icons'
import { shortDate } from '@/lib/format'

const ICON = { size: 12, strokeWidth: 2.5 } as const

/** Shown wherever an amount could not be converted to the base currency. */
export function NoRateBadge() {
  return (
    <Badge tone="warning" icon={<AlertTriangleIcon {...ICON} />}>
      no rate
    </Badge>
  )
}

export function StaleRatesBadge() {
  return (
    <Badge tone="warning" icon={<AlertTriangleIcon {...ICON} />}>
      FX rates are stale
    </Badge>
  )
}

export function ManualRateBadge() {
  return (
    <Badge tone="info" icon={<PencilIcon {...ICON} />}>
      manual
    </Badge>
  )
}

export function LiabilityBadge() {
  return (
    <Badge tone="critical" icon={<DebtIcon {...ICON} />}>
      liability
    </Badge>
  )
}

export function InactiveBadge() {
  return <Badge icon={<PauseIcon {...ICON} />}>inactive</Badge>
}

export function ExpenseStatusBadge({
  status,
  paidDate,
  isOverdue,
}: {
  status: string
  paidDate: string | null
  isOverdue: boolean
}) {
  if (status === 'paid') {
    return (
      <Badge tone="good" icon={<CheckIcon {...ICON} />}>
        Paid{paidDate ? ` ${shortDate(paidDate)}` : ''}
      </Badge>
    )
  }
  if (status === 'cancelled') {
    return <Badge icon={<BanIcon {...ICON} />}>Cancelled</Badge>
  }
  if (isOverdue) {
    return (
      <Badge tone="critical" icon={<AlertCircleIcon {...ICON} />}>
        Overdue
      </Badge>
    )
  }
  return (
    <Badge tone="info" icon={<ClockIcon {...ICON} />}>
      Pending
    </Badge>
  )
}

export function IncomeStatusBadge({
  status,
  receivedDate,
  isLate,
}: {
  status: string
  receivedDate: string | null
  isLate: boolean
}) {
  if (status === 'received') {
    return (
      <Badge tone="good" icon={<CheckIcon {...ICON} />}>
        Received{receivedDate ? ` ${shortDate(receivedDate)}` : ''}
      </Badge>
    )
  }
  if (status === 'cancelled') {
    return <Badge icon={<BanIcon {...ICON} />}>Cancelled</Badge>
  }
  if (isLate) {
    return (
      <Badge tone="warning" icon={<AlertTriangleIcon {...ICON} />}>
        Late
      </Badge>
    )
  }
  return (
    <Badge tone="info" icon={<ClockIcon {...ICON} />}>
      Expected
    </Badge>
  )
}
