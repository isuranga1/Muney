import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'

import { http } from '@/lib/api'
import type {
  AccountsOverview,
  AppConfig,
  Article,
  Bucket,
  BudgetMonthStatus,
  Category,
  Feed,
  FeedGroup,
  FundEntry,
  FundsOverview,
  FeedTestResult,
  FxRate,
  FxSnapshot,
  ImportResult,
  MonthReport,
  ParsedSms,
  RefreshResult,
  SmsMessage,
  Transaction,
  TransactionFilters,
  YearReport,
} from '@/types'

export const keys = {
  config: ['config'] as const,
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  transactions: ['transactions'] as const,
  buckets: ['buckets'] as const,
  budget: ['budget'] as const,
  reports: ['reports'] as const,
  messages: ['messages'] as const,
  fx: ['fx'] as const,
  feedGroups: ['feed-groups'] as const,
  articles: ['articles'] as const,
}

// Derived figures that any money change can move.
const MONEY_KEYS = [keys.budget, keys.reports] as const

/** Anything that changes money invalidates the summaries too. */
function useInvalidating<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: readonly (readonly string[])[],
  options?: UseMutationOptions<TData, Error, TVars>,
) {
  const queryClient = useQueryClient()
  return useMutation<TData, Error, TVars>({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      for (const key of [...invalidate, ...MONEY_KEYS]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      options?.onSuccess?.(...args)
    },
  })
}

/* -------------------------------------------------------------------- meta */

export function useConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: () => http.get<AppConfig>('/config'),
    staleTime: Infinity,
  })
}

function query(params: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      search.set(key, String(value))
    }
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

type Body = { id?: number } & Record<string, unknown>

/* ---------------------------------------------------------------- accounts */

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts,
    queryFn: () => http.get<AccountsOverview>('/accounts'),
  })
}

export function useSaveAccount() {
  return useInvalidating(
    ({ id, ...body }: Body) =>
      id ? http.patch(`/accounts/${id}`, body) : http.post('/accounts', body),
    [keys.accounts],
  )
}

export function useDeleteAccount() {
  return useInvalidating(
    (id: number) => http.del<void>(`/accounts/${id}`),
    [keys.accounts, keys.transactions],
  )
}

/* -------------------------------------------------------------- categories */

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => http.get<Category[]>('/categories'),
  })
}

export function useSaveCategory() {
  return useInvalidating(
    ({ id, ...body }: Body) =>
      id
        ? http.patch<Category>(`/categories/${id}`, body)
        : http.post<Category>('/categories', body),
    [keys.categories],
  )
}

export function useDeleteCategory() {
  return useInvalidating(
    (id: number) => http.del<void>(`/categories/${id}`),
    [keys.categories, keys.transactions],
  )
}

/* ------------------------------------------------------------ transactions */

export function useTransactions(filters: TransactionFilters) {
  const suffix = query(filters)
  return useQuery({
    queryKey: [...keys.transactions, suffix],
    queryFn: () => http.get<Transaction[]>(`/transactions${suffix}`),
  })
}

// A transaction moves balances, and may create a category (LLM) or a merchant rule.
const TXN_KEYS = [keys.transactions, keys.accounts, keys.categories] as const

export function useSaveTransaction() {
  return useInvalidating(
    ({ id, ...body }: Body) =>
      id
        ? http.patch<Transaction>(`/transactions/${id}`, body)
        : http.post<Transaction>('/transactions', body),
    TXN_KEYS,
  )
}

export function useDeleteTransaction() {
  return useInvalidating((id: number) => http.del<void>(`/transactions/${id}`), TXN_KEYS)
}

/* ------------------------------------------------------------------ budget */

export function useBuckets() {
  return useQuery({ queryKey: keys.buckets, queryFn: () => http.get<Bucket[]>('/budget/buckets') })
}

export function useSaveBucket() {
  return useInvalidating(
    ({ id, ...body }: Body) =>
      id
        ? http.patch<Bucket>(`/budget/buckets/${id}`, body)
        : http.post<Bucket>('/budget/buckets', body),
    [keys.buckets],
  )
}

