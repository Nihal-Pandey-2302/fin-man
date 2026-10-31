# fintrack

Single-user personal finance tracker. Bank SMS alerts are the main data source. Full spec: [PLAN.md](PLAN.md). Read it before making product decisions.

This repo used to hold a Next.js + Supabase app ("Finance Terminal"), which is being replaced in place on the `revamp` branch. The old code is preserved at git tag `legacy-nextjs`. Treat it as a source of ideas only (e.g. `git show legacy-nextjs:lib/autopay-engine.ts`). Don't port its code: it used float `numeric` amounts, server-local dates, and non-idempotent autopay inserts, all of which the rules below forbid.

## Stack

- **One Cloudflare Worker** serves both the static SPA and the JSON API.
- **API:** Hono (TypeScript) on Workers.
- **DB:** Cloudflare D1 (SQLite). **ORM/migrations:** Drizzle ORM + drizzle-kit, with SQL migrations committed to git.
- **Frontend:** Vite + React + TypeScript, Tailwind v4, shadcn/ui, Recharts. Plain SPA, no SSR, no Next.js.
- **PWA:** vite-plugin-pwa (installable on Android, offline shell, web push).
- **Auth:** Cloudflare Access in front of everything, with no app-level auth code. `/api/ingest/*` bypasses Access and requires `Authorization: Bearer <INGEST_SECRET>` (a Worker secret).
- **Tests:** Vitest. SMS parsers are tested against real, redacted fixtures in `tests/fixtures/sms/<bank>/*.txt`.
- **Tooling:** Node 24 + npm, using `npx wrangler` (local devDependency, not a global install).

## Commands

First run: `npm install && cp .dev.vars.example .dev.vars && npm run db:migrate`.

