import { LoansManager, type Loan, type LoanPayment } from "@/components/loans-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function LoansPage() {
  const supabase = await createSupabaseServerClient();
  const [loansRes, paymentsRes] = await Promise.all([
    supabase
      .from("loans")
      .select("id, person_name, amount, type, reason, date, due_date, status, amount_paid, notes")
      .order("date", { ascending: false }),
    supabase
      .from("loan_payments")
      .select("id, loan_id, amount, date, note")
      .order("date", { ascending: false }),
  ]);

  return (
    <LoansManager
      initialLoans={(loansRes.data ?? []) as Loan[]}
      initialPayments={(paymentsRes.data ?? []) as LoanPayment[]}
    />
  );
}