export function useDeleteBucket() {
  return useInvalidating(
    (id: number) => http.del<void>(`/budget/buckets/${id}`),
    [keys.buckets, keys.categories, keys.accounts],
  )
}

export function useBudgetMonth(year: number, month: number) {
  return useQuery({
    queryKey: [...keys.budget, 'month', year, month],
    queryFn: () => http.get<BudgetMonthStatus>(`/budget/month?year=${year}&month=${month}`),
  })
}

export function useBudgetHistory(months = 12) {
  return useQuery({
    queryKey: [...keys.budget, 'history', months],
    queryFn: () => http.get<BudgetMonthStatus[]>(`/budget/history?months=${months}`),
  })
}

export function useSetIncomeBasis() {
  return useInvalidating(
    ({ year, month, income_basis }: { year: number; month: number; income_basis: number | null }) =>
      http.put<BudgetMonthStatus>(`/budget/month/${year}/${month}/basis`, { income_basis }),
    [],
  )
}

/* ------------------------------------------------------------------- funds */

type AllocationVars = { bucketId: number; year: number; month: number }

/** Tick a saving bucket's month: this much is set aside. */
export function useSetAllocation() {
  return useInvalidating(
    ({ bucketId, year, month, ...body }: AllocationVars & { amount: number; currency: string }) =>
      http.put<BudgetMonthStatus>(`/budget/allocations/${bucketId}/${year}/${month}`, body),
    [],
  )
}

export function useClearAllocation() {
  return useInvalidating(
    ({ bucketId, year, month }: AllocationVars) =>
      http.del<BudgetMonthStatus>(`/budget/allocations/${bucketId}/${year}/${month}`),
    [],
  )
}

export function useFunds() {
  return useQuery({
    queryKey: [...keys.budget, 'funds'],
    queryFn: () => http.get<FundsOverview>('/budget/funds'),
  })
}

export function useFundEntries(bucketId: number | null) {
  return useQuery({
    queryKey: [...keys.budget, 'fund-entries', bucketId],
    queryFn: () => http.get<FundEntry[]>(`/budget/funds/${bucketId}/entries`),
    enabled: bucketId !== null,
  })
}

/** A top-up or opening balance (positive), or money taken out (negative). */
export function useAddFundEntry() {
  return useInvalidating(
    ({ bucketId, ...body }: Body & { bucketId: number }) =>
      http.post<FundEntry>(`/budget/funds/${bucketId}/entries`, body),
    [],
  )
}

export function useDeleteFundEntry() {
  return useInvalidating((id: number) => http.del<void>(`/budget/funds/entries/${id}`), [])
}

/* ----------------------------------------------------------------- reports */

export function useMonthReport(year: number, month: number) {
  return useQuery({
    queryKey: [...keys.reports, 'month', year, month],
    queryFn: () => http.get<MonthReport>(`/reports/month?year=${year}&month=${month}`),
  })
}

export function useYearReport(year: number) {
  return useQuery({
    queryKey: [...keys.reports, 'year', year],
    queryFn: () => http.get<YearReport>(`/reports/year?year=${year}`),
  })
}

/* ------------------------------------------------------------------- inbox */

const MESSAGE_KEYS = [keys.messages, ...TXN_KEYS] as const

export function useMessages() {
  return useQuery({
    queryKey: keys.messages,
    queryFn: () => http.get<SmsMessage[]>('/messages'),
    // SMS arrive from the phone on their own, and `queued` ones flip to
    // processed a few seconds later once the LLM has read them.
    refetchInterval: 30_000,
  })
}

export function useRecordMessage() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & ParsedSms) =>
      http.post<SmsMessage>(`/messages/${id}/record`, body),
    MESSAGE_KEYS,
  )
}

export function useIgnoreMessage() {
  return useInvalidating(
    (id: number) => http.post<SmsMessage>(`/messages/${id}/ignore`),
    [keys.messages],
  )
}

export function useDeleteMessage() {
  return useInvalidating((id: number) => http.del<void>(`/messages/${id}`), [keys.messages])
}

