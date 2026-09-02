# NimPulse API Worker

The backend for NimPulse lives in `worker/`. It is a Cloudflare Worker
("nimpulse-api") with a D1 database, deployed at:

https://nimpulse-api.nimpulse-api.workers.dev

The frontend on Vercel calls it cross-origin. CORS allows
`https://nimpulse.vercel.app` only.

## Run locally

Requires an authenticated `wrangler` (run `wrangler login` once).

```bash
cd worker
npm install
npm run migrate:local     # apply D1 migrations to the local database
npm run dev               # wrangler dev --test-scheduled on port 8787
```

With `--test-scheduled` you can trigger the cron handlers manually:

```bash
curl "http://localhost:8787/__scheduled?cron=5+0+*+*+*"   # question generation
curl "http://localhost:8787/__scheduled?cron=10+0+*+*+*"  # resolution pass
```

## Migrations

Migrations live in `worker/migrations/` and are plain SQL.

```bash
npm run migrate:local    # local development database
npm run migrate:remote   # production database
```

The D1 database is named `nimpulse`. The database id lives in
`worker/wrangler.toml`, which is safe to commit (it is not a secret).

## Cron schedule

- `5 0 * * *` (00:05 UTC): create the next day's question. Assets rotate
  BTC, ETH, NIM by resolution date. Questions open immediately when
  created by the cron, and pre-seeded future questions open at their
  calendar midnight.
- `10 0 * * *` (00:10 UTC): resolve every question past its resolve time.
  Duel statuses update on resolution: open duels without an opponent
  become expired, locked duels become resolved with winner_wallet set
  from the outcome. Idempotent.
  Open and close prices come from the CoinGecko history endpoint (00:00
  UTC snapshots). Strictly greater close than open means YES, anything
  else means NO, so ties count as NO. Each price fetch gets one retry.
  If a price source fails, the question is flagged `needs_retry` and the
  next cron pass tries again. No outcome is ever guessed.

Question rows are created by the shared, idempotent generation logic.
Besides the daily cron, it runs once when the worker first sees an empty
question table (first request after a deploy), seeding today's and
tomorrow's question so the app is testable immediately. Prices and
outcomes only ever come from the resolution cron and CoinGecko.

## Endpoints

- `GET /api/today` current open question with time remaining, plus the
  most recent resolved question. Optional `?wallet=NQ...` adds your pick
  and your player stats.
- `POST /api/duels` create a free duel for the current daily question.
  Requires a locked daily pick on the same side. Idempotent per memo
  base. Signature over
  `NimPulse duel create: [question_id] [side] [wallet] [memo_base] [resolves_at]`.
- `GET /api/duels/:id` duel state (open, locked, resolved, expired) with
  masked wallets. Optional `?wallet=NQ...` adds the viewer role and side.
- `POST /api/duels/:id/join` join an open duel with the opposite side.
  Signature over
  `NimPulse duel join: [duel_id] [question_id] [side] [wallet] [resolves_at]`.
  Duel proofs live in the `duel_proofs` table (migration 0002). No NIM
  moves in Phase 2b: stakes stay 0, nothing settles or pays.
- `POST /api/pick` body: `questionId`, `side`, `wallet`, `expiresAt`,
  `publicKey`, `signature`. The signature is Ed25519 over the Nimiq
  signed message envelope of the canonical message
  `NimPulse pick: [question_id] [side] [wallet] [expires_at]`. The
  worker verifies the signature, derives the wallet address from the
  public key, rejects mismatches, closed questions, and duplicate picks.
- `GET /api/leaderboard` top players by best streak and settled record,
  wallets masked to the first 6 and last 4 characters.
- `GET /api/health` question count and last resolution time.

## Signature verification note

The task brief and the nimquest README mention `@nimiq/core` for
server-side verification. That library cannot run inside a Cloudflare
Worker: its builds spin up web workers or worker_threads and its wasm
startup fails in workerd (verified during development). The nimquest
repository's deployed worker code reaches the same conclusion and uses
WebCrypto Ed25519 plus `@noble/hashes` blake2b. NimPulse follows that
proven implementation in `worker/src/verify.ts`.
