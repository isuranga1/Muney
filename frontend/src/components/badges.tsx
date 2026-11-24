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
  AlertTriangleIcon,
  CheckIcon,
  DebtIcon,
  PauseIcon,
  PencilIcon,
  SparklesIcon,
} from '@/components/icons'

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

/** A category the LLM made up, waiting for you to keep or rename it. */
export function LlmBadge({ label = 'AI' }: { label?: string }) {
  return (
    <Badge tone="info" icon={<SparklesIcon {...ICON} />}>
      {label}
    </Badge>
  )
}

/** Budget bucket state for the month. `null` = no income to measure against yet. */
/** A bucket's envelope: fine, or spent past what it holds. */
export function EnvelopeBadge({ over }: { over: boolean }) {
  return over ? (
    <Badge tone="critical" icon={<AlertTriangleIcon {...ICON} />}>
      overspent
    </Badge>
  ) : (
    <Badge tone="good" icon={<CheckIcon {...ICON} />}>
      in budget
    </Badge>
  )
}
