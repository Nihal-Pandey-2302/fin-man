// Split with friends, and their paybacks: your spending is your share; their part is an IOU that their UPI
// payment settles (neither income nor spending).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Dashboard, Txn } from "../shared/api";
import { personMatches } from "../worker/ledger/loans";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const now = () => new Date().toISOString();
const pay = (accountId: number, amountPaise: number, merchant: string) =>
  json<Txn>(api("/transactions", { method: "POST", json: { accountId, amountPaise, direction: "debit", kind: "expense", merchant, occurredAt: now() } }));
const receive = (accountId: number, amountPaise: number, merchant: string) =>
  json<Txn>(api("/transactions", { method: "POST", json: { accountId, amountPaise, direction: "credit", kind: "income", merchant, occurredAt: now() } }));
const loanRows = () => db.select().from(schema.loans).orderBy(schema.loans.id).all();
const txn = async (id: number) => (await db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get())!;
const spent = async () => (await json<Dashboard>(api("/dashboard"))).cycle.spentPaise;
beforeEach(async () => {
  await resetLedger();
});

describe("matching a friend's name", () => {
  it("accepts the bank's longer or truncated spelling, never a different person", () => {
    expect(personMatches("RAHUL SHARMA", "Rahul")).toBe(true);
    expect(personMatches("RAHUL SHARMA", "Rahul S")).toBe(true);
    expect(personMatches("ANSHIKA SRIVASTAV", "Anshika Srivastava")).toBe(true); // bank-truncated
    expect(personMatches("RAHUL SHARMA", "Rohit")).toBe(false);
    expect(personMatches("RAHUL SHARMA", "Rahul Kumar")).toBe(false);
  });
});

describe("split with friends", () => {
  it("counts only your share, and a friend's UPI payback settles their IOU without being income", async () => {
    const { idfc, indian } = await seedAccounts();
    const dinner = await pay(idfc.id, 120_000, "BARBEQUE NATION");
    expect(await spent()).toBe(120_000);

    const split = await json<Txn>(api(`/transactions/${dinner.id}/split`, { method: "PUT", json: { friends: [{ person: "Priya", amountPaise: 40_000 }, { person: "Amit", amountPaise: 40_000 }] } }));
    expect(split.sharePaise).toBe(40_000);
    expect(await spent()).toBe(40_000);
    expect((await loanRows()).map((l) => [l.person, l.direction, l.principalPaise, l.status, l.splitTxnId])).toEqual([
      ["Priya", "they_owe", 40_000, "open", dinner.id],
      ["Amit", "they_owe", 40_000, "open", dinner.id],
    ]);

    // Priya pays back by UPI: the real Indian Bank format ("… credited … by PRIYA SHARMA").
    const back = fixture("indian/upi_credit.txt").replace("Rs.10000.00", "Rs.400.00");
    const out = await json<{ transactionId: number }>(postSms("BV-INDBNK-S", back));
    const t = await txn(out.transactionId);
    expect(t).toMatchObject({ accountId: indian.id, kind: "transfer", loanId: (await loanRows())[0].id, categoryId: null, status: "confirmed" });
    expect((await loanRows())[0].status).toBe("settled");
    // Not income, not spending.
    expect(await spent()).toBe(40_000);
    const income = await db.select().from(schema.transactions).where(eq(schema.transactions.kind, "income")).all();
    expect(income).toHaveLength(0);

    // Amit pays in two goes.
    await receive(idfc.id, 30_000, "AMIT VERMA");
    expect((await loanRows())[1].status).toBe("partially_paid");
    await receive(idfc.id, 10_000, "AMIT VERMA");
    expect((await loanRows())[1].status).toBe("settled");

    // Someone paid back, so the split can't be removed any more.
    expect((await api(`/transactions/${dinner.id}/split`, { method: "DELETE" })).status).toBe(409);
  });

  it("doesn't guess: an unknown name, two possible friends, or too much money stay as income", async () => {
    const { idfc } = await seedAccounts();
    const trip = await pay(idfc.id, 300_000, "MAKEMYTRIP");
    await api(`/transactions/${trip.id}/split`, { method: "PUT", json: { friends: [{ person: "Rahul", amountPaise: 100_000 }, { person: "Rahul K", amountPaise: 100_000 }] } });
    expect((await receive(idfc.id, 100_000, "RAHUL KUMAR")).kind).toBe("income"); // both Rahuls fit
    expect((await receive(idfc.id, 50_000, "SNEHA")).kind).toBe("income");

    const lunch = await pay(idfc.id, 60_000, "CAFE");
    await api(`/transactions/${lunch.id}/split`, { method: "PUT", json: { friends: [{ person: "Neha", amountPaise: 30_000 }] } });
    expect((await receive(idfc.id, 90_000, "NEHA GUPTA")).kind).toBe("income"); // more than owed
  });

  it("links a payback by hand, and undoes it on unlink, delete or edit", async () => {
    const { idfc } = await seedAccounts();
    const bill = await pay(idfc.id, 90_000, "PVR CINEMAS");
    await api(`/transactions/${bill.id}/split`, { method: "PUT", json: { friends: [{ person: "Sneha", amountPaise: 30_000 }] } });
    const [loan] = await loanRows();
    // Paid from her brother's account: no name match, so link it by hand.
    const money = await receive(idfc.id, 30_000, "ARJUN MEHTA");
    expect(money.kind).toBe("income");
    expect(await json<Txn>(api(`/transactions/${money.id}/repayment`, { method: "PUT", json: { loanId: loan.id } }))).toMatchObject({ kind: "transfer", loanId: loan.id });
    expect((await loanRows())[0].status).toBe("settled");

    await api(`/transactions/${money.id}/repayment`, { method: "DELETE" });
    expect((await loanRows())[0].status).toBe("open");
    expect(await txn(money.id)).toMatchObject({ kind: "income", loanId: null, status: "needs_review" });

    await api(`/transactions/${money.id}/repayment`, { method: "PUT", json: { loanId: loan.id } });
    await api(`/transactions/${money.id}`, { method: "DELETE" });
    expect((await loanRows())[0].status).toBe("open");

    // Debit can't pay back money owed to you.
    const wrong = await pay(idfc.id, 1_000, "X");
    expect((await api(`/transactions/${wrong.id}/repayment`, { method: "PUT", json: { loanId: loan.id } })).status).toBe(409);
  });

  it("keeps the share in step when the payment's amount is corrected, and can be removed before any payback", async () => {
    const { idfc } = await seedAccounts();
    const bill = await pay(idfc.id, 90_000, "PIZZA");
    await api(`/transactions/${bill.id}/split`, { method: "PUT", json: { friends: [{ person: "Sneha", amountPaise: 30_000 }] } });
    await api(`/transactions/${bill.id}`, { method: "PATCH", json: { amountPaise: 99_000 } });
    expect((await txn(bill.id)).sharePaise).toBe(69_000);
    // Friends' parts can't exceed the payment.
    expect((await api(`/transactions/${bill.id}/split`, { method: "PUT", json: { friends: [{ person: "A", amountPaise: 100_000 }] } })).status).toBe(409);

    await api(`/transactions/${bill.id}/split`, { method: "DELETE" });
    expect(await loanRows()).toEqual([]);
    expect((await txn(bill.id)).sharePaise).toBeNull();
    expect(await spent()).toBe(99_000);
  });
});
