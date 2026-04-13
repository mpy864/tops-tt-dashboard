"""
TTFI Domestic Tournament Scraper
Scrapes bracket + qualification results from ttfi.org

Endpoints:
  Main draw:   /result/view-result.php
  Qual rounds: /result/qualifications-result.php
               (only available for singles: MS=35, WS=36)

Usage:
  python ttfi_scraper.py --tournament 480 --events 35,36,37,38,39
  python ttfi_scraper.py --tournament 480 --events 35,36,37,38,39 --output nationals_2025.json
"""

import requests
import base64
import json
import re
import time
import argparse
from bs4 import BeautifulSoup

# ── Constants ─────────────────────────────────────────────────────────────────

MAIN_DRAW_URL = "https://www.ttfi.org/result/view-result.php"
QUAL_URL      = "https://www.ttfi.org/result/qualifications-result.php"

PARAM_T = "0932388ad460202b7fe491686b8a664d"
PARAM_E = "58a9b4be5cb590600c5c533c396ae282"

# Qual rounds only exist for singles events
QUAL_EVENTS = {35, 36}

EVENT_NAMES = {
    35: "Men's Singles",
    36: "Women's Singles",
    37: "Men's Doubles",
    38: "Women's Doubles",
    39: "Mixed Doubles",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    )
}

# ── URL helpers ───────────────────────────────────────────────────────────────

def b64(n: int) -> str:
    return base64.b64encode(str(n).encode()).decode()

def build_url(endpoint: str, tournament_id: int, event_id: int) -> str:
    return f"{endpoint}?{PARAM_T}={b64(tournament_id)}&{PARAM_E}={b64(event_id)}"

# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_html(endpoint: str, tournament_id: int, event_id: int) -> str:
    url = build_url(endpoint, tournament_id, event_id)
    print(f"  GET {url}")
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text

# ── Parse ─────────────────────────────────────────────────────────────────────

def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()

def parse_scores(spans) -> str:
    scores = [clean(s.get_text()) for s in spans
              if clean(s.get_text()) not in ('', '\xa0', '&nbsp;', ' ')]
    return " | ".join(scores)

def parse_player(team_div) -> dict:
    backno = clean(team_div.find("div", class_="backno").get_text()) if team_div.find("div", class_="backno") else ""
    label  = team_div.find("div", class_="teamlabel")
    name   = label.get("title", "") if label else ""
    name   = clean(name) if name else (clean(label.get_text()) if label else "")
    state  = clean(team_div.find("div", class_="player_state").get_text()) if team_div.find("div", class_="player_state") else ""
    classes = team_div.get("class", [])
    result = "winner" if "winner" in classes else ("win" if "win" in classes else "lose")
    is_bye = (backno == "X")
    return {
        "player_id":   None if is_bye else (int(backno) if backno.isdigit() else backno),
        "name":        "BYE" if is_bye else name,
        "affiliation": state,
        "result":      result,
        "is_bye":      is_bye,
    }

def parse_bracket(html: str, tournament_id: int, event_id: int, source: str = "main_draw") -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    matches = []

    for round_div in soup.find_all("div", class_="round"):
        head = round_div.find(class_="round_head")
        if not head:
            continue
        round_name = clean(head.get_text())

        for match_div in round_div.find_all("div", class_="match"):
            tc = match_div.find("div", class_="teamContainer")
            if not tc:
                continue
            bb = tc.find("div", class_="BorderBox")
            if not bb:
                continue
            teams = bb.find_all("div", class_="team")
            if len(teams) < 2:
                continue

            p1, p2 = parse_player(teams[0]), parse_player(teams[1])
            if p1["is_bye"] or p2["is_bye"]:
                continue

            date_span = bb.find("span", class_="teamContainer__date")
            date_raw  = clean(date_span.get_text()) if date_span else ""
            score     = parse_scores(tc.find_all("span", class_="teamContainer__point"))

            winner = p1 if p1["result"] in ("win", "winner") else p2

            matches.append({
                "tournament_id":  tournament_id,
                "event_id":       event_id,
                "event_name":     EVENT_NAMES.get(event_id, str(event_id)),
                "source":         source,       # "main_draw" or "qualification"
                "round":          round_name,
                "player1_id":     p1["player_id"],
                "player1_name":   p1["name"],
                "player1_affil":  p1["affiliation"],
                "player2_id":     p2["player_id"],
                "player2_name":   p2["name"],
                "player2_affil":  p2["affiliation"],
                "winner_id":      winner["player_id"],
                "winner_name":    winner["name"],
                "score":          score,
                "match_datetime": date_raw,
                "wtt_player1_id": None,
                "wtt_player2_id": None,
            })

    return matches

def dedup(matches: list[dict]) -> list[dict]:
    seen, unique = set(), []
    for m in matches:
        key  = (m["source"], m["round"], m["player1_id"], m["player2_id"])
        rkey = (m["source"], m["round"], m["player2_id"], m["player1_id"])
        if key not in seen and rkey not in seen:
            seen.add(key)
            unique.append(m)
    return unique

# ── Main scrape loop ──────────────────────────────────────────────────────────

def scrape_tournament(tournament_id: int, event_ids: list[int], delay: float = 1.5) -> list[dict]:
    all_matches = []

    for event_id in event_ids:
        ename = EVENT_NAMES.get(event_id, str(event_id))
        print(f"\n── Event {event_id} ({ename}) ──")

        # 1. Main draw
        try:
            html = fetch_html(MAIN_DRAW_URL, tournament_id, event_id)
            m = parse_bracket(html, tournament_id, event_id, source="main_draw")
            m = dedup(m)
            print(f"  Main draw:     {len(m):>4} matches")
            all_matches.extend(m)
            time.sleep(delay)
        except Exception as e:
            print(f"  Main draw ERROR: {e}")

        # 2. Qualification rounds (singles only)
        if event_id in QUAL_EVENTS:
            try:
                html = fetch_html(QUAL_URL, tournament_id, event_id)
                m = parse_bracket(html, tournament_id, event_id, source="qualification")
                m = dedup(m)
                print(f"  Qual rounds:   {len(m):>4} matches")
                all_matches.extend(m)
                time.sleep(delay)
            except Exception as e:
                print(f"  Qual rounds ERROR: {e}")

    return all_matches

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape TTFI tournament brackets")
    parser.add_argument("--tournament", type=int, default=480)
    parser.add_argument("--events",    type=str,  default="35,36,37,38,39")
    parser.add_argument("--output",    type=str,  default="ttfi_matches.json")
    parser.add_argument("--delay",     type=float, default=1.5)
    args = parser.parse_args()

    event_ids = [int(e.strip()) for e in args.events.split(",")]
    matches   = scrape_tournament(args.tournament, event_ids, delay=args.delay)

    with open(args.output, "w") as f:
        json.dump(matches, f, indent=2, ensure_ascii=False)

    print(f"\n✓ {len(matches)} total matches → {args.output}")
    print("\nBreakdown by source + event:")
    from collections import Counter
    for (src, ename), count in sorted(Counter(
        (m["source"], m["event_name"]) for m in matches
    ).items()):
        print(f"  {src:<15} {ename:<20} {count:>4}")
