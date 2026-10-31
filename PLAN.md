# fintrack — personal finance tracker (plan)

A rewrite, done in place in `~/Projects/finance-app`. It replaces the old Next.js + Supabase app there (preserved at git tag `legacy-nextjs`), which is reference only. Copy ideas from it, not code.

**Goal:** know where every rupee goes day to day, with almost no manual entry. Bank SMS alerts are the main data source.

---

## 1. Owner's setup (the app is single-user)

| Account | Role | Notes |
|---|---|---|
| **HDFC Bank** | Salary + savings | Salary lands any day from the 1st to the 5th of the month |
| **IDFC FIRST Bank** | Daily spending | Most UPI/card spends happen here |
| **Indian Bank** | Autopay | SIPs, bills, EMIs debit from here |
| **Credit card** | Liability | Backed by a fixed deposit (FD lien). Sends an SMS for spends **and** when a bill payment is received |

- **Phone:** Android.
- **Every bank sends an SMS per transaction.** Gmail alerts aren't used.
- **Mutual funds** (Groww, HDFC InvestRight) **and stocks** are entered **manually** for now, as basic holdings only.

---

## 2. Architecture

**Why not Supabase:** its free tier pauses inactive projects. This app needs a backend that is always on so SMS can arrive at any time, costs nothing, and never sleeps.

```
Bank SMS ──> Android phone ──(MacroDroid HTTP POST + secret)──> Cloudflare Worker /api/ingest/sms
                                                                   │
Browser / installed PWA <──── same Worker (static app + JSON API) ─┤
                                                                   └──> Cloudflare D1 (SQLite)
```

