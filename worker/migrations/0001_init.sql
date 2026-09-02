-- NimPulse Phase 2a schema.

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL CHECK (asset IN ('BTC', 'ETH', 'NIM')),
  question TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  resolves_at TEXT NOT NULL UNIQUE,
  open_price REAL,
  close_price REAL,
  outcome TEXT CHECK (outcome IN ('yes', 'no')),
  needs_retry INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT
);

CREATE TABLE picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  wallet_address TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (question_id, wallet_address)
);

CREATE TABLE duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  creator_wallet TEXT NOT NULL,
  creator_side TEXT NOT NULL CHECK (creator_side IN ('yes', 'no')),
  stake_luna INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'locked', 'resolved', 'settled', 'unpaid', 'expired')),
  opponent_wallet TEXT,
  opponent_side TEXT CHECK (opponent_side IN ('yes', 'no')),
  winner_wallet TEXT,
  memo_base TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE players (
  wallet_address TEXT PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  total_correct INTEGER NOT NULL DEFAULT 0,
  total_picks INTEGER NOT NULL DEFAULT 0,
  settled_wins INTEGER NOT NULL DEFAULT 0,
  settled_losses INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_picks_question ON picks(question_id);
CREATE INDEX idx_picks_wallet ON picks(wallet_address);
CREATE INDEX idx_questions_outcome ON questions(outcome, resolves_at);
