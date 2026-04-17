"""
fetch_doubles_matches.py
Fetches doubles match results from WTT events and upserts into:
  - wtt_matches_doubles  (match results)
Runs daily via GitHub Actions alongside fetch_matches.py.
Reuses the same event IDs — singles script skips pairs, this one processes them.
"""

import os
import time
import requests
from datetime import date, timedelta, datetime, timezone
from supabase import create_client, Client

# ─── Config ───────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

MATCH_API_URL = "https://wtt-website-live-events-api-prod-cmfzgabgbzhphabb.eastasia-01.azurewebsites.net/api/cms/GetOfficialResult"
HEADERS = {
    "origin":  "https://www.worldtabletennis.com",
    "referer": "https://www.worldtabletennis.com/",
    "accept":  "application/json",
}

LOOKBACK_DAYS = 21
SLEEP_EVENT   = 2.0

# All 2026 WTT + ITTF + Youth events (same as fetch_matches.py)
WTT_2026_EVENT_IDS = {
    3231: ("WTT Champions Doha 2026",              "2026-01-11"),
    3232: ("WTT Star Contender Doha 2026",         "2026-01-18"),
    3251: ("WTT Contender Muscat 2026",            "2026-01-24"),
    3353: ("WTT Feeder Vadodara 2026",             "2026-01-11"),
    3354: ("WTT Feeder Doha 2026",                 "2026-01-31"),
    3355: ("WTT Feeder Lille 2026",                "2026-01-31"),
    3266: ("WTT Feeder Cappadocia 2026",           "2026-02-06"),
    3233: ("WTT Star Contender Chennai 2026",      "2026-02-15"),
    3234: ("Singapore Smash 2026",                 "2026-03-01"),
    3267: ("WTT Feeder Düsseldorf 2026",           "2026-03-06"),
    3268: ("WTT Feeder Otocec 2026",               "2026-03-11"),
    3235: ("WTT Champions Chongqing 2026",         "2026-03-15"),
    3356: ("WTT Feeder Varazdin 2026",             "2026-03-16"),
    3236: ("WTT Contender Tunis 2026",             "2026-03-29"),
    3373: ("WTT Feeder Cappadocia II 2026",        "2026-04-11"),
    3237: ("WTT Contender Taiyuan 2026",           "2026-04-12"),
    3270: ("WTT Feeder Havirov 2026",              "2026-04-17"),
    3357: ("WTT Feeder Senec 2026",                "2026-04-22"),
    3358: ("WTT Feeder Istanbul 2026",             "2026-05-14"),
    3360: ("WTT Feeder Lagos 2026",                "2026-05-19"),
    3238: ("WTT Contender Lagos 2026",             "2026-05-24"),
    3361: ("WTT Feeder Hennebont 2026",            "2026-05-24"),
    3271: ("WTT Feeder Prishtina 2026",            "2026-05-31"),
    3239: ("WTT Contender Skopje 2026",            "2026-06-07"),
    3240: ("WTT Contender Zagreb 2026",            "2026-06-14"),
    3241: ("WTT Star Contender Ljubljana 2026",    "2026-06-21"),
    3242: ("United States Smash 2026",             "2026-07-05"),
    3359: ("WTT Feeder Istanbul II 2026",          "2026-07-05"),
    3363: ("WTT Feeder Asunción 2026",             "2026-07-12"),
    3243: ("WTT Contender Buenos Aires 2026",      "2026-07-19"),
    3364: ("WTT Feeder Ulaanbaatar 2026",          "2026-07-23"),
    3244: ("WTT Star Contender Brazil 2026",       "2026-07-26"),
    3365: ("WTT Feeder Tashkent 2026",             "2026-07-28"),
    3372: ("WTT Feeder Tunis 2026",                "2026-08-02"),
    3272: ("WTT Feeder Vientiane 2026",            "2026-08-08"),
    3245: ("WTT Champions Yokohama 2026",          "2026-08-09"),
    3246: ("Europe Smash Sweden 2026",             "2026-08-16"),
    3374: ("WTT Feeder Berlin 2026",               "2026-08-23"),
    3282: ("WTT Feeder Olomouc 2026",              "2026-08-28"),
    3247: ("WTT Contender Almaty 2026",            "2026-09-06"),
    3415: ("WTT Feeder Puerto Princesa 2026",      "2026-09-12"),
    3253: ("WTT Contender Panagyurishte 2026",     "2026-09-13"),
    3248: ("WTT Champions Macao 2026",             "2026-09-13"),
    3371: ("WTT Feeder Bangkok 2026",              "2026-09-18"),
    3254: ("WTT Star Contender London 2026",       "2026-09-20"),
    3375: ("WTT Feeder Linz 2026",                 "2026-09-27"),
    3283: ("WTT Feeder Doha II 2026",              "2026-10-11"),
    3249: ("China Smash 2026",                     "2026-10-11"),
    3250: ("WTT Champions Montpellier 2026",       "2026-11-01"),
    3376: ("WTT Feeder Chennai 2026",              "2026-11-01"),
    3252: ("WTT Champions Frankfurt 2026",         "2026-11-08"),
    3370: ("WTT Feeder Vila Nova de Gaia 2026",    "2026-11-08"),
    3257: ("WTT Contender Istanbul 2026",          "2026-11-15"),
    3256: ("WTT Star Contender Muscat 2026",       "2026-11-21"),
    3352: ("WTT Feeder Düsseldorf II 2026",        "2026-11-27"),
    3269: ("WTT Feeder Gdansk 2026",               "2026-12-02"),
    3255: ("WTT Finals Hong Kong 2026",            "2026-12-13"),
    3379: ("ITTF World Cup Macao 2026",            "2026-04-05"),
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_recent_event_ids(lookback_days: int) -> list[dict]:
    cutoff = date.today() - timedelta(days=lookback_days)
    return [
        {"event_id": eid, "event_name": name, "start_date": start}
        for eid, (name, start) in WTT_2026_EVENT_IDS.items()
        if start >= cutoff.isoformat()
    ]


def events_needing_fetch(supabase: Client, events: list[dict]) -> list[dict]:
    if not events:
        return []
    eids = [e["event_id"] for e in events]
    existing = supabase.table("wtt_matches_doubles") \
        .select("event_id") \
        .in_("event_id", eids) \
        .execute()
    done = {r["event_id"] for r in (existing.data or [])}
    return [e for e in events if e["event_id"] not in done]


def fetch_event_matches(event_id: int) -> list[dict]:
    try:
        resp = requests.get(
            MATCH_API_URL,
            params={"eventId": event_id, "q": 1},
            headers=HEADERS,
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"  [!] HTTP {resp.status_code} for event {event_id}")
            return []
        data = resp.json()
    except Exception as e:
        print(f"  [!] Request error for event {event_id}: {e}")
        return []

    cards = data.get("Result") or data.get("result") or []
    records = []

    for root_card in cards:
        team_parent       = root_card.get("teamParentData") or {}
        extended          = team_parent.get("extended_info") or {}
        individual_matches = extended.get("matches") or []

        to_process = [
            tm.get("match_result")
            for tm in individual_matches
            if tm.get("match_result")
        ]
        if not to_process and root_card:
            to_process = [root_card]

        for m_card in to_process:
            if not m_card or not m_card.get("competitiors"):
                continue
            comps = m_card.get("competitiors")
            if len(comps) < 2:
                continue
            c1, c2 = comps[0], comps[1]
            record = parse_doubles_match(m_card, c1, c2, event_id)
            if record:
                records.append(record)

    return records


def parse_pair_id(raw_id: str) -> tuple[int | None, int | None]:
    """Parse "121558_131163" → (121558, 131163). Returns (None, None) if not a pair."""
    if "_" not in str(raw_id):
        return None, None
    parts = str(raw_id).split("_")
    if len(parts) != 2:
        return None, None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None, None


def parse_doubles_match(m_card: dict, c1: dict, c2: dict,
                        event_id: int) -> dict | None:
    comp1_id_raw = c1.get("competitiorId") or c1.get("competitorId") or ""
    comp2_id_raw = c2.get("competitiorId") or c2.get("competitorId") or ""

    # Only process doubles matches — IDs must be in "p1_p2" format
    c1p1, c1p2 = parse_pair_id(comp1_id_raw)
    c2p1, c2p2 = parse_pair_id(comp2_id_raw)
    if c1p1 is None or c2p1 is None:
        return None

    game_scores = m_card.get("gameScores") or m_card.get("resultsGameScores")
    if game_scores:
        clean = []
        for g in game_scores.split(","):
            parts = g.strip().split("-")
            if len(parts) == 2:
                a, b = parts[0].strip(), parts[1].strip()
                if a.isdigit() and b.isdigit():
                    if not (a == "7" and b == "0") and \
                       not (a == "0" and b == "7") and \
                       not (a == "0" and b == "0"):
                        clean.append(f"{a}-{b}")
        game_scores = ",".join(clean) if clean else None

    match_score = m_card.get("overallScores") or m_card.get("resultOverallScores")
    result = None
    if match_score:
        parts = match_score.split("-")
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            result = "W" if int(parts[0]) > int(parts[1]) else "L"

    event_date = None
    match_dt = m_card.get("matchDateTime") or {}
    date_str = match_dt.get("startDateLocal") or match_dt.get("startDateUTC")
    if date_str:
        try:
            event_date = datetime.strptime(date_str, "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d")
        except ValueError:
            event_date = date_str[:10] if date_str else None

    match_id = m_card.get("documentCode") or m_card.get("matchId") or m_card.get("id")
    if not match_id:
        return None

    return {
        "match_id":    int(match_id) if str(match_id).isdigit() else hash(str(match_id)) & 0x7FFFFFFF,
        "event_id":    event_id,
        "comp1_id":    str(comp1_id_raw),
        "comp1_p1_id": c1p1,
        "comp1_p2_id": c1p2,
        "comp2_id":    str(comp2_id_raw),
        "comp2_p1_id": c2p1,
        "comp2_p2_id": c2p2,
        "match_score": match_score,
        "game_scores": game_scores,
        "result":      result,
        "event_date":  event_date,
        "round_phase": m_card.get("subEventDescription"),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print(f"[Doubles Matches] Discovering events from last {LOOKBACK_DAYS} days...")
    recent = get_recent_event_ids(LOOKBACK_DAYS)
    print(f"[Doubles Matches] Found {len(recent)} recent events.")

    to_fetch = events_needing_fetch(supabase, recent)
    print(f"[Doubles Matches] {len(to_fetch)} events need fetching.")

    total_upserted = 0

    for ev in to_fetch:
        eid  = ev["event_id"]
        name = ev["event_name"]
        print(f"\n  Fetching: {name} (id:{eid})...")

        matches = fetch_event_matches(eid)
        doubles = [m for m in matches if m is not None]
        print(f"  Parsed {len(doubles)} doubles matches.")

        if not doubles:
            print(f"  [!] No doubles matches — skipping.")
            time.sleep(SLEEP_EVENT)
            continue

        for i in range(0, len(doubles), 500):
            chunk = doubles[i:i+500]
            supabase.table("wtt_matches_doubles").upsert(
                chunk, on_conflict="match_id"
            ).execute()

        total_upserted += len(doubles)
        print(f"  Upserted {len(doubles)} doubles matches for {name}.")
        time.sleep(SLEEP_EVENT)

    print(f"\n[Doubles Matches] Done. Total upserted: {total_upserted}")


if __name__ == "__main__":
    main()
