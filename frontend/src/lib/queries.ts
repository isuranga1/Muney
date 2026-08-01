import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'

import { http } from '@/lib/api'
import type {
  Account,
  AppConfig,
  Bank,
  DashboardSummary,
  Expense,
  ExpenseGroup,
  FxRate,
  FxSnapshot,
  Income,
  IncomeSource,
} from '@/types'

export const keys = {
  config: ['config'] as const,
  dashboard: ['dashboard'] as const,
  banks: ['banks'] as const,
  accounts: ['accounts'] as const,
  expenseGroups: ['expense-groups'] as const,
  expenses: ['expenses'] as const,
  incomeSources: ['income-sources'] as const,
  incomes: ['incomes'] as const,
  fx: ['fx'] as const,
}

/** Anything that changes money invalidates the dashboard too. */
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
      for (const key of [...invalidate, keys.dashboard]) {
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

export function useDashboard(params: { year?: number; month?: number } = {}) {
  const search = new URLSearchParams()
  if (params.year) search.set('year', String(params.year))
  if (params.month) search.set('month', String(params.month))
  const suffix = search.toString() ? `?${search}` : ''
  return useQuery({
    queryKey: [...keys.dashboard, suffix],
    queryFn: () => http.get<DashboardSummary>(`/dashboard${suffix}`),
  })
}

/* ------------------------------------------------------------------- banks */

export function useBanks() {
  return useQuery({ queryKey: keys.banks, queryFn: () => http.get<Bank[]>('/banks') })
}

export function useAccounts() {
  return useQuery({ queryKey: keys.accounts, queryFn: () => http.get<Account[]>('/accounts') })
}

export function useCreateBank() {
  return useInvalidating((body: Record<string, unknown>) => http.post<Bank>('/banks', body), [
    keys.banks,
  ])
}

export function useUpdateBank() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Bank>(`/banks/${id}`, body),
    [keys.banks],
  )
}

export function useDeleteBank() {
  return useInvalidating((id: number) => http.del<void>(`/banks/${id}`), [
    keys.banks,
    keys.accounts,
  ])
}

export function useCreateAccount() {
  return useInvalidating((body: Record<string, unknown>) => http.post<Account>('/accounts', body), [
    keys.banks,
    keys.accounts,
  ])
}

export function useUpdateAccount() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Account>(`/accounts/${id}`, body),
    [keys.banks, keys.accounts],
  )
}

export function useDeleteAccount() {
  return useInvalidating((id: number) => http.del<void>(`/accounts/${id}`), [
    keys.banks,
    keys.accounts,
  ])
}

/* ---------------------------------------------------------------- expenses */

export function useExpenseGroups() {
  return useQuery({
    queryKey: keys.expenseGroups,
    queryFn: () => http.get<ExpenseGroup[]>('/expense-groups'),
  })
}

export function useUngroupedExpenses() {
  return useQuery({
    queryKey: [...keys.expenses, 'ungrouped'],
    queryFn: () => http.get<Expense[]>('/expenses?ungrouped=true'),
  })
}

const EXPENSE_KEYS = [keys.expenseGroups, keys.expenses] as const

export function useCreateExpenseGroup() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<ExpenseGroup>('/expense-groups', body),
    EXPENSE_KEYS,
  )
}

export function useUpdateExpenseGroup() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<ExpenseGroup>(`/expense-groups/${id}`, body),
    EXPENSE_KEYS,
  )
}

export function useDeleteExpenseGroup() {
  return useInvalidating((id: number) => http.del<void>(`/expense-groups/${id}`), EXPENSE_KEYS)
}

export function useCreateExpense() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<Expense>('/expenses', body),
    EXPENSE_KEYS,
  )
}

export function useUpdateExpense() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Expense>(`/expenses/${id}`, body),
    EXPENSE_KEYS,
  )
}

export function useDeleteExpense() {
  return useInvalidating((id: number) => http.del<void>(`/expenses/${id}`), EXPENSE_KEYS)
}

export function useBulkExpenseStatus() {
  return useInvalidating(
    (body: { ids: number[]; status: string }) => http.post<Expense[]>('/expenses/bulk-status', body),
    EXPENSE_KEYS,
  )
}

/* ------------------------------------------------------------------ income */

export function useIncomeSources() {
  return useQuery({
    queryKey: keys.incomeSources,
    queryFn: () => http.get<IncomeSource[]>('/income-sources'),
  })
}

export function useUngroupedIncomes() {
  return useQuery({
    queryKey: [...keys.incomes, 'ungrouped'],
    queryFn: () => http.get<Income[]>('/incomes?ungrouped=true'),
  })
}

const INCOME_KEYS = [keys.incomeSources, keys.incomes] as const

export function useCreateIncomeSource() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<IncomeSource>('/income-sources', body),
    INCOME_KEYS,
  )
}

export function useUpdateIncomeSource() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<IncomeSource>(`/income-sources/${id}`, body),
    INCOME_KEYS,
  )
}

export function useDeleteIncomeSource() {
  return useInvalidating((id: number) => http.del<void>(`/income-sources/${id}`), INCOME_KEYS)
}

export function useCreateIncome() {
  return useInvalidating(
    (body: Record<string, unknown>) => http.post<Income>('/incomes', body),
    INCOME_KEYS,
  )
}

export function useUpdateIncome() {
  return useInvalidating(
    ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      http.patch<Income>(`/incomes/${id}`, body),
    INCOME_KEYS,
  )
}

export function useDeleteIncome() {
  return useInvalidating((id: number) => http.del<void>(`/incomes/${id}`), INCOME_KEYS)
}

export function useBulkIncomeStatus() {
  return useInvalidating(
    (body: { ids: number[]; status: string }) => http.post<Income[]>('/incomes/bulk-status', body),
    INCOME_KEYS,
  )
}

/* ---------------------------------------------------------------------- fx */

const FX_KEYS = [keys.fx, keys.banks, keys.accounts, keys.expenseGroups, keys.incomeSources] as const

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
