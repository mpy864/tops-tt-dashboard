"""
TTFI Scraper — Step 4: Supabase Ingest

Reads ttfi_matches.json + ttfi_slugs.json and upserts into Supabase.
Uses batch upserts with conflict handling (safe to re-run).

Requirements:
    pip install supabase python-dotenv

Usage:
    python ttfi_step4_ingest.py --matches ttfi_matches.json --slugs ttfi_slugs.json
    python ttfi_step4_ingest.py --matches ttfi_matches.json --slugs ttfi_slugs.json --dry-run
"""

import argparse
import json
import os
import sys
from collections import defaultdict

try:
    from supabase import create_client
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("✗ Missing dependencies. Run: pip install supabase python-dotenv")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
# Service key takes priority over anon key for ingest
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")

BATCH_SIZE = 500  # rows per upsert call

# ── Helpers ───────────────────────────────────────────────────────────────────

def chunked(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]

def build_tournament_name(slug: str) -> str:
    """Convert slug to readable name."""
    return slug.replace("-", " ").replace("_", " ").title()

# ── Main ──────────────────────────────────────────────────────────────────────

def run(matches_file: str, slugs_file: str, dry_run: bool = False):

    # Load data
    with open(matches_file) as f:
        matches = json.load(f)
    with open(slugs_file) as f:
        slugs = json.load(f)

    print(f"Loaded {len(matches):,} matches from {matches_file}")
    print(f"Loaded {len(slugs)} tournament slugs from {slugs_file}")

    if dry_run:
        print("\n[DRY RUN] — no data will be written to Supabase\n")

    # ── Build tournament records ──────────────────────────────────────────────

    # Index slugs by slug string
    slug_index = {s["slug"]: s for s in slugs}

    # Collect unique tournament_ids from matches
    tournament_map = {}  # tournament_id → record
    for m in matches:
        tid = m["tournament_id"]
        if tid not in tournament_map:
            slug_data = slug_index.get(m["slug"], {})
            tournament_map[tid] = {
                "id":              tid,
                "slug":            m["slug"],
                "name":            slug_data.get("name") or build_tournament_name(m["slug"]),
                "season":          m["season"],
                "has_pdf_results": slug_data.get("has_pdf_results", False),
            }

    tournaments = list(tournament_map.values())
    print(f"\nUnique tournaments: {len(tournaments)}")

    # ── Build match records ───────────────────────────────────────────────────

    def clean_int(val):
        """Convert empty string to None for integer fields."""
        if val == "" or val == "X":
            return None
        return val

    match_records = []
    for m in matches:
        match_records.append({
            "season":          m["season"],
            "slug":            m["slug"],
            "tournament_id":   m["tournament_id"],
            "event_id":        m["event_id"],
            "event_name":      m["event_name"],
            "source":          m["source"],
            "round":           m["round"],
            "match_datetime":  m.get("match_datetime") or None,
            "player1_id":      clean_int(m.get("player1_id")),
            "player1_name":    m.get("player1_name"),
            "player1_affil":   m.get("player1_affil"),
            "player2_id":      clean_int(m.get("player2_id")),
            "player2_name":    m.get("player2_name"),
            "player2_affil":   m.get("player2_affil"),
            "winner_id":       clean_int(m.get("winner_id")),
            "winner_name":     m.get("winner_name"),
            "score_raw":       m.get("score_raw"),
            "p1_sets":         m.get("p1_sets"),
            "p2_sets":         m.get("p2_sets"),
            "game_scores":     m.get("game_scores"),
            "wtt_player1_id":  m.get("wtt_player1_id"),
            "wtt_player2_id":  m.get("wtt_player2_id"),
        })

    print(f"Match records prepared: {len(match_records):,}")

    if dry_run:
        print("\nSample tournament record:")
        print(json.dumps(tournaments[0], indent=2))
        print("\nSample match record:")
        print(json.dumps(match_records[0], indent=2))
        return

    # ── Connect to Supabase ───────────────────────────────────────────────────

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ Missing SUPABASE_URL / SUPABASE_KEY in environment")
        print("  Add to .env: VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=...")
        sys.exit(1)

    print(f"\nConnecting to Supabase: {SUPABASE_URL[:40]}...")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # ── Upsert tournaments ────────────────────────────────────────────────────

    print(f"\nUpserting {len(tournaments)} tournaments...")
    resp = supabase.table("ttfi_tournaments").upsert(
        tournaments,
        on_conflict="id"
    ).execute()
    print(f"  ✓ Tournaments upserted")

    # ── Upsert matches in batches ─────────────────────────────────────────────

    total  = len(match_records)
    done   = 0
    errors = 0

    print(f"\nUpserting {total:,} matches in batches of {BATCH_SIZE}...")

    for batch in chunked(match_records, BATCH_SIZE):
        try:
            supabase.table("ttfi_domestic_matches").upsert(
                batch,
                on_conflict="tournament_id,event_id,source,round,player1_id,player2_id"
            ).execute()
            done += len(batch)
            pct = done / total * 100
            print(f"  {done:>6,}/{total:,}  ({pct:.0f}%)", end="\r")
        except Exception as e:
            errors += 1
            print(f"\n  ✗ Batch error: {e}")

    print(f"\n  ✓ {done:,} matches upserted ({errors} batch errors)")

    # ── Summary ───────────────────────────────────────────────────────────────

    print(f"\n{'─'*50}")
    print("✓ Ingest complete")
    print(f"  Tournaments: {len(tournaments)}")
    print(f"  Matches:     {done:,}")
    if errors:
        print(f"  Errors:      {errors} batches failed — check logs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--matches",  type=str, default="ttfi_matches.json")
    parser.add_argument("--slugs",    type=str, default="ttfi_slugs.json")
    parser.add_argument("--dry-run",  action="store_true")
    args = parser.parse_args()

    run(args.matches, args.slugs, args.dry_run)
