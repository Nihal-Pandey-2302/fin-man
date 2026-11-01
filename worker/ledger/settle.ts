import type { Db } from "../db";
import { matchAutopay } from "./autopays";
import { matchRepayment } from "./loans";
import { pairTransaction } from "./matcher";
import { detectSalary } from "./salary";

/**
 * What happens to every new transaction, in priority order: a salary credit starts a cycle; a debit that
 * pays a scheduled autopay marks it paid; money from/to a friend with an open IOU pays it back; otherwise
 * try to pair it as a transfer / card bill payment.
 */
export async function settleNewTransaction(db: Db, txnId: number): Promise<"salary" | "autopay" | "repayment" | "paired" | "none"> {
  if (await detectSalary(db, txnId)) return "salary";
  if (await matchAutopay(db, txnId)) return "autopay";
  if (await matchRepayment(db, txnId)) return "repayment";
  return (await pairTransaction(db, txnId)).paired ? "paired" : "none";
}
