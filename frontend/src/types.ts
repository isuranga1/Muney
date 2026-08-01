export interface AppConfig {
  app_name: string
  base_currency: string
  supported_currencies: string[]
  account_types: string[]
  expense_statuses: string[]
  income_statuses: string[]
  recurrences: string[]
  news_refresh_minutes: number
}

export interface User {
  id: number
  email: string
  full_name: string | null
  is_active: boolean
}

export interface Token {
  access_token: string
  token_type: string
  user: User
}

export interface AuthStatus {
  has_users: boolean
  registration_open: boolean
}

export interface Account {
  id: number
  bank_id: number
  name: string
  account_type: string
  currency: string
  balance: number
  account_number: string | null
  notes: string | null
  sort_order: number
  is_active: boolean
  is_liability: boolean
  converted_balance: number | null
  converted_currency: string | null
  rate_available: boolean
}

export interface Bank {
  id: number
  name: string
  short_name: string | null
  country: string | null
  color: string | null
  notes: string | null
  sort_order: number
  is_archived: boolean
  accounts: Account[]
  total_converted: number
  converted_currency: string | null
}

export interface Expense {
  id: number
  group_id: number | null
  name: string
  amount: number
  currency: string
  status: string
  due_date: string | null
  paid_date: string | null
  recurrence: string
  account_id: number | null
  vendor: string | null
  notes: string | null
  converted_amount: number | null
  converted_currency: string | null
  rate_available: boolean
  is_overdue: boolean
}

export interface ExpenseGroup {
  id: number
  name: string
  description: string | null
  color: string | null
  sort_order: number
  is_archived: boolean
  expenses: Expense[]
  converted_currency: string | null
  total_converted: number
  paid_converted: number
  outstanding_converted: number
  expense_count: number
  paid_count: number
}

export interface Income {
  id: number
  source_id: number | null
  name: string
  amount: number
  currency: string
  status: string
  expected_date: string | null
  received_date: string | null
  recurrence: string
  account_id: number | null
  payer: string | null
  notes: string | null
  converted_amount: number | null
  converted_currency: string | null
  rate_available: boolean
  is_late: boolean
}

export interface IncomeSource {
  id: number
  name: string
  description: string | null
  color: string | null
  sort_order: number
  is_archived: boolean
  incomes: Income[]
  converted_currency: string | null
  total_converted: number
  received_converted: number
  expected_converted: number
  income_count: number
  received_count: number
}

export interface Article {
  id: number
  feed_id: number
  title: string
  link: string
  summary: string | null
  author: string | null
  published_at: string | null
  fetched_at: string
  is_read: boolean
  is_saved: boolean
  feed_name: string | null
  group_name: string | null
}

export interface Feed {
  id: number
  group_id: number | null
  name: string
  url: string
  site_url: string | null
  notes: string | null
  sort_order: number
  is_enabled: boolean
  last_fetched_at: string | null
  last_status: string | null
  last_error: string | null
  article_count: number
  unread_count: number
}

export interface FeedGroup {
  id: number
  name: string
  description: string | null
  color: string | null
  sort_order: number
  is_archived: boolean
  feeds: Feed[]
  article_count: number
  unread_count: number
}

export interface RefreshResultItem {
  feed_id: number
  feed_name: string
  new_articles: number
  error: string | null
}

export interface RefreshResult {
  refreshed_at: string
  feeds: number
  new_articles: number
  results: RefreshResultItem[]
}

export interface ImportResult {
  imported: number
  skipped: number
  failed: string[]
  feeds: Feed[]
}

export interface FeedTestResult {
  ok: boolean
  url: string
  item_count: number
  error: string | null
  sample_titles: string[]
}

export interface FxRate {
  id: number
  base_currency: string
  quote_currency: string
  rate: number
  source: string
  is_manual: boolean
  fetched_at: string
}

export interface FxSnapshot {
  base_currency: string
  rates: FxRate[]
  is_stale: boolean
  last_updated: string | null
  missing_currencies: string[]
}

export interface CurrencyBreakdown {
  currency: string
  original_total: number
  converted_total: number
  account_count: number
  rate_available: boolean
}

export interface BankBreakdown {
  bank_id: number
  bank_name: string
  color: string | null
  converted_total: number
  account_count: number
}

export interface GroupBreakdown {
  group_id: number | null
  group_name: string
  color: string | null
  converted_total: number
  paid_converted: number
  outstanding_converted: number
}

export interface PeriodSummary {
  period_start: string
  period_end: string
  income_received: number
  income_expected: number
  expenses_paid: number
  expenses_outstanding: number
  net_actual: number
  net_projected: number
}

export interface DashboardSummary {
  base_currency: string
  fx_is_stale: boolean
  assets_total: number
  liabilities_total: number
  net_worth: number
  account_count: number
  bank_count: number
  by_currency: CurrencyBreakdown[]
  by_bank: BankBreakdown[]
  expenses_by_group: GroupBreakdown[]
  this_month: PeriodSummary
  overdue_total: number
  overdue_count: number
  unconvertible_currencies: string[]
}
