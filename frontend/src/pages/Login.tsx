import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { http } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import type { AuthStatus } from '@/types'
import { Button, Card, ErrorNote, Field, Input } from '@/components/ui'

export default function Login() {
  const { login, register } = useAuth()
  const { dark, toggle } = useTheme()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    http
      .get<AuthStatus>('/auth/status')
      .then(setStatus)
      .catch(() => setStatus({ has_users: true, registration_open: false }))
  }, [])

  const creating = status?.registration_open ?? false

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (creating) await register(email, password, fullName)
      else await login(email, password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <div className="absolute top-4 right-4">
        <Button size="sm" variant="ghost" onClick={toggle}>
          {dark ? '☀ Light' : '☾ Dark'}
        </Button>
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div
            aria-hidden="true"
            className="glass mx-auto mb-5 grid size-14 place-items-center rounded-2xl text-2xl font-semibold text-series-1"
          >
            ₨
          </div>
          <h1 className="text-[2rem] font-semibold tracking-[-0.03em]">Muney</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            {status === null
              ? 'Connecting…'
              : creating
                ? 'Create your account to get started.'
                : 'Sign in to your finance board.'}
          </p>
        </div>

        <Card className="px-6 py-7">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {creating && (
              <Field label="Name">
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Isuranga"
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </Field>

            <Field
              label="Password"
              hint={creating ? 'At least 8 characters.' : undefined}
            >
              <Input
                type="password"
                required
                minLength={creating ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creating ? 'new-password' : 'current-password'}
              />
            </Field>

            <ErrorNote error={error} />

            <Button type="submit" variant="primary" disabled={busy || status === null}>
              {busy ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </Card>

        {status && !status.has_users && !status.registration_open && (
          <p className="mt-4 text-center text-xs text-muted">
            No account exists and registration is disabled. Set
            ALLOW_BOOTSTRAP_REGISTRATION=true in backend/.env.
          </p>
        )}
      </div>
    </div>
  )
}
