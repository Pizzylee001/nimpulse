-- Phase 2b continuity: wallet-scoped duel lookups for the activity list.
CREATE INDEX IF NOT EXISTS idx_duels_creator_wallet ON duels(creator_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_duels_opponent_wallet ON duels(opponent_wallet, created_at DESC);
