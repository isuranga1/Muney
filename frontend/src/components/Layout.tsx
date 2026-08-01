import { useState } from 'react'
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
  ExpenseIcon,
  IncomeIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  WalletIcon,
} from '@/components/icons'

// Add a page: one entry here plus a <Route> in App.tsx.
const NAV = [
  { to: '/', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/banks', label: 'Banks & accounts', Icon: BankIcon },
  { to: '/expenses', label: 'Expenses', Icon: ExpenseIcon },
  { to: '/income', label: 'Income', Icon: IncomeIcon },
  { to: '/settings', label: 'Rates & settings', Icon: SettingsIcon },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { dark, toggle } = useTheme()
  const fx = useFx()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="flex min-h-full flex-col lg:flex-row lg:gap-0">
      {/* Mobile chrome */}
      <header className="glass-chrome sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
          <WalletIcon size={20} className="text-series-1" />
          Muney
        </span>
        <Button size="sm" variant="secondary" onClick={() => setNavOpen((open) => !open)}>
          <MenuIcon size={16} />
          {navOpen ? 'Close' : 'Menu'}
        </Button>
      </header>

      {/* The sidebar floats as its own pane of glass rather than sitting flush. */}
      <aside
        className={cx(
          'z-20 shrink-0 lg:sticky lg:top-4 lg:m-4 lg:mr-0 lg:block lg:h-[calc(100vh-2rem)] lg:w-64',
          'glass rounded-none lg:rounded-glass',
          navOpen ? 'block' : 'hidden',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="hidden px-5 pt-6 pb-5 lg:block">
            <span className="flex items-center gap-2.5 text-xl font-semibold tracking-[-0.02em]">
              <span className="glass-inset grid size-8 place-items-center rounded-xl text-series-1">
                <WalletIcon size={17} />
              </span>
              Muney
            </span>
            <p className="mt-1.5 text-xs text-muted">Personal finance board</p>
          </div>

          <nav className="stagger flex flex-col gap-1 px-3 py-3 lg:py-0">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setNavOpen(false)}
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

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
