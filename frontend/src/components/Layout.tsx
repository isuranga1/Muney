import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { useAuth } from '@/lib/auth'
import { useFx } from '@/lib/queries'
import { relativeTime } from '@/lib/format'
import { useTheme } from '@/lib/theme'
import { Button, cx } from '@/components/ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/banks', label: 'Banks & accounts', icon: '▦' },
  { to: '/expenses', label: 'Expenses', icon: '↓' },
  { to: '/income', label: 'Income', icon: '↑' },
  { to: '/settings', label: 'Rates & settings', icon: '⚙' },
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
        <span className="text-lg font-semibold tracking-[-0.02em]">Muney</span>
        <Button size="sm" variant="secondary" onClick={() => setNavOpen((open) => !open)}>
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
            <span className="text-xl font-semibold tracking-[-0.02em]">Muney</span>
            <p className="mt-0.5 text-xs text-muted">Personal finance board</p>
          </div>

          <nav className="flex flex-col gap-1 px-3 py-3 lg:py-0">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  cx(
                    'spring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                    isActive
                      ? 'bg-series-1 font-medium text-white shadow-[0_2px_10px_rgb(42_120_214/0.35)]'
                      : 'text-ink-2 hover:bg-black/[0.05] hover:text-ink dark:hover:bg-white/[0.08]',
                  )
                }
              >
                <span aria-hidden="true" className="w-4 text-center text-xs opacity-80">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto px-4 pt-4 pb-4">
            <div className="glass-inset rounded-xl px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Rates</span>
                <span className={fx.data?.is_stale ? 'text-warning' : 'text-ink-2'}>
                  {fx.data?.is_stale && <span aria-hidden="true">⚠ </span>}
                  {relativeTime(fx.data?.last_updated)}
                </span>
              </div>
            </div>

            <p className="mt-3 truncate px-1 text-xs text-muted" title={user?.email}>
              {user?.full_name || user?.email}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={toggle}>
                {dark ? '☀ Light' : '☾ Dark'}
              </Button>
              <Button size="sm" variant="ghost" onClick={logout}>
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
