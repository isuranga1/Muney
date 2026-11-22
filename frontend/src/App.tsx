import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from '@/components/Layout'
import { useAuth } from '@/lib/auth'
import Accounts from '@/pages/Accounts'
import Activity from '@/pages/Activity'
import Budget from '@/pages/Budget'
import Home from '@/pages/Home'
import Inbox from '@/pages/Inbox'
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
        <Route path="/" element={<Home />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/news" element={<News />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
