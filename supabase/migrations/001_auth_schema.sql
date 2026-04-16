-- ─── 1. clubs ─────────────────────────────────────────────────────────────────
CREATE TABLE clubs (
  id      TEXT PRIMARY KEY,          -- e.g. 'tops_delhi'
  name    TEXT NOT NULL,
  plan    TEXT NOT NULL DEFAULT 'tier1' CHECK (plan IN ('tier1', 'tier2')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. user_profiles ─────────────────────────────────────────────────────────
CREATE TABLE user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'club' CHECK (role IN ('admin', 'club', 'org')),
  club_id    TEXT REFERENCES clubs(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── 3. club_athletes ─────────────────────────────────────────────────────────
-- Links ittf_ids (from wtt_players) to a club
CREATE TABLE club_athletes (
  club_id  TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  ittf_id  TEXT NOT NULL,
  PRIMARY KEY (club_id, ittf_id)
);

-- ─── 4. competitor_picks ──────────────────────────────────────────────────────
-- One competitor per athlete per club, resets each billing cycle (monthly)
CREATE TABLE competitor_picks (
  club_id              TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  athlete_ittf_id      TEXT NOT NULL,
  competitor_ittf_id   TEXT NOT NULL,
  valid_until          DATE NOT NULL,           -- end of current billing cycle
  updated_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (club_id, athlete_ittf_id)
);

-- ─── RLS: user_profiles ───────────────────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can always read their own profile
CREATE POLICY "own_profile_select" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "admin_profile_select" ON user_profiles
  FOR SELECT USING (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) = 'admin'
  );

-- ─── RLS: clubs ───────────────────────────────────────────────────────────────
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;

-- Users can read their own club's row
CREATE POLICY "own_club_select" ON clubs
  FOR SELECT USING (
    id = (SELECT club_id FROM user_profiles WHERE id = auth.uid())
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'org')
  );

-- ─── RLS: club_athletes ───────────────────────────────────────────────────────
ALTER TABLE club_athletes ENABLE ROW LEVEL SECURITY;

-- Club users see only their athletes; org/admin see all
CREATE POLICY "club_athletes_select" ON club_athletes
  FOR SELECT USING (
    club_id = (SELECT club_id FROM user_profiles WHERE id = auth.uid())
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'org')
  );

-- ─── RLS: competitor_picks ────────────────────────────────────────────────────
ALTER TABLE competitor_picks ENABLE ROW LEVEL SECURITY;

-- Club users see and manage only their own picks
CREATE POLICY "picks_select" ON competitor_picks
  FOR SELECT USING (
    club_id = (SELECT club_id FROM user_profiles WHERE id = auth.uid())
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'org')
  );

CREATE POLICY "picks_upsert" ON competitor_picks
  FOR INSERT WITH CHECK (
    club_id = (SELECT club_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "picks_update" ON competitor_picks
  FOR UPDATE USING (
    club_id = (SELECT club_id FROM user_profiles WHERE id = auth.uid())
  );

-- ─── Helper: consume_audit_view (kept from original) ──────────────────────────
-- (no-op placeholder — remove if not needed)
