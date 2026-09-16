-- Expand the market rotation beyond BTC, ETH, NIM. SQLite cannot alter a
-- CHECK constraint, so the questions table is rebuilt once. Asset values
-- come only from the server-side ROTATION constant, so the rebuilt table
-- keeps NOT NULL but drops the asset whitelist: future market additions
-- need no schema change. Child rows (picks, duels, duel_proofs) are backed
-- up and emptied before the parent drop so no intermediate state violates
-- an immediate foreign key. All rows and ids are preserved.

CREATE TABLE questions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL,
  question TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  resolves_at TEXT NOT NULL UNIQUE,
  open_price REAL,
  close_price REAL,
  outcome TEXT CHECK (outcome IN ('yes', 'no')),
  needs_retry INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  price_source TEXT
);

INSERT INTO questions_new (id, asset, question, opens_at, resolves_at,
                           open_price, close_price, outcome, needs_retry,
                           resolved_at, price_source)
SELECT id, asset, question, opens_at, resolves_at,
       open_price, close_price, outcome, needs_retry,
       resolved_at, price_source
FROM questions;

CREATE TABLE _mig_picks AS SELECT * FROM picks;
CREATE TABLE _mig_duels AS SELECT * FROM duels;
CREATE TABLE _mig_duel_proofs AS SELECT * FROM duel_proofs;

DELETE FROM duel_proofs;
DELETE FROM duels;
DELETE FROM picks;

DROP TABLE questions;

ALTER TABLE questions_new RENAME TO questions;

INSERT INTO picks SELECT * FROM _mig_picks;
INSERT INTO duels SELECT * FROM _mig_duels;
INSERT INTO duel_proofs SELECT * FROM _mig_duel_proofs;

DROP TABLE _mig_picks;
DROP TABLE _mig_duels;
DROP TABLE _mig_duel_proofs;

-- Keep the AUTOINCREMENT sequence ahead of the copied ids.
DELETE FROM sqlite_sequence WHERE name IN ('questions', 'questions_new');
INSERT INTO sqlite_sequence (name, seq)
SELECT 'questions', COALESCE(MAX(id), 0) FROM questions;

CREATE INDEX idx_questions_outcome ON questions(outcome, resolves_at);
