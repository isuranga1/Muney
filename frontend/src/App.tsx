import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import Banks from '@/pages/Banks'
import Dashboard from '@/pages/Dashboard'
import Expenses from '@/pages/Expenses'
import IncomePage from '@/pages/Income'
import Login from '@/pages/Login'
import News from '@/pages/News'
import Settings from '@/pages/Settings'

export default function App() {
  const { user, ready } = useAuth()

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading Muney…
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/banks" element={<Banks />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/income" element={<IncomePage />} />
        <Route path="/news" element={<News />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
