-- Phase 2b: duel proof storage and memo uniqueness.
-- The duels table itself already exists from migration 0001.

CREATE TABLE duel_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id),
  wallet_address TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('creator', 'opponent')),
  side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (duel_id, wallet_address),
  UNIQUE (duel_id, role)
);

-- Safe for existing data: no duels exist before Phase 2b, so memo_base
-- is unique. memo_base is the client nonce now and the basis for future
-- payment memos in Phase 3.
CREATE UNIQUE INDEX IF NOT EXISTS idx_duels_memo_base ON duels(memo_base);
