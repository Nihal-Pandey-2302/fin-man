import { keepPreviousData, QueryCache, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Autopay, Bootstrap, Category, Cycle, Dashboard, Goal, Holding, Loan, Occurrence, Page, Report, Review, Rule, SalaryPlan, Savings, Settings, Txn } from "@shared/api";
import { api, ApiError, errorMessage } from "./api";

export type Session = { configured: boolean; authenticated: boolean };

/** A 401 from any call means the session is gone (expired, or the password changed): show the login screen. */
const signedOut = (err: unknown) => {
  if (!(err instanceof ApiError) || err.status !== 401) return false;
  queryClient.setQueryData<Session>(["session"], (s) => ({ configured: s?.configured ?? true, authenticated: false }));
  return true;
};

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err) => void signedOut(err) }),
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 1 },
    mutations: { onError: (err) => void (signedOut(err) || toast.error(errorMessage(err))) },
  },
});

export const useSession = () => useQuery({ queryKey: ["session"], queryFn: () => api<Session>("/auth/session"), staleTime: Infinity });

export const keys = {
  bootstrap: ["bootstrap"] as const,
  dashboard: ["dashboard"] as const,
  review: ["review"] as const,
  txns: (filters: TxnFilters) => ["transactions", filters] as const,
  rules: ["rules"] as const,
  cycles: ["cycles"] as const,
  autopays: ["autopays"] as const,
  loans: ["loans"] as const,
  holdings: ["holdings"] as const,
  salaryPlan: ["salary-plan"] as const,
  calendar: ["autopay-calendar"] as const,
  report: (start?: string) => ["report", start ?? "current"] as const,
  savings: ["savings"] as const,
  goals: ["goals"] as const,
};

/** Money moved: anything derived from the ledger is stale. */
export function invalidateLedger(qc = queryClient) {
  for (const key of [keys.bootstrap, keys.dashboard, keys.review, ["transactions"], keys.rules, keys.loans, keys.salaryPlan, keys.calendar, keys.autopays, keys.cycles, ["report"], keys.savings, keys.goals]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

export const useBootstrap = () => useQuery({ queryKey: keys.bootstrap, queryFn: () => api<Bootstrap>("/bootstrap") });
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api<Dashboard>("/dashboard") });
export const useReview = () => useQuery({ queryKey: keys.review, queryFn: () => api<Review>("/review") });
export const useRules = () => useQuery({ queryKey: keys.rules, queryFn: () => api<Rule[]>("/rules") });
export const useCycles = () => useQuery({ queryKey: keys.cycles, queryFn: () => api<(Cycle & { budgets: { categoryId: number; limitPaise: number }[] })[]>("/cycles") });
export const useAutopays = () => useQuery({ queryKey: keys.autopays, queryFn: () => api<Autopay[]>("/autopays") });
export const useLoans = () => useQuery({ queryKey: keys.loans, queryFn: () => api<Loan[]>("/loans") });
export const useSalaryPlan = () => useQuery({ queryKey: keys.salaryPlan, queryFn: () => api<SalaryPlan>("/salary-plan") });
export const useAutopayCalendar = () => useQuery({ queryKey: keys.calendar, queryFn: () => api<Occurrence[]>("/autopays/calendar") });
export const useReport = (start?: string) =>
  useQuery({ queryKey: keys.report(start), queryFn: () => api<Report>(`/report${start ? `?start=${start}` : ""}`), placeholderData: keepPreviousData });
export const useSavings = () => useQuery({ queryKey: keys.savings, queryFn: () => api<Savings>("/savings") });
export const useGoals = () => useQuery({ queryKey: keys.goals, queryFn: () => api<Goal[]>("/goals") });
export const useHoldings = () => useQuery({ queryKey: keys.holdings, queryFn: () => api<Holding[]>("/holdings") });

export type TxnFilters = {
  q?: string;
  accountId?: number;
  categoryId?: number | "none";
  kind?: Txn["kind"];
  status?: Txn["status"];
  from?: string;
  to?: string;
};

export function useTransactions(filters: TxnFilters) {
  return useInfiniteQuery({
    queryKey: keys.txns(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") params.set(k, String(v));
      if (pageParam) params.set("cursor", pageParam);
      return api<Page<Txn>>(`/transactions?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** Lookup helpers over the bootstrap bundle. */
export function useLookups() {
  const { data } = useBootstrap();
  const categories = data?.categories ?? [];
  const accounts = data?.accounts ?? [];
  return {
    data,
    categories,
    activeCategories: categories.filter((c) => !c.archived),
    accounts,
    activeAccounts: accounts.filter((a) => !a.archived),
    category: (id: number | null | undefined): Category | undefined => categories.find((c) => c.id === id),
    account: (id: number | null | undefined) => accounts.find((a) => a.id === id),
    settings: data?.settings as Settings | undefined,
  };
}

/** Mutation that refreshes ledger-derived queries afterwards and toasts on success. */
export function useLedgerMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, success?: string | ((r: TResult) => string | null)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      const msg = typeof success === "function" ? success(result) : success;
      if (msg) toast.success(msg);
    },
    onSettled: () => invalidateLedger(qc),
  });
}
