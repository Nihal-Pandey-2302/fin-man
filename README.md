# Finance Terminal

Dark-first personal finance app built with Next.js + Supabase.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file and fill Supabase values:

```bash
cp .env.example .env.local
```

3. Run app:

```bash
npm run dev
```

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (optional fallback)

## Database migrations

Apply local migrations to linked Supabase project:

```bash
npx supabase db push
```

## Deploy (Vercel)

1. Import repository in Vercel.
2. Add the same env variables from `.env.example`.
3. Deploy.
