import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useEffect } from 'react'

import { AlertTriangleIcon, CloseIcon } from '@/components/icons'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* --------------------------------------------------------------- surfaces */

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('glass spring rounded-glass', className)}>
      {children}
    </div>
  )
}

export function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="glass rounded-glass px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- controls */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'border-transparent bg-series-1 text-white shadow-[0_2px_10px_rgb(42_120_214/0.35)] ' +
    'hover:brightness-110 active:brightness-95',
  secondary:
    'glass-inset text-ink hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/10 ' +
    'dark:active:bg-white/[0.14]',
  ghost:
    'border-transparent bg-transparent text-ink-2 hover:bg-black/5 hover:text-ink ' +
    'dark:hover:bg-white/10',
  danger: 'border-critical/35 bg-critical/10 text-critical hover:bg-critical/20',
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'spring inline-flex items-center justify-center gap-1.5 rounded-full border font-medium',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-series-1',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  )
}

const FIELD_CLASS =
  'glass-inset spring w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-muted ' +
  'focus:border-series-1/70 focus:outline-none focus:ring-[3px] focus:ring-series-1/25'

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(FIELD_CLASS, className)} />
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(FIELD_CLASS, 'select pr-9', className)} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(FIELD_CLASS, 'min-h-20 resize-y', className)} />
}

/** Rounded, translucent checkbox that matches the glass controls (see .checkbox). */
export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...rest} className={cx('checkbox', className)} />
}

/* ------------------------------------------------------------------ status */

const BADGE_TONES = {
  neutral: 'bg-black/[0.06] text-ink-2 border-hairline dark:bg-white/[0.08]',
  good: 'bg-good/12 text-good-text border-good/30',
  warning: 'bg-warning/15 text-ink border-warning/40',
  critical: 'bg-critical/12 text-critical border-critical/35',
  info: 'bg-series-1/12 text-series-1 border-series-1/30',
} as const

/**
 * Status pill. `icon` is a node so it can be any icon from components/icons —
 * the pairing matters: a status must never be carried by colour alone, since
 * several of these tones are indistinguishable to a colourblind reader.
 */
export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: keyof typeof BADGE_TONES
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border py-0.5 text-xs font-medium',
        'backdrop-blur-sm',
        icon ? 'pr-2.5 pl-2' : 'px-2.5',
        BADGE_TONES[tone],
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="animate-fade mb-4 flex items-start gap-2 rounded-xl border border-critical/35 bg-critical/10 px-4 py-3 text-sm text-critical backdrop-blur-sm">
      <AlertTriangleIcon size={16} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="animate-fade flex items-center gap-2.5 py-10 text-sm text-muted">
      <span className="animate-spin-slow size-3.5 rounded-full border-2 border-line border-t-series-1" />
      {label}
    </div>
  )
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    // Phones: the sheet sits at the bottom of the screen within thumb reach and
    // spans the full width. From sm up it becomes a centred dialog.
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:p-8">
      {/* Scrim doubles as the dismiss target; blurring it pushes the page back. */}
      <div
        className="animate-fade fixed inset-0 bg-black/25 backdrop-blur-md dark:bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass-raised animate-pop relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-[1.5rem] pb-[env(safe-area-inset-bottom)] sm:my-auto sm:max-w-lg sm:rounded-[1.5rem] sm:pb-0"
      >
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="spring grid size-7 place-items-center rounded-full bg-black/[0.06] text-ink-2 hover:bg-black/10 hover:text-ink dark:bg-white/10 dark:hover:bg-white/[0.16]"
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-hairline px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  )
}

export function ConfirmButton({
  onConfirm,
  label = 'Delete',
  message,
  disabled,
}: {
  onConfirm: () => void
  label?: string
  message: string
  disabled?: boolean
}) {
  return (
    <Button
      variant="danger"
      size="sm"
      disabled={disabled}
      onClick={() => {
        if (window.confirm(message)) onConfirm()
      }}
    >
      {label}
    </Button>
  )
}
