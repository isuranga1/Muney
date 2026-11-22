export interface AppConfig {
  app_name: string
  base_currency: string
  secondary_currency: string | null
  supported_currencies: string[]
  account_types: string[]
  news_refresh_minutes: number
  ingest_enabled: boolean
  llm_provider: 'none' | 'anthropic' | 'llamacpp'
  llm_model: string | null
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

/* ---------------------------------------------------------------- accounts */

export interface Account {
  id: number
  name: string
  institution: string | null
  account_type: string
  currency: string
  balance: number
  last_digits: string | null
  color: string | null
  notes: string | null
  bucket_id: number | null
  include_in_total: boolean
  is_archived: boolean
  sort_order: number
  is_liability: boolean
  base_balance: number | null
  secondary_balance: number | null
}

export interface CurrencyTotal {
  currency: string
  total: number
  base_total: number | null
  account_count: number
}

export interface AccountsOverview {
  base_currency: string
  secondary_currency: string | null
  net_worth: number
  net_worth_secondary: number | null
  assets: number
  liabilities: number
  by_currency: CurrencyTotal[]
  accounts: Account[]
  unconvertible: string[]
}

/* -------------------------------------------------------------- categories */

export type CategoryKind = 'expense' | 'income'

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  icon: string | null
  color: string | null
  keywords: string | null
  bucket_id: number | null
  origin: 'system' | 'user' | 'llm'
  is_archived: boolean
  sort_order: number
}

/* ------------------------------------------------------------ transactions */

export type TransactionKind = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: number
  kind: TransactionKind
  amount: number
  currency: string
  base_amount: number | null
  occurred_on: string
  occurred_at: string | null
  account_id: number | null
  account_delta: number | null
  to_account_id: number | null
  to_account_delta: number | null
  category_id: number | null
  merchant: string | null
  note: string | null
  source: 'manual' | 'sms'
  categorized_by: 'user' | 'rule' | 'keyword' | 'llm' | null
  created_at: string
}

export interface TransactionFilters {
  year?: number
  month?: number
  kind?: TransactionKind
  category_id?: number
  uncategorized?: boolean
  account_id?: number
  q?: string
  limit?: number
}

/* ------------------------------------------------------------------ budget */

export interface Bucket {
  id: number
  name: string
  percent: number
  goal_type: 'save' | 'spend'
  color: string | null
  sort_order: number
}

export interface BucketStatus {
  bucket_id: number
  name: string
  color: string | null
  goal_type: 'save' | 'spend'
  percent: number
  target: number
  actual: number
  progress: number
  on_track: boolean | null
  actual_percent: number | null
}

export interface BudgetMonthStatus {
  year: number
  month: number
  base_currency: string
  income_actual: number
  income_basis: number
  basis_is_override: boolean
  total_percent: number
  buckets: BucketStatus[]
  unassigned_spend: number
  on_track_count: number
}

/* ----------------------------------------------------------------- reports */

export interface CategoryTotal {
  category_id: number | null
  name: string
  icon: string | null
  color: string | null
  total: number
  count: number
  share: number
}

export interface MonthReport {
  year: number
  month: number
  base_currency: string
  secondary_currency: string | null
  secondary_rate: number | null
  income: number
  expense: number
  net: number
  savings_rate: number | null
  transaction_count: number
  expense_by_category: CategoryTotal[]
  income_by_category: CategoryTotal[]
  by_day: { day: string; income: number; expense: number }[]
  previous_income: number
  previous_expense: number
}

export interface CategoryYearRow {
  category_id: number | null
  name: string
  icon: string | null
  color: string | null
  total: number
  months: number[]
}

export interface YearReport {
  year: number
  base_currency: string
  income: number
  expense: number
  net: number
  months: { month: number; income: number; expense: number; net: number }[]
  expense_categories: CategoryYearRow[]
  income_categories: CategoryYearRow[]
}

/* ------------------------------------------------------------------- inbox */

export interface SmsMessage {
  id: number
  body: string
  sender: string | null
  received_at: string
  status: 'queued' | 'pending' | 'processed' | 'ignored' | 'failed'
  parsed_by: 'regex' | 'llm' | 'manual' | null
  error: string | null
  processed_at: string | null
  transaction_id: number | null
}

/** Body for recording an SMS by hand. */
export interface ParsedSms {
  kind: TransactionKind
  amount: number
  currency: string
  merchant?: string | null
  occurred_on?: string | null
  account_id?: number | null
  to_account_id?: number | null
  category_id?: number | null
}

/* -------------------------------------------------------------------- news */

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
