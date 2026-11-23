import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { useFx } from '@/lib/queries'
import { relativeTime } from '@/lib/format'
import { useTheme } from '@/lib/theme'
import { Button, cx } from '@/components/ui'
import {
  AlertTriangleIcon,
  BankIcon,
  DashboardIcon,
  InboxIcon,
  ListIcon,
  LogOutIcon,
  MoonIcon,
  PiggyBankIcon,
  RssIcon,
  SettingsIcon,
  SunIcon,
  TargetIcon,
  WalletIcon,
} from '@/components/icons'

// Add a page: one entry here plus a <Route> in App.tsx.
// `short` is what the phone tab bar shows — seven tabs on a 390px screen leaves
// roughly 55px each, so the long labels do not fit. `phone: false` keeps a page
// off the tab bar; Settings is reached from the gear in the phone's top bar.
const NAV = [
  { to: '/', label: 'Overview', short: 'Home', Icon: DashboardIcon },
  { to: '/accounts', label: 'Accounts', short: 'Accounts', Icon: BankIcon },
  { to: '/activity', label: 'Activity', short: 'Activity', Icon: ListIcon },
  { to: '/budget', label: 'Budget rule', short: 'Budget', Icon: TargetIcon },
  { to: '/funds', label: 'Funds', short: 'Funds', Icon: PiggyBankIcon },
  { to: '/inbox', label: 'SMS inbox', short: 'Inbox', Icon: InboxIcon },
  { to: '/news', label: 'News', short: 'News', Icon: RssIcon },
  { to: '/settings', label: 'Settings', short: 'Settings', Icon: SettingsIcon, phone: false },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const fx = useFx()

  return (
    // Horizontal safe-area is applied once here, on the outermost box, so inner
    // elements keep their own padding untouched. It is 0 in portrait and only
    // bites in landscape, where the notch eats into one side.
    <div className="flex min-h-full flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:flex-row">
      {/* ---------------------------------------------------- phone top bar */}
      <header className="glass-chrome pad-safe-top sticky top-0 z-30 flex items-center justify-between border-b px-4 lg:hidden">
        <span className="flex items-center gap-2 py-3 text-lg font-semibold tracking-[-0.02em]">
          <WalletIcon size={20} className="text-series-1" />
          Muney
        </span>
        <div className="flex items-center gap-1">
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) =>
              cx(
                'grid size-11 place-items-center rounded-full active:bg-black/10 dark:active:bg-white/10',
                isActive ? 'text-series-1' : 'text-ink-2',
              )
            }
          >
            <SettingsIcon size={18} />
          </NavLink>
          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="grid size-11 place-items-center rounded-full text-ink-2 active:bg-black/10 dark:active:bg-white/10"
          >
            {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            className="grid size-11 place-items-center rounded-full text-ink-2 active:bg-black/10 dark:active:bg-white/10"
          >
            <LogOutIcon size={18} />
          </button>
        </div>
      </header>

      {/* ------------------------------------------------- desktop sidebar */}
      <aside className="glass z-20 hidden shrink-0 lg:sticky lg:top-4 lg:m-4 lg:mr-0 lg:block lg:h-[calc(100vh-2rem)] lg:w-64 lg:rounded-glass">
        <div className="flex h-full flex-col">
          <div className="px-5 pt-6 pb-5">
            <span className="flex items-center gap-2.5 text-xl font-semibold tracking-[-0.02em]">
              <span className="glass-inset grid size-8 place-items-center rounded-xl text-series-1">
                <WalletIcon size={17} />
              </span>
              Muney
            </span>
            <p className="mt-1.5 text-xs text-muted">Personal finance board</p>
          </div>

          <nav className="stagger flex flex-col gap-1 px-3">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx(
                    'spring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                    isActive
                      ? 'bg-series-1 font-medium text-white shadow-[0_2px_10px_rgb(42_120_214/0.35)]'
                      : 'text-ink-2 hover:bg-black/[0.05] hover:text-ink dark:hover:bg-white/[0.08]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={17}
                      className={cx(
                        'spring shrink-0',
                        isActive ? 'text-white' : 'text-muted group-hover:text-ink',
                      )}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto px-4 pt-4 pb-4">
            <div className="glass-inset rounded-xl px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Rates</span>
                <span
                  className={cx(
                    'inline-flex items-center gap-1',
                    fx.data?.is_stale ? 'text-warning' : 'text-ink-2',
                  )}
                >
                  {fx.data?.is_stale && <AlertTriangleIcon size={12} strokeWidth={2.25} />}
                  {relativeTime(fx.data?.last_updated)}
                </span>
              </div>
            </div>

            <p className="mt-3 truncate px-1 text-xs text-muted" title={user?.email}>
              {user?.full_name || user?.email}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={toggle}>
                {dark ? <SunIcon size={14} /> : <MoonIcon size={14} />}
                {dark ? 'Light' : 'Dark'}
              </Button>
              <Button size="sm" variant="ghost" onClick={logout}>
                <LogOutIcon size={14} />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Bottom padding clears the phone tab bar; the calc keeps content off
          the home indicator on notched devices. */}
      <main className="min-w-0 flex-1 px-4 py-5 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* -------------------------------------------------- phone tab bar */}
      <nav
        aria-label="Main"
        // Fixed, so it sits outside the root's padding and needs its own.
        className="glass-chrome pad-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
      >
        <ul className="flex">
          {NAV.filter((item) => item.phone !== false).map(({ to, short, Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx(
                    // min-h-14 keeps every tab at/above the 44pt touch target.
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5',
                    isActive ? 'text-series-1' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.75} />
                    <span className={cx('text-[10px]', isActive && 'font-semibold')}>{short}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
