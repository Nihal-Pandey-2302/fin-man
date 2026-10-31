import { BrowserRouter, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/pages/home";
import { Placeholder } from "@/pages/placeholder";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route
            path="activity"
            element={<Placeholder title="Activity" description="Transactions and the review inbox." />}
          />
          <Route
            path="plan"
            element={<Placeholder title="Plan" description="Budgets, autopays, loans and IOUs." />}
          />
          <Route
            path="more"
            element={<Placeholder title="More" description="Accounts, holdings, categories and rules, import, settings." />}
          />
          <Route path="*" element={<Placeholder title="Not found" description="That page doesn't exist." />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
