"""
backfill_missing_players.py
One-time script to fetch profiles for players referenced in wtt_matches_singles
but missing from wtt_players.

Skips youth players (IDs unlikely to be in WTT senior profile API) and
non-player IDs (1M+). Run manually via GitHub Actions workflow_dispatch.
"""

import os
import time
import requests
from datetime import datetime, timezone
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

PROFILE_URL = (
    "https://wtt-ttu-connect-frontdoor-g6gwg6e2bgc6gdfm.a01.azurefd.net"
    "/Players/GetPlayers"
)
PROFILE_HEADERS = {
    "apikey":     "2bf8b222-532c-4c60-8ebe-eb6fdfebe84a",
    "secapimkey": "S_WTT_882jjh7basdj91834783mds8j2jsd81",
    "origin":     "https://www.worldtabletennis.com",
    "referer":    "https://www.worldtabletennis.com/",
    "accept":     "application/json",
}

GENDER_MAP = {"Men":"M","M":"M","Male":"M","Women":"W","Woman":"W","W":"W","F":"W","Female":"W"}


SENIOR_EVENT_TYPES = {
    "WTT Grand Smash", "WTT Champions", "WTT Star Contender", "WTT Contender",
    "WTT Feeder", "Singles World Cup", "WTTC", "Continental Championships",
    "Continental Cups", "Olympic Games", "World Mixed Team Championships",
}

def get_missing_ids(supabase: Client) -> list[int]:
    """
    Return player IDs from SENIOR events that are missing from wtt_players.
    Skips youth events — those players are not in the WTT senior profile API.
    """
    # Get senior event IDs
    events = supabase.table("wtt_events").select("event_id,event_type,event_name").execute()
    senior_event_ids = {
        e["event_id"] for e in (events.data or [])
        if e.get("event_type") in SENIOR_EVENT_TYPES
        or (e.get("event_name") and "Youth" not in e["event_name"])
        and e.get("event_type") not in (None,)
    }
    # Simpler: exclude events with "Youth" in name or type
    senior_event_ids = {
        e["event_id"] for e in (events.data or [])
        if "Youth" not in (e.get("event_type") or "")
        and "Youth" not in (e.get("event_name") or "")
    }
    print(f"[Backfill] {len(senior_event_ids)} senior events found")

    # Collect player IDs from those events (paginated)
    all_ids = set()
    page_size = 1000
    offset = 0
    while True:
        rows = supabase.table("wtt_matches_singles") \
            .select("comp1_id,comp2_id") \
            .in_("event_id", list(senior_event_ids)) \
            .range(offset, offset + page_size - 1) \
            .execute()
        if not rows.data:
            break
        for row in rows.data:
            if row.get("comp1_id"): all_ids.add(row["comp1_id"])
            if row.get("comp2_id"): all_ids.add(row["comp2_id"])
        if len(rows.data) < page_size:
            break
        offset += page_size

    # Valid ITTF ID range only
    all_ids = {i for i in all_ids if 1 <= i < 1_000_000}

    # Remove IDs already in wtt_players
    existing = set()
    for i in range(0, len(list(all_ids)), 500):
        chunk = list(all_ids)[i:i+500]
        res = supabase.table("wtt_players").select("ittf_id").in_("ittf_id", chunk).execute()
        existing.update(r["ittf_id"] for r in (res.data or []))

    missing = sorted(all_ids - existing)
    print(f"[Backfill] {len(all_ids)} unique senior player IDs → {len(missing)} missing from wtt_players")
    return missing


def fetch_and_insert(supabase: Client, ittf_id: int) -> bool:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    try:
        r = requests.get(PROFILE_URL,
                         params={"IttfId": ittf_id, "q": now},
                         headers=PROFILE_HEADERS, timeout=15)
        if r.status_code != 200:
            return False
        result = r.json().get("Result") or []
        if not result:
            return False
        p = result[0]
        dob = None
        dob_raw = p.get("DOB")
        if dob_raw:
            try:
                dob = datetime.strptime(dob_raw, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
            except:
                try: dob = dob_raw[:10]
                except: pass

        supabase.table("wtt_players").upsert({
            "ittf_id":      ittf_id,
            "player_name":  p.get("PlayerName"),
            "country_code": p.get("CountryCode"),
            "country_name": p.get("CountryName"),
            "gender":       GENDER_MAP.get(p.get("Gender") or "", None),
            "dob":          dob,
            "handedness":   p.get("Handedness"),
            "grip":         p.get("Grip"),
            "blade_type":   p.get("BladeType"),
        }, on_conflict="ittf_id").execute()
        return True
    except Exception as e:
        print(f"  [!] Error for {ittf_id}: {e}")
        return False


def main():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    missing = get_missing_ids(supabase)

    if not missing:
        print("[Backfill] Nothing to do.")
        return

    inserted  = 0
    not_found = 0

    for i, ittf_id in enumerate(missing, 1):
        ok = fetch_and_insert(supabase, ittf_id)
        if ok:
            inserted += 1
        else:
            not_found += 1

        if i % 50 == 0:
            print(f"  Progress: {i}/{len(missing)} — inserted {inserted}, not found {not_found}")
        time.sleep(0.2)

    print(f"\n[Backfill] Done. Inserted: {inserted} | Not found in API: {not_found}")


if __name__ == "__main__":
    main()
