# Handoff: fintrack revamp (overnight autonomous run)

Read this first if you're resuming after a context reset. Then read CLAUDE.md and PLAN.md.

## Mandate (from the owner, 2026-11-01 ~00:30 IST)
- Finish **Phase 1** of PLAN.md tonight, then continue into **Phase 2**. The owner is asleep and has granted permission to proceed without check-ins.
- Work on branch `revamp` and commit after each coherent chunk. **Do not push** (the GitHub remote `fin-man` is PUBLIC).
- **Do not deploy**, use `--remote`, set secrets, or configure Cloudflare Access.
- The owner sends **SMS sender IDs tomorrow**. Until then, the sender→bank routing tokens in `worker/sms/senders.ts` are provisional, and parsing relies on body signatures.
- Fixtures must use fake digits and names. The repo is public.

## SMS samples received (real formats; fixtures are in tests/fixtures/sms/)
- **IDFC credit card**: one card with two numbers, RuPay (UPI) and Mastercard, sharing one limit. Format: `<Marketing phrase>! INR 380.00 spent on your IDFC FIRST Bank Credit Card ending XX1111 at Swiggy on 31 OCT 2026 at 08:28 PM Avbl Limit: INR 23109.86 If not done by you...`
- **IDFC bank**: `Your A/C XXXXX123456 is credited with INR 2,000.00 on 31/10/26 09:59. Your new balance is INR 3,360.00. Team IDFC FIRST Bank` · `Your A/c XX3456 debited by Rs. 2,396.00 on 30/10/26; HEY HABIBI credited. RRN 6303.... Available balance Rs. 1,360.00. Team IDFC FIRST Bank`
- **Indian Bank**: IMPS credit `Your a/c. XXXX2222 is credited by Rs. 99800.00 on 01-08-26 by a/c linked to mobile 9XXXXXX12345 (IMPS Ref no. ...). -IndianBank` · UPI debit `Sent Rs.1578.00 from A/c *2222 on 01-08-26 to NAME.RRN ....Avl Bal Rs.73156.45.Not you?...-Indian Bank` · UPI credit `Your A/c *2222 is credited with Rs.10000.00 on 29-08-26 by NAME. RRN .... Available balance is Rs. 12550.68 - Indian Bank` · autopay **notice** (not a txn) `Your account will be debited with Rs 5781.00 towards <biller> for the Autopay on 07-Aug-26.Pause mandate...`
- **HDFC** (multi-line): `Sent Rs.520.00\nFrom HDFC Bank A/C *4444\nTo HDFC SECURITIES LTD\nOn 27/10/26\nRef ...\nNot You?...` · `Credit Alert!\nRs.1000.00 credited to HDFC Bank A/c XX4444 on 30-10-26 from VPA *llet@phonepe (UPI ...)`
- **Owner's salary routine:** salary lands in HDFC. They then pay the card bill, send daily-spend money to IDFC and ~₹10k to Indian Bank for autopays, and keep the rest in HDFC.
- **Not yet seen:** salary NEFT credit, card "payment received", refund, ATM, NACH debit. These fall through to the review inbox as `unparsed`.

## Decisions made tonight
- Migrations were **regenerated** (nothing is deployed). `0000_init` holds the schema, `0001` seeds categories, `0002` seeds merchant rules. After deploy, migrations are append-only.
- `account_numbers` table: many last4s per account (the card has two). The real last4s are **not** in git; the owner enters them in the Accounts setup UI.
- `transactions.available_limit_paise` (card) and `transactions.channel` (upi|card|imps|neft|rtgs|atm|nach|cash|other).
- `sms_raw.parsed_json` stores parser output and notices.
- Parser routing tries every parser's specific regexes (body signatures), and sender tokens are only an allowlist. This is more robust than routing by sender alone while sender IDs are unconfirmed.
- Date-only SMS: use received_at if it falls on the same IST date, else that date at 12:00 IST.

## Progress
- [x] 1. CLAUDE.md + git (`revamp` branch; old app at tag `legacy-nextjs`)
- [x] 2. Scaffold (c37bf06)
- [x] 3. Schema + migrations (256053f, then regenerated tonight)
- [ ] 4. SMS ingest endpoint + parser framework + bank parsers + fixture tests
- [ ] 5. API: accounts (+numbers, balances), categories, rules, transactions, review, dashboard, cycles, autopays, presets, settings, export
- [ ] 6. UI: providers (react-query, theme, toasts), accounts setup, review inbox (swipe), quick add (keypad, 3 taps), dashboard, transactions list/edit, categories & rules, settings
- [ ] 7. Matcher: transfers / card payments (±2 days IST, owner names setting)
- [ ] 8. PWA (vite-plugin-pwa, icons), route code-splitting
- [ ] 9. `npm run backup` (wrangler d1 execute → JSON) + /api/export
- [ ] 10. Review pass (simplify / code-review), browser check with `run`
- [ ] Phase 2: salary detection → budget cycles, salary-day plan, autopay calendar + matching + low-balance warning, card reminders, monthly report

## Where things are
- Worker: `worker/index.ts` (Hono, basePath /api) · `worker/db/{schema,index}.ts` · `worker/sms/*` (ingest pipeline + parsers) · `worker/routes/*`
- Shared (worker + SPA): `shared/` (money, IST time, API types)
- SPA: `src/` (shell in `components/layout`, pages in `pages/`)
- Tests: `tests/` (Vitest inside workerd, fresh D1 per file)
