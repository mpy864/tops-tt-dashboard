"""
TTFI Scraper — Step 2: Event ID Discovery

Given a list of tournament slugs (from Step 1), opens each tournament's
events page and extracts event IDs from the result links in the sidebar.

Input:  ttfi_slugs.json  (output of Step 1)
Output: ttfi_events.json (list of {season, slug, tournament_id, event_id, event_name})

Usage:
    python ttfi_step2_events.py --input ttfi_slugs.json --output ttfi_events.json
    python ttfi_step2_events.py --input ttfi_slugs.json --slug utt-87th-senior-national-inter-state-table-tennis-championships-2025
"""

import argparse
import base64
import json
import re
import time
import requests
from bs4 import BeautifulSoup

# ── Event name normalization ─────────────────────────────────────────────────

# Canonical event names — all variants map to these
CANONICAL_EVENTS = {
    # Senior singles
    "men's singles":              "Men's Singles",
    "women's singles":            "Women's Singles",
    # Senior doubles
    "men's doubles":              "Men's Doubles",
    "women's doubles":            "Women's Doubles",
    "mixed doubles":              "Mixed Doubles",
    # Youth singles — normalize all age/format variants
    "u-19 boys": "Youth Boys Singles U19",
    "u 19 boys": "Youth Boys Singles U19",
    "youth boys singles u-19": "Youth Boys Singles U19",
    "youth boys singles (u-19)": "Youth Boys Singles U19",
    "u 19 boys singles": "Youth Boys Singles U19",
    "u-19 girls": "Youth Girls Singles U19",
    "u 19 girls": "Youth Girls Singles U19",
    "youth girls singles u-19": "Youth Girls Singles U19",
    "youth girls singles (u-19)": "Youth Girls Singles U19",
    "u 19 girls singles": "Youth Girls Singles U19",
    "u-17 boys": "Youth Boys Singles U17",
    "u 17 boys": "Youth Boys Singles U17",
    "youth boys singles u-17": "Youth Boys Singles U17",
    "youth boys singles (u-17)": "Youth Boys Singles U17",
    "u 17 boys singles": "Youth Boys Singles U17",
    "u-17 girls": "Youth Girls Singles U17",
    "u 17 girls": "Youth Girls Singles U17",
    "youth girls singles u-17": "Youth Girls Singles U17",
    "youth girls singles (u-17)": "Youth Girls Singles U17",
    "u 17 girls singles": "Youth Girls Singles U17",
    "u-15 boys": "Youth Boys Singles U15",
    "u 15 boys": "Youth Boys Singles U15",
    "youth boys singles u-15": "Youth Boys Singles U15",
    "youth boys singles (u-15)": "Youth Boys Singles U15",
    "u 15 boys singles": "Youth Boys Singles U15",
    "u-15 girls": "Youth Girls Singles U15",
    "u 15 girls": "Youth Girls Singles U15",
    "youth girls singles u-15": "Youth Girls Singles U15",
    "youth girls singles (u-15)": "Youth Girls Singles U15",
    "u 15 girls singles": "Youth Girls Singles U15",
    "u-13 boys": "Youth Boys Singles U13",
    "u 13 boys": "Youth Boys Singles U13",
    "youth boys singles u-13": "Youth Boys Singles U13",
    "youth boys singles (u-13)": "Youth Boys Singles U13",
    "u 13 boys singles": "Youth Boys Singles U13",
    "u-13 girls": "Youth Girls Singles U13",
    "u 13 girls": "Youth Girls Singles U13",
    "youth girls singles u-13": "Youth Girls Singles U13",
    "youth girls singles (u-13)": "Youth Girls Singles U13",
    "u 13 girls singles": "Youth Girls Singles U13",
    "u-11 boys": "Youth Boys Singles U11",
    "u 11 boys": "Youth Boys Singles U11",
    "youth boys singles u-11": "Youth Boys Singles U11",
    "youth boys singles (u-11)": "Youth Boys Singles U11",
    "u 11 boys singles": "Youth Boys Singles U11",
    "u-11 girls": "Youth Girls Singles U11",
    "u 11 girls": "Youth Girls Singles U11",
    "youth girls singles u-11": "Youth Girls Singles U11",
    "youth girls singles (u-11)": "Youth Girls Singles U11",
    "u 11 girls singles": "Youth Girls Singles U11",
    # Youth doubles
    "youth boys doubles u-19": "Youth Boys Doubles U19",
    "youth boys doubles (u-19)": "Youth Boys Doubles U19",
    "youth boys doubles  (u-19)": "Youth Boys Doubles U19",
    "youth boys doubles u-17": "Youth Boys Doubles U17",
    "youth boys doubles (u-17)": "Youth Boys Doubles U17",
    "youth boys doubles  (u-17)": "Youth Boys Doubles U17",
    "youth boys doubles u-15": "Youth Boys Doubles U15",
    "youth boys doubles (u-15)": "Youth Boys Doubles U15",
    "youth boys doubles  (u-15)": "Youth Boys Doubles U15",
    "u - 15 boys doubles": "Youth Boys Doubles U15",
    "youth boys doubles u-13": "Youth Boys Doubles U13",
    "youth boys doubles (u-13)": "Youth Boys Doubles U13",
    "u - 13 boys doubles": "Youth Boys Doubles U13",
    "youth girls doubles u-19": "Youth Girls Doubles U19",
    "youth girls doubles (u-19)": "Youth Girls Doubles U19",
    "youth girls doubles  (u-19)": "Youth Girls Doubles U19",
    "youth girls doubles u-17": "Youth Girls Doubles U17",
    "youth girls doubles (u-17)": "Youth Girls Doubles U17",
    "youth girls doubles  (u-17)": "Youth Girls Doubles U17",
    "youth girls doubles u-15": "Youth Girls Doubles U15",
    "youth girls doubles (u-15)": "Youth Girls Doubles U15",
    "youth girls doubles  (u-15)": "Youth Girls Doubles U15",
    "u - 15 girls doubles": "Youth Girls Doubles U15",
    "youth girls doubles u-13": "Youth Girls Doubles U13",
    "youth girls doubles (u-13)": "Youth Girls Doubles U13",
    "u - 13 girls doubles": "Youth Girls Doubles U13",
}