export function useReprocessMessages() {
  return useInvalidating(
    () => http.post<{ checked: number; processed: number }>('/messages/reprocess'),
    MESSAGE_KEYS,
  )
}

/* -------------------------------------------------------------------- news */

const NEWS_KEYS = [keys.feedGroups, keys.articles] as const

export interface ArticleFilters {
  groupId?: number | null
  feedId?: number | null
  unreadOnly?: boolean
  savedOnly?: boolean
  search?: string
}

export function useFeedGroups() {
  return useQuery({
    queryKey: keys.feedGroups,
    queryFn: () => http.get<FeedGroup[]>('/feed-groups'),
  })
}

export function useArticles(filters: ArticleFilters = {}) {
  const search = new URLSearchParams()
  if (filters.groupId) search.set('group_id', String(filters.groupId))
  if (filters.feedId) search.set('feed_id', String(filters.feedId))
  if (filters.unreadOnly) search.set('unread_only', 'true')
  if (filters.savedOnly) search.set('saved_only', 'true')
  if (filters.search?.trim()) search.set('search', filters.search.trim())
  const suffix = search.toString() ? `?${search}` : ''

  return useQuery({
    queryKey: [...keys.articles, suffix],
    queryFn: () => http.get<Article[]>(`/articles${suffix}`),
  })
}

export function useRefreshNews() {
  return useInvalidating(
    (feedId?: number) =>
      http.post<RefreshResult>(`/news/refresh${feedId ? `?feed_id=${feedId}` : ''}`),
    NEWS_KEYS,
  )
}

export interface ImportPayload {
  content: string
  group_id?: number | null
  new_group_name?: string | null
  verify?: boolean
}

export function useImportFeeds() {
  return useInvalidating(
    (body: ImportPayload) => http.post<ImportResult>('/feeds/import', body),
    NEWS_KEYS,
  )
}

export function useTestFeed() {
  return useMutation<FeedTestResult, Error, string>({
    mutationFn: (url: string) => http.post<FeedTestResult>('/feeds/test', { url }),
  })
}

export function useCreateFeedGroup() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<FeedGroup>('/feed-groups', body),
    NEWS_KEYS,
  )
}

export function useUpdateFeedGroup() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<FeedGroup>(`/feed-groups/${id}`, body),
    NEWS_KEYS,
  )
}

export function useDeleteFeedGroup() {
  return useInvalidating((id: number) => http.del<void>(`/feed-groups/${id}`), NEWS_KEYS)
}

export function useCreateFeed() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<Feed>('/feeds', body),
    NEWS_KEYS,
  )
}

export function useUpdateFeed() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Feed>(`/feeds/${id}`, body),
    NEWS_KEYS,
  )
}

export function useDeleteFeed() {
  return useInvalidating((id: number) => http.del<void>(`/feeds/${id}`), NEWS_KEYS)
}

export function useUpdateArticle() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Article>(`/articles/${id}`, body),
    NEWS_KEYS,
  )
}

export function useMarkAllRead() {
  return useInvalidating(
    (body: { group_id?: number | null; feed_id?: number | null }) =>
      http.post<{ marked_read: number }>('/articles/mark-all-read', body),
    NEWS_KEYS,
  )
}

/* ---------------------------------------------------------------------- fx */

const FX_KEYS = [keys.fx, keys.accounts] as const

export function useFx() {
  return useQuery({ queryKey: keys.fx, queryFn: () => http.get<FxSnapshot>('/fx') })
}

export function useRefreshFx() {
  return useInvalidating(() => http.post<FxSnapshot>('/fx/refresh'), FX_KEYS)
}

export function useSetManualRate() {
  return useInvalidating(
    (body: { currency: string; rate: number }) => http.put<FxRate>('/fx/manual', body),
    FX_KEYS,
  )
}

export function useClearManualRate() {
  return useInvalidating(
    (currency: string) => http.del<{ detail: string }>(`/fx/manual/${currency}`),
    FX_KEYS,
  )
}
