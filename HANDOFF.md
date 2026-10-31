# Handoff: fintrack revamp (overnight autonomous run)

Read this first if you're resuming after a context reset. Then read CLAUDE.md and PLAN.md.

## Mandate (from the owner, 2026-11-01 ~00:30 IST)
- Finish **Phase 1** of PLAN.md tonight, then continue into **Phase 2**. The owner is asleep and has granted permission to proceed without check-ins.
- Work on branch `revamp` and commit after each coherent chunk. **Pushing `revamp` is allowed** (owner, 00:40 IST), but the GitHub remote `fin-man` is PUBLIC: no personal data in commits.
- Keep resource use light: the owner has another build running. Run one heavy process at a time, always kill dev servers after checks, and don't use parallel agents.
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
- [x] 4. SMS ingest endpoint + parser framework + bank parsers + fixture tests (worker/sms/*, tests/parsers|ingest.test.ts)
- [x] 5. API: accounts (+numbers, balances), categories, rules, transactions, review, dashboard, cycles, autopays, presets, loans, holdings, settings, export, bootstrap (worker/routes/*, tests/api.test.ts)
- [x] 6. UI: all Phase 1 screens plus Plan (cycle, autopays, loans) and Holdings. Checked in headless Chrome at 390×844 and 1440×900 (script in the session scratchpad; puppeteer-core + /usr/bin/google-chrome).
- [x] 7. Matcher: transfers / card payments (worker/ledger/matcher.ts; runs on every SMS insert)
- [x] 8. PWA (vite-plugin-pwa, client env only; icons from public/icon.svg; NetworkFirst API cache). Offline reload verified. Routes code-split.
- [x] 9. `npm run backup` (scripts/backup.mjs; `-- --remote` for prod) + GET /api/export (Settings → Download backup)
- [x] 10. Review pass: code-review (medium) found 10 issues, all fixed with regression tests (tests/regressions.test.ts). Browser-checked.
- [ ] **Phase 2** (in progress), in this order:
  - [ ] a. Migration 0003 (append-only from now on): `transactions.autopay_id` FK and a `push_subscriptions` table. New setting `autopay_buffer_paise`.
  - [ ] b. worker/ledger/salary.ts `detectSalary(txnId)`. It qualifies a credit to the account with role=salary when it is explicitly incomeSource=salary, or when kind=income, amount ≥ salary_min_paise, the merchant contains salary_employer, and the IST day falls in the 28th–7th window. It then starts a cycle via `startCycle`, carrying the previous plannedSpend forward. If the latest cycle has no salaryTxnId and started ≤7 days before, that cycle is re-anchored instead. Hooked into ingest, POST /transactions and PATCH.
  - [ ] c. worker/ledger/autopays.ts. Matching: a debit on the same account, amount within ±1% (or matchHint/name found in the merchant), due within ±4 days, sets autopay_id, category, kind (sip→investment) and confirmed, then calls advanceAutopay. The Indian Bank "will be debited" notice updates the matching autopay's nextDueOn. A calendar endpoint lists occurrences in the cycle as paid/due/overdue.
  - [ ] d. worker/ledger/alerts.ts: salary missing (day ≥ 5 with no salary since the 28th), card due ≤ 3 days with outstanding > 0, autopay account short of the autopays still due, autopays due tomorrow. Exposed on /dashboard as `alerts`.
  - [ ] e. GET /api/salary-plan: card bill (card outstanding) from salary→card; top-up spending = plannedSpend − autopays due − spending balance; top-up autopay = autopays due on the autopay account + autopay buffer − its balance; keep = the rest. An item is done when a transfer/card_payment from→to totalling ≥95% of it exists since cycle start.
  - [ ] f. GET /api/report?start=YYYY-MM-DD: cycle totals (spend, income, invested), by category vs the previous cycle, top merchants, biggest spends.
  - [ ] g. Web push: VAPID keys in .dev.vars (`npm run vapid`), POST /api/push/subscribe, sending via a vetted lib if it runs on Workers (else WebCrypto), a daily cron `scheduled` 03:30 UTC (09:00 IST) that sends the alerts, and a service-worker push handler via workbox importScripts (public/push-sw.js).
  - [ ] h. UI: Home alert banners, a salary-plan card (Home when a cycle started ≤5 days ago, plus Plan), the autopay calendar in Plan, a Report page (/plan/report), and a notifications toggle in Settings.
  - [ ] i. Tests, code-review pass, browser check, then update CLAUDE.md, HANDOFF.md and PLAN.md.

## API notes
- Spending = expense + fee debits − refund credits. Transfers, card_payment, income and investment never count, and SIP autopays are excluded from "autopays still due".
- Dashboard: dailyAllowance = (budget − spent before today − non-SIP autopays due by cycle end) ÷ days left including today; leftToday = allowance − spent today.
- A cycle is the latest budget_cycles row with start ≤ today; an open one ends start+1 month−1. With no cycle, the calendar month with budget 0 is used.
- Balances: anchored on the newer of the latest SMS balance/available limit and the opening/manual correction (POST /accounts/:id/balance).
- GitHub push needs the noreply email: repo-local user.email = 127308117+Nihal-Pandey-2302@users.noreply.github.com (already set).

## UI notes / gotchas
- Chrome's `window.scrollTo` now returns a Promise, so never write `useEffect(() => window.scrollTo(...))` with an expression body: React treats the Promise as a cleanup and crashes ("destroy is not a function").
- next-themes was removed (React 19 warns about its injected <script>). The theme lives in src/components/theme.tsx, and an inline script in index.html applies it before first paint.
- shadcn now imports `cn` from the `cn` npm package. That is correct.
- Quick add must fit on a 390×844 screen without scrolling (keypad h-12, tiles min-h-14).

## Where things are
- Worker: `worker/index.ts` (Hono, basePath /api) · `worker/db/{schema,index}.ts` · `worker/sms/*` (ingest pipeline + parsers) · `worker/routes/*`
- Shared (worker + SPA): `shared/` (money, IST time, API types)
- SPA: `src/` (shell in `components/layout`, pages in `pages/`)
- Tests: `tests/` (Vitest inside workerd, fresh D1 per file)