def normalize_event_name(raw: str) -> str:
    """Map raw TTFI event name to canonical form."""
    key = re.sub(r'\s+', ' ', raw.strip()).lower()
    # Direct match
    if key in CANONICAL_EVENTS:
        return CANONICAL_EVENTS[key]
    # Partial match — check if any canonical key is contained in the raw name
    for pattern, canonical in CANONICAL_EVENTS.items():
        if pattern in key:
            return canonical
    # No match — return cleaned original
    return raw.strip()

# ── Config ────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.ttfi.org/",
}

# Result endpoint patterns to look for in sidebar links
RESULT_PATTERNS = [
    r'/result/view-result\.php',
    r'/result/qualifications-result\.php',
]

# Event types we care about — skip team events
SKIP_EVENT_TYPES = ["team", "teams"]

# ── Decode helpers ────────────────────────────────────────────────────────────

def decode_b64(s: str) -> str:
    try:
        return base64.b64decode(s).decode()
    except Exception:
        return s

def parse_result_url(href: str) -> dict | None:
    """
    Extract tournament_id and event_id from a result URL.
    Returns None if not a valid result link.

    URL format:
    /result/view-result.php
        ?0932388ad460202b7fe491686b8a664d=NDgw        ← tournament_id (b64)
        &58a9b4be5cb590600c5c533c396ae282=MzU=        ← event_id (b64)
    """
    PARAM_T = "0932388ad460202b7fe491686b8a664d"
    PARAM_E = "58a9b4be5cb590600c5c533c396ae282"

    # Check it's a result link
    if not any(re.search(p, href) for p in RESULT_PATTERNS):
        return None

    # Extract params
    t_match = re.search(rf'{PARAM_T}=([^&]+)', href)
    e_match = re.search(rf'{PARAM_E}=([^&]+)', href)

    if not t_match or not e_match:
        return None

    tournament_id = decode_b64(t_match.group(1))
    event_id      = decode_b64(e_match.group(1))

    try:
        tournament_id = int(tournament_id)
        event_id      = int(event_id)
    except ValueError:
        return None

    # Determine endpoint type
    endpoint = "qualification" if "qualifications" in href else "main_draw"

    return {
        "tournament_id": tournament_id,
        "event_id":      event_id,
        "endpoint":      endpoint,
    }

# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_event_ids(tournament: dict) -> list[dict]:
    """
    Fetch a tournament's events page and extract all result event IDs.
    Returns list of event records.
    """
    slug       = tournament["slug"]
    events_url = tournament["events_url"]
    season     = tournament["season"]

    print(f"\n  {slug}")
    print(f"  GET {events_url}")

    try:
        resp = requests.get(events_url, headers=HEADERS, timeout=20)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ✗ Fetch failed: {e}")
        return []

    soup  = BeautifulSoup(resp.text, "lxml")
    links = soup.find_all("a", href=True)

    seen_events = set()
    events      = []

    for link in links:
        href      = link.get("href", "")
        link_text = (link.get_text() or "").strip().lower()

        parsed = parse_result_url(href)
        if not parsed:
            continue

        # Skip team events
        if any(t in link_text for t in SKIP_EVENT_TYPES):
            print(f"  ⊘ Skip team: {link.get_text().strip()}")
            continue

        # Only keep main_draw links for event discovery
        # (qual links share same event_id, no need to duplicate)
        if parsed["endpoint"] != "main_draw":
            continue

        key = (parsed["tournament_id"], parsed["event_id"])
        if key in seen_events:
            continue
        seen_events.add(key)

        event_name_raw = link.get_text().strip()
        event_name     = normalize_event_name(event_name_raw)

        record = {
            "season":          season,
            "slug":            slug,
            "tournament_id":   parsed["tournament_id"],
            "event_id":        parsed["event_id"],
            "event_name":      event_name,
            "event_name_raw":  event_name_raw,
        }
        events.append(record)
        print(f"  ✓ t={parsed['tournament_id']:>4} e={parsed['event_id']:>4}  {event_name}")

    if not events:
        print(f"  ⚠ No events found (page may require JS or have no results yet)")

    return events

# ── Main ──────────────────────────────────────────────────────────────────────

def run(input_file: str, output_file: str, filter_slug: str = None, delay: float = 1.0):
    with open(input_file) as f:
        tournaments = json.load(f)

    if filter_slug:
        tournaments = [t for t in tournaments if t["slug"] == filter_slug]
        if not tournaments:
            print(f"✗ Slug '{filter_slug}' not found in {input_file}")
            return

    all_events = []

    for t in tournaments:
        events = fetch_event_ids(t)
        all_events.extend(events)
        time.sleep(delay)

    with open(output_file, "w") as f:
        json.dump(all_events, f, indent=2, ensure_ascii=False)

    print(f"\n{'─'*50}")
    print(f"✓ {len(all_events)} total events saved to {output_file}")

    # Summary
    from collections import Counter
    print("\nBreakdown by season:")
    season_counts = Counter(e["season"] for e in all_events)
    for season, count in sorted(season_counts.items()):
        print(f"  {season}: {count} events across {len(set(e['slug'] for e in all_events if e['season']==season))} tournaments")

    print("\nEvent types found:")
    event_counts = Counter(e["event_name"] for e in all_events)
    for name, count in sorted(event_counts.items(), key=lambda x: -x[1]):
        print(f"  {count:>3}x  {name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",  type=str, default="ttfi_slugs.json")
    parser.add_argument("--output", type=str, default="ttfi_events.json")
    parser.add_argument("--slug",   type=str, help="Test a single slug")
    parser.add_argument("--delay",  type=float, default=1.0)
    args = parser.parse_args()

    run(args.input, args.output, args.slug, args.delay)