| Layer | Choice | Reason |
|---|---|---|
| Hosting + API | **Cloudflare Workers** (one Worker serves the static app and the API) | Free tier is far above what one user needs, and it never pauses |
| Database | **Cloudflare D1** (SQLite) | Free, managed, has point-in-time restore |
| API framework | **Hono** (TypeScript) | Small, runs natively on Workers |
| ORM / migrations | **Drizzle ORM** + drizzle-kit | Typed schema, SQL migrations committed to git |
| Frontend | **Vite + React + TypeScript**, Tailwind v4, shadcn/ui, Recharts | Plain static single-page app, no server-side rendering needed |
| "App" on Android | **PWA** (vite-plugin-pwa): installable, offline shell, web push for reminders | One codebase for both the website and the phone app |
| Auth | **Cloudflare Access** in front of the whole app (email one-time PIN or Google, allow only the owner's email) | No auth code to write. If Access is awkward on `workers.dev`, put the app on a cheap domain |
| SMS ingest auth | Access **bypass** on `/api/ingest/*`, plus a required `Authorization: Bearer <INGEST_SECRET>` (Worker secret) | The phone can't log in through Access |
| Tests | **Vitest**; SMS parsers tested against real (redacted) sample messages | Parsers are the riskiest part of the app |

**Data rules:**
- Store money as **integer paise**.
- Store all times in UTC and display them in **Asia/Kolkata**.
- Ingestion is **idempotent**: a SHA-256 hash of the SMS (sender + body) is unique, so a retried SMS never creates a duplicate.

**Backups:** D1 has built-in time travel. In addition, a weekly scheduled Worker exports JSON, and an `npm run backup` script pulls an export locally.

---

## 3. Data model (one ledger, no double counting)

```
accounts       id, name, institution (HDFC|IDFC|INDIAN|CARD|CASH), kind (bank|credit_card|cash|wallet),
               role (salary|spending|autopay|card|other), last4, opening_balance_paise,
               credit_limit_paise, statement_day, due_day, fd_lien_paise, archived
transactions   id, account_id, occurred_at, amount_paise (>0), direction (debit|credit),
               kind (expense|income|transfer|card_payment|refund|fee|interest|investment),
               category_id, merchant, counterparty_vpa, ref_no, balance_after_paise,
               source (sms|manual|import), sms_id, transfer_group_id, status (needs_review|confirmed),
               income_source (salary|freelance|hackathon|bounty|misc|other; income only),
               loan_id, note, created_at, updated_at
sms_raw        id, sender, body, received_at, hash UNIQUE, parse_status (parsed|unparsed|ignored|error),
               parser, error, created_at
categories     id, name, emoji, color, parent_id, is_essential
merchant_rules id, match (merchant/VPA substring or regex), category_id, kind_override, hits
autopays       id, name, kind (sip|bill|emi|subscription|insurance), account_id (usually Indian Bank),
               amount_paise, frequency (monthly|quarterly|yearly), day_of_month, next_due_on,
               active, match_hint
budget_cycles  id, start_date, end_date, salary_txn_id, income_paise, planned_spend_paise
category_budgets cycle_id, category_id, limit_paise
holdings       id, name, type (mutual_fund|stock|fd|ppf|other), platform, invested_paise,
               current_value_paise, updated_at          -- updated by hand for now
loans          id, person, direction (you_owe|they_owe), principal_paise, reason, opened_on,
               due_on, status (open|partially_paid|settled), note
loan_payments  id, loan_id, amount_paise, paid_on, transaction_id, note
quick_add_presets id, name, category_id, account_id, amount_paise (optional), note, sort_order, active
settings       key, value                               -- e.g. liquid_buffer_paise
```

Carried over from the old app (ideas, not code): loans/IOUs with partial repayments, quick-add presets, a liquid buffer kept out of safe-to-spend, income source types, and quarterly/yearly subscriptions. The old app's data is **not** migrated. This is a fresh start.

**Rules:**
- **Transfers between own accounts:** two rows (a debit and a credit) with the same `transfer_group_id`, `kind=transfer`. They never count as spending or income.
- **Credit card bill payment:** a debit from a bank account plus a "payment received" credit on the card, linked as `kind=card_payment`. Not an expense.
- **Card spending:** an expense on the card account. The card's outstanding balance = spends − payments.
- **Pairing:** the matcher pairs transfers and card payments automatically by amount and a ±2-day window. Pairs it isn't sure about go to the review inbox.

---

## 4. SMS ingestion

**On the phone (MacroDroid, free tier is enough):**
- **Trigger:** SMS received from a sender containing `HDFCBK`, `IDFCFB`, the Indian Bank ID, or the card issuer's ID. Confirm the exact sender IDs from the phone.
- **Constraint:** the body does **not** contain `OTP`, `one time password` or `verification code`. OTPs never leave the phone.
- **Action:** HTTP POST to `https://<app>/api/ingest/sms` with JSON `{sender, body, received_at}` and the bearer header. Retry when the network is unavailable.
- **Safety net:** an `SMS Backup & Restore` XML export can be uploaded on an Import page. It backfills any missed messages, and the hash prevents duplicates.

**On the server:**
1. Store every SMS in `sms_raw`, even if parsing fails.
2. Drop OTP and promotional messages again on the server (`ignored`). **An OTP's body is blanked before it's stored**, so OTP text never reaches D1.
3. Accept only known bank/card sender IDs. Anything else is rejected and not stored.
4. **Normalize the sender before hashing:** strip the operator/circle prefix and the TRAI suffix (`VM-HDFCBK-S` becomes `HDFCBK`). The same message from MacroDroid and from a backup import then hashes the same.
5. Choose a parser by sender. There is one module per bank (`parsers/hdfc.ts`, `parsers/idfc.ts`, `parsers/indian.ts`, `parsers/card.ts`). Each extracts amount, debit/credit, last4, merchant/VPA, reference number, balance and date.
6. Auto-categorize with `merchant_rules`. Each time the owner re-categorizes a transaction, a rule is created or updated.
7. Anything unparsed or low-confidence goes to the **Review inbox**. Unparsed SMS are shown as-is with a "create transaction" form.

**Parser test fixtures:** `tests/fixtures/sms/<bank>/*.txt`. They are real messages with names and account numbers redacted. Message types needed:
- UPI debit
- UPI credit
- card spend
- ATM
- NEFT/IMPS credit (salary)
- autopay/NACH debit
- refund
- card payment received
- low-balance or other informational messages, which must be ignored

---

## 5. Features by phase

### UI/UX (applies to every phase)
One responsive app, designed **phone-first**: it must be just as good on a phone as a PWA or in a browser, and on a laptop for monitoring and adding.
- **Phone (< 1024px):** bottom tab bar (Home · Activity · **Add** · Plan · More), with Add as a big centre button that opens quick add as a bottom sheet. Primary actions sit in the thumb zone. Tap targets are at least 44px. Number keypad for amounts. Swipe actions in the review inbox. Respect safe-area insets.
- **Laptop (≥ 1024px):** left sidebar with the same sections, a wider dashboard grid, and dense sortable tables for transactions. Keyboard shortcuts (`n` = quick add, `/` = search).
- **Sections:** Home (today/cycle, safe-to-spend, balances, card due) · Activity (transactions + review inbox badge) · Plan (budgets, autopays, loans/IOUs) · More (accounts, holdings, categories and rules, import, settings).
- Dark-first with a light theme, amounts in tabular numerals, ₹ with Indian grouping, and skeletons instead of spinners.

### Phase 1: daily spending (MVP)
1. Scaffold: Vite + React + Hono Worker + D1 + Drizzle, deployed with `wrangler`, behind Cloudflare Access.
2. Accounts setup: the four accounts above plus Cash.
3. SMS ingest endpoint, the four parsers with fixture tests, and the review inbox (swipe to confirm, pick a category).
4. **Quick add** for cash spends: amount → category → save in 3 taps. Big buttons, works one-handed.
5. **Today / This cycle dashboard:**
   - spent so far against the cycle budget
   - **safe-to-spend per day** = (cycle budget − spent − autopays still due) ÷ days left
   - balance of each account (from the latest SMS balance, with manual correction)
   - card outstanding and due date
6. Transactions list: search, filter by account, category or date, edit, delete, add a note.
7. Categories and merchant rules management.

### Phase 2: salary cycle and autopay
1. **Salary detection:** an NEFT/IMPS credit to HDFC between the 28th and the 7th, above a threshold, matching the employer name. It starts a new `budget_cycle`. If no salary has arrived by the 5th, send a reminder.
2. **Salary-day plan screen:** "Move ₹X to IDFC (spending budget) and ₹Y to Indian Bank (autopays due this cycle + buffer). Keep ₹Z in HDFC savings." Marked done when the matching transfers arrive.
3. **Autopay calendar** for Indian Bank. Incoming debits are matched to autopays to mark them paid. A **low-balance warning** fires if the Indian Bank balance is below the autopays still due.
4. **Card reminders:** statement date and due date, using web push and an in-app banner.
5. Monthly report: spend by category, top merchants, comparison with the previous cycle.

### Phase 3: nice to have
- Holdings page (manual mutual funds, stocks, FD, PPF) and a net-worth view. The FD lien shows as locked.
- CSV/JSON export and import, and the SMS backup XML import.
- Optional native Android companion app (Kotlin) that reads SMS directly and queues them with retries, replacing MacroDroid.

---

## 6. Non-goals (for now)
- Account Aggregator / live bank APIs: they aren't available to personal apps.
- Automatic mutual fund or stock syncing and live prices.
- Multi-user support.

## 7. Definition of done for Phase 1
- A real HDFC/IDFC/Indian Bank/card SMS on the phone appears as a categorized transaction within about 10 seconds.
- Transfers between own accounts and card bill payments don't show up as spending.
- Every parser fixture passes `npm test`.
- The app is installable on Android from Chrome and protected by Cloudflare Access.
- `npm run backup` produces a local JSON export.
