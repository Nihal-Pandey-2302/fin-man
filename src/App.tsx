import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import HomePage from "@/pages/home";

// Home ships in the main bundle (it's the first screen); everything else loads on demand.
const ActivityLayout = lazy(() => import("@/pages/activity").then((m) => ({ default: m.ActivityLayout })));
const TransactionsPage = lazy(() => import("@/pages/activity"));
const ReviewPage = lazy(() => import("@/pages/review"));
const PlanPage = lazy(() => import("@/pages/plan"));
const MorePage = lazy(() => import("@/pages/more"));
const AccountsPage = lazy(() => import("@/pages/accounts"));
const CategoriesPage = lazy(() => import("@/pages/categories"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const HoldingsPage = lazy(() => import("@/pages/holdings"));
const ReportPage = lazy(() => import("@/pages/report"));
const ImportPage = lazy(() => import("@/pages/import"));
const MerchantPage = lazy(() => import("@/pages/merchant"));

const fallback = (
  <div className="space-y-3">
    <Skeleton className="h-8 w-40" />
    <Skeleton className="h-40 rounded-xl" />
    <Skeleton className="h-40 rounded-xl" />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={fallback}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="activity" element={<ActivityLayout />}>
              <Route index element={<TransactionsPage />} />
              <Route path="review" element={<ReviewPage />} />
            </Route>
            <Route path="plan" element={<PlanPage />} />
            <Route path="plan/report" element={<ReportPage />} />
            <Route path="merchant/:key" element={<MerchantPage />} />
            <Route path="more">
              <Route index element={<MorePage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="holdings" element={<HoldingsPage />} />
              <Route path="import" element={<ImportPage />} />
            </Route>
            <Route path="*" element={<p className="py-20 text-center text-muted-foreground">That page doesn't exist.</p>} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
