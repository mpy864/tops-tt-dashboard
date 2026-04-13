-- ============================================================
-- TTFI Domestic Matches Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS ttfi_tournaments (
    id              int PRIMARY KEY,
    slug            text NOT NULL,
    name            text,
    season          text NOT NULL,
    has_pdf_results boolean DEFAULT false,
    created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ttfi_domestic_matches (
    id              bigserial PRIMARY KEY,

    -- Tournament context
    season          text NOT NULL,
    slug            text NOT NULL,
    tournament_id   int NOT NULL REFERENCES ttfi_tournaments(id),
    event_id        int NOT NULL,
    event_name      text NOT NULL,
    source          text NOT NULL CHECK (source IN ('main_draw', 'qualification')),

    -- Match structure
    round           text NOT NULL,
    match_datetime  text,

    -- Player 1 (match winner per parse_player)
    player1_id      int,
    player1_name    text,
    player1_affil   text,

    -- Player 2
    player2_id      int,
    player2_name    text,
    player2_affil   text,

    -- Result
    winner_id       int,
    winner_name     text,

    -- Score — structured
    score_raw       text,           -- "4 - 1 (3,4,-6,9,3)"
    p1_sets         smallint,       -- 4  (sets won by player1/winner side)
    p2_sets         smallint,       -- 1
    game_scores     smallint[][],     -- [[winner_score, loser_score], ...] e.g. [[11,7],[11,9],[6,11],[11,4]]

    -- WTT bridge
    wtt_player1_id  text,
    wtt_player2_id  text,

    created_at      timestamptz DEFAULT now(),

    UNIQUE (tournament_id, event_id, source, round, player1_id, player2_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ttfi_season      ON ttfi_domestic_matches (season);
CREATE INDEX IF NOT EXISTS idx_ttfi_tournament  ON ttfi_domestic_matches (tournament_id);
CREATE INDEX IF NOT EXISTS idx_ttfi_event_name  ON ttfi_domestic_matches (event_name);
CREATE INDEX IF NOT EXISTS idx_ttfi_player1     ON ttfi_domestic_matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_ttfi_player2     ON ttfi_domestic_matches (player2_id);
CREATE INDEX IF NOT EXISTS idx_ttfi_winner      ON ttfi_domestic_matches (winner_id);
CREATE INDEX IF NOT EXISTS idx_ttfi_wtt_p1      ON ttfi_domestic_matches (wtt_player1_id) WHERE wtt_player1_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ttfi_wtt_p2      ON ttfi_domestic_matches (wtt_player2_id) WHERE wtt_player2_id IS NOT NULL;

-- RLS
ALTER TABLE ttfi_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ttfi_domestic_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read ttfi_tournaments"
    ON ttfi_tournaments FOR SELECT TO anon USING (true);

CREATE POLICY "Public read ttfi_domestic_matches"
    ON ttfi_domestic_matches FOR SELECT TO anon USING (true);

-- View: matches with known TOPS athletes
CREATE OR REPLACE VIEW ttfi_tops_matches AS
SELECT * FROM ttfi_domestic_matches
WHERE wtt_player1_id IS NOT NULL OR wtt_player2_id IS NOT NULL;

GRANT SELECT ON ttfi_tops_matches TO anon;
