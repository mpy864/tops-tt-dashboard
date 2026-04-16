"""
backfill_events.py
Force-fetch one or more WTT events by ID, bypassing the normal lookback
window and "already has matches" checks.

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 scripts/backfill_events.py 3236 3373

Each event is fully upserted — existing rows are updated in place, new rows
are inserted. Safe to run multiple times.
"""

import os
import sys
import time

from supabase import create_client, Client
from fetch_matches import (
    fetch_event_matches,
    ensure_players_in_db,
    ensure_event_in_db,
    WTT_2026_EVENT_IDS,
    SLEEP_EVENT,
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def backfill(supabase: Client, event_ids: list[int]) -> None:
    for eid in event_ids:
        name = WTT_2026_EVENT_IDS.get(eid, (f"Unknown event {eid}",))[0]
        print(f"\n[Backfill] {name} (id:{eid})")

        # Ensure event row exists
        ensure_event_in_db(supabase, {
            "event_id":   eid,
            "event_name": name,
            "start_date": None,
        })

        matches = fetch_event_matches(eid)
        print(f"  Parsed {len(matches)} matches.")

        if not matches:
            print("  [!] No matches returned — check event ID or API availability.")
            time.sleep(SLEEP_EVENT)
            continue

        for i in range(0, len(matches), 500):
            chunk = [m for m in matches[i:i + 500] if m]
            if chunk:
                supabase.table("wtt_matches_singles") \
                    .upsert(chunk, on_conflict="match_id") \
                    .execute()

        print(f"  Upserted {len(matches)} matches.")
        ensure_players_in_db(supabase, matches)
        time.sleep(SLEEP_EVENT)


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 backfill_events.py <event_id> [event_id ...]")
        sys.exit(1)

    try:
        event_ids = [int(a) for a in sys.argv[1:]]
    except ValueError:
        print("Error: all arguments must be integer event IDs")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    backfill(supabase, event_ids)
    print("\n[Backfill] Done.")


if __name__ == "__main__":
    main()