- `npm run dev`: Vite + HMR, with the Worker running inside workerd via `@cloudflare/vite-plugin`, on one origin. The default URL is <http://localhost:5173>.
- `npm run preview`: production build served by `wrangler dev` (<http://localhost:8787>).
- `npm test` / `npm run test:watch`: Vitest inside workerd (`@cloudflare/vitest-plugin`). Each test file gets a fresh D1 with all migrations applied.
- `npm run typecheck` · `npm run lint` (oxlint) · `npm run build`
- `npm run db:generate`: drizzle-kit turns `worker/db/schema.ts` into SQL in `migrations/`. `npm run db:migrate` applies it to the **local** D1.
- `npm run backup`: dumps every table to `backups/fintrack-local-<time>.json` (gitignored). Add `-- --remote` to dump the deployed D1 instead, using your wrangler login.
- `npm run pwa-assets`: regenerate PWA icons from `public/icon.svg`.
- `npm run vapid`: generate VAPID keys for web push into `.dev.vars`.
- `npm run cf-typegen`: regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` or `.dev.vars`.
- There is intentionally no `deploy` script yet (see Guardrails).

Both dev servers share the local D1 in `.wrangler/state`. Delete that folder to reset local data.

## Layout

- `worker/`: Hono API, mounted at `/api/*` (`run_worker_first`). Everything else is the SPA, served with SPA fallback. `index.ts` default-exports `{ fetch, scheduled }`, and the daily cron (09:00 IST) runs `daily.ts`.
  - `db/`: Drizzle schema plus `getDb()`.
  - `sms/`: the ingest pipeline. `normalize` handles sender/body/hash, `classify` handles OTP/promo, `senders` is the allowlist, `parsers/*` holds one module per bank, and `ingest.ts` runs store → parse → resolve account → rules → settle.
  - `ledger/`: domain logic.
    - `settle.ts` orders what happens to each new transaction: salary, then autopay match, then transfer pairing.
    - `salary`, `autopays` (match/calendar/heads-ups), `matcher` (transfers, owner names), `rules`.
    - `balances`, `cycles`, `dashboard` (`SPEND` is the single definition of spending), `alerts`, `salary-plan`, `report`, `settings`.
  - `routes/`: thin Hono routers with zod validation. `push.ts` holds web push (VAPID).
- `shared/`: code used by both Worker and SPA: `money` (paise), `time` (IST), and `api` (DTO types; the SPA imports these as `@shared/*`).
- `src/`: React SPA. `components/ui/` is shadcn-generated (edit freely, but regenerate with `npx shadcn add`). `components/layout/` holds the responsive shell. `pages/` has one file per route.
- `migrations/`: generated SQL, committed, applied by wrangler.
- `tests/`: Vitest. Parser fixtures go in `tests/fixtures/sms/<bank>/`, and `helpers.ts` has `api()`, `postSms()`, `seedAccounts()` and `resetLedger()`.
- Every new transaction must go through `settleNewTransaction`. Every edit or delete must undo what that set up (`unpairGroup`, `unmatchAutopay`, `unlinkSalary`); see `updateTxn`.
- Workers free plan: ~10 ms CPU per request. Keep request handlers I/O-bound and batch heavy work (the SMS import sends batches of 20).
- shadcn's `cn` comes from the `cn` npm package (the new shadcn default), not a local clsx/tailwind-merge helper.
- Versions: Vite 8, React 19, react-router 8, Tailwind 4, TypeScript 6.0 (pinned to match Cloudflare's template, not TS 7), Vitest 5.

## Data rules (non-negotiable)

- **Money is integer paise** everywhere: DB columns (`*_paise`), API payloads, and arithmetic. Parse amount strings like `Rs.1,23,456.78` / `INR 500` by string manipulation into paise. Never use `parseFloat(x) * 100`. Convert to ₹ only for display, and use Indian digit grouping there (`en-IN`).
- **Amounts are always positive.** `amount_paise > 0`, and the sign lives in `direction` (`debit` | `credit`).
- **Times are stored in UTC** (ISO-8601 or epoch ms, consistently) and **displayed in `Asia/Kolkata`**. Day and cycle boundaries ("today", the salary window, `day_of_month`, the ±2-day pairing window) are computed in IST, not UTC or the server's local time. Bank SMS dates/times are IST: convert them to UTC on parse.
- **SMS ingest is idempotent.** `sms_raw.hash` is UNIQUE and equals SHA-256 of the normalized sender plus the body. A retry (MacroDroid resend or backup-XML import) must hit the unique constraint and return success without creating anything. Ingest must never create a transaction twice for one `sms_raw` row.
- **Every SMS is stored in `sms_raw`**, even when parsing fails (`parse_status` = `parsed` | `unparsed` | `ignored` | `error`). OTP and promotional messages are dropped again on the server as `ignored`.

- **Storage conventions** (see `worker/db/schema.ts`, which is the source of truth for the data model; PLAN.md §3 was the sketch):
  - Instants are integer epoch ms (`timestamp_ms`, so they are `Date` in TS).
  - Calendar dates (cycle start, due/paid/opened dates) are `YYYY-MM-DD` text, already in IST.
  - TS keys are camelCase and SQL columns are snake_case via `casing: "snake_case"`. Always get the client from `getDb()` in `worker/db/index.ts`, never call `drizzle()` directly.
  - Enums are enforced by CHECK constraints in the DB, not just in TS.

## Ledger rules (one ledger, no double counting)

- **Own-account transfer:** two rows, a debit and a credit, with the same `transfer_group_id`, both `kind=transfer`. Never counted as spending or income.
- **Card bill payment:** a bank debit plus a card "payment received" credit, linked, both `kind=card_payment`. Not an expense.
- **Card spend:** `kind=expense` on the card account. Card outstanding = spends − payments.
- **Pairing:** the matcher auto-pairs transfers and card payments by equal amount within ±2 days (IST). Uncertain pairs go to the review inbox (`status=needs_review`) and are never force-paired.
- **Spending and income totals exclude** `transfer` and `card_payment` by construction. Any aggregate query must filter on `kind`, not just `direction`.
- **Account balances are derived** from transactions and the latest SMS `balance_after_paise`. They are never kept as a mutable counter updated read-modify-write, as the old app did.

## SMS parsers

- One module per bank: `parsers/hdfc.ts`, `parsers/idfc.ts`, `parsers/indian.ts`, `parsers/card.ts`. The parser is chosen by sender ID. Each extracts amount, direction, last4, merchant/VPA, ref no, balance, and date.
- **Never guess SMS formats.** Every regex must be backed by a real redacted fixture. If no fixture exists for a message type, ask the owner for one.
- Unparsed or low-confidence messages go to the review inbox, not to a best-guess transaction.
- Merchant categorization goes through `merchant_rules`. Re-categorizing a transaction creates or updates a rule.

## Guardrails

- **Do not deploy** (`wrangler deploy`), touch remote D1 (`--remote`), set Worker secrets, or configure Cloudflare Access unless the owner explicitly says so. Local dev (`wrangler dev` + local D1) must work fully offline.
- Never commit secrets (`.dev.vars`, `.env*`) or unredacted SMS (real names, full account numbers, balances tied to identity). Fixtures must be redacted.
- OTPs must never leave the phone. Treat any OTP that reaches the server as a bug: store it as `ignored`.
- Schema changes go through drizzle-kit migrations. Never hand-edit an applied migration.
