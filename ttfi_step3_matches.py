"""
TTFI Scraper — Step 3: Match Scraping

Reads ttfi_events.json (from Step 2), scrapes all match results.

Score convention:
  "4 - 1 (3,4,-6,9,3)" → p1_sets=4, p2_sets=1, game_scores=[3,4,-6,9,3]
  Positive game value = match winner WON that game, value is loser's score
  Negative game value = match winner LOST that game, abs(value) is winner's score
  e.g. game_scores=[3,4,-6,9,3] → 11-3, 11-4, 6-11, 11-9, 11-3

Usage:
    python ttfi_step3_matches.py --input ttfi_events.json --output ttfi_matches.json
    python ttfi_step3_matches.py --input ttfi_events.json --tournament 480 --output test.json
"""

import argparse
import base64
import json
import re
import time
import requests
from bs4 import BeautifulSoup
from collections import Counter

# ── Config ────────────────────────────────────────────────────────────────────

MAIN_DRAW_URL = "https://www.ttfi.org/result/view-result.php"
QUAL_URL      = "https://www.ttfi.org/result/qualifications-result.php"
PARAM_T       = "0932388ad460202b7fe491686b8a664d"
PARAM_E       = "58a9b4be5cb590600c5c533c396ae282"

SINGLES_EVENT_IDS = set(range(35, 37)) | set(range(45, 55))

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.ttfi.org/",
}

# ── URL helpers ───────────────────────────────────────────────────────────────

def b64(n):
    return base64.b64encode(str(n).encode()).decode()

def build_url(endpoint, tournament_id, event_id):
    return f"{endpoint}?{PARAM_T}={b64(tournament_id)}&{PARAM_E}={b64(event_id)}"

def fetch_html(endpoint, tournament_id, event_id):
    url = build_url(endpoint, tournament_id, event_id)
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text

# ── Text helpers ──────────────────────────────────────────────────────────────

def clean(text):
    return re.sub(r'\s+', ' ', text).strip()

# ── Score parsing ─────────────────────────────────────────────────────────────

def parse_score(spans):
    """
    Two teamContainer__point spans per match:
      Top span:    incoming score from previous round — IGNORE
      Bottom span: actual score of THIS match — USE THIS

    Returns structured dict:
      score_raw   : "4 - 1 (3,4,-6,9,3)"
      p1_sets     : 4
      p2_sets     : 1
      game_scores : [3, 4, -6, 9, 3]
    """
    EMPTY = {"score_raw": None, "p1_sets": None, "p2_sets": None, "game_scores": None}

    non_empty = [clean(s.get_text()) for s in spans
                 if clean(s.get_text()) not in ('', '\xa0', '&nbsp;', ' ')]

    if not non_empty:
        return EMPTY

    raw = non_empty[-1]  # always take the last (actual match score)

    sets_m = re.search(r'(\d+)\s*-\s*(\d+)', raw)
    if not sets_m:
        return EMPTY

    p1_sets = int(sets_m.group(1))
    p2_sets = int(sets_m.group(2))

    games_m = re.search(r'\(([^)]+)\)', raw)
    if games_m:
        try:
            margins = [int(x.strip()) for x in games_m.group(1).split(',')]
            # Convert margins to [winner_score, loser_score] pairs
            # Positive margin: match winner won game → [11, margin] (or deuce e.g. [13, margin])
            # Negative margin: match winner lost game → [abs(margin), 11]
            game_scores = []
            for m in margins:
                if m >= 0:
                    # Winner won this game
                    # m <= 9: normal game 11-m
                    # m >= 10: deuce game (m+2)-m
                    if m <= 9:
                        game_scores.append([11, m])
                    else:
                        game_scores.append([m + 2, m])
                else:
                    # Winner lost this game
                    a = abs(m)
                    # a <= 9: normal game a-11
                    # a >= 10: deuce game a-(a+2)
                    if a <= 9:
                        game_scores.append([a, 11])
                    else:
                        game_scores.append([a, a + 2])
        except ValueError:
            game_scores = None
    else:
        game_scores = None

    return {
        "score_raw":   raw,
        "p1_sets":     p1_sets,
        "p2_sets":     p2_sets,
        "game_scores": game_scores,  # [[11,7], [11,9], [6,11], [11,4]] etc.
    }

# ── Player parsing ────────────────────────────────────────────────────────────

def parse_player(team_div):
    backno_div = team_div.find("div", class_="backno")
    label_div  = team_div.find("div", class_="teamlabel")
    state_div  = team_div.find("div", class_="player_state")

    backno = clean(backno_div.get_text()) if backno_div else ""
    name   = label_div.get("title", "") if label_div else ""
    name   = clean(name) if name else (clean(label_div.get_text()) if label_div else "")
    state  = clean(state_div.get_text()) if state_div else ""

    classes = team_div.get("class", [])
    result  = "winner" if "winner" in classes else ("win" if "win" in classes else "lose")
    is_bye  = (backno == "X")

    return {
        "player_id":   None if is_bye else (int(backno) if backno.isdigit() else backno),
        "name":        "BYE" if is_bye else name,
        "affiliation": state,
        "result":      result,
        "is_bye":      is_bye,
    }

# ── Round name normalization ─────────────────────────────────────────────────

def normalize_round(raw: str) -> str:
    """Normalize round names across different draw sizes.
    
    Examples:
      QUARTER FINAL 1/2/3/4 → QF
      SEMI FINAL 1/2        → SF
      QF                    → QF
      SF                    → SF
      FINAL                 → FINAL
    """
    r = raw.upper().strip()
    if r.startswith("QUARTER FINAL") or r == "QF":
        return "QF"
    if r.startswith("SEMI FINAL") or r == "SF":
        return "SF"
    return raw.strip()

# ── Bracket parsing ───────────────────────────────────────────────────────────

def parse_bracket(html, event_record, source):
    soup    = BeautifulSoup(html, "lxml")
    matches = []

    for round_div in soup.find_all("div", class_="round"):
        # Main bracket: <div class="text-center round_head"><b>R/64</b></div>
        # Winner-Container: <div class="text-center"><b>QF</b></div>
        # Handle both cases
        head = round_div.find(class_="round_head")
        if not head:
            # Try text-center div with bold tag (Winner-Container style)
            tc = round_div.find("div", class_="text-center")
            if tc and tc.find("b"):
                head = tc
            else:
                continue
        round_name = normalize_round(clean(head.get_text()))

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

            score  = parse_score(tc.find_all("span", class_="teamContainer__point"))
            winner = p1 if p1["result"] in ("win", "winner") else p2

            matches.append({
                "season":          event_record["season"],
                "slug":            event_record["slug"],
                "tournament_id":   event_record["tournament_id"],
                "event_id":        event_record["event_id"],
                "event_name":      event_record["event_name"],
                "source":          source,
                "round":           round_name,
                "match_datetime":  date_raw,
                "player1_id":      p1["player_id"],
                "player1_name":    p1["name"],
                "player1_affil":   p1["affiliation"],
                "player2_id":      p2["player_id"],
                "player2_name":    p2["name"],
                "player2_affil":   p2["affiliation"],
                "winner_id":       winner["player_id"],
                "winner_name":     winner["name"],
                "score_raw":       score["score_raw"],
                "p1_sets":         score["p1_sets"],
                "p2_sets":         score["p2_sets"],
                "game_scores":     score["game_scores"],
                "wtt_player1_id":  None,
                "wtt_player2_id":  None,
            })

    return matches

def dedup(matches):
    seen, unique = set(), []
    for m in matches:
        key  = (m["source"], m["round"], m["player1_id"], m["player2_id"])
        rkey = (m["source"], m["round"], m["player2_id"], m["player1_id"])
        if key not in seen and rkey not in seen:
            seen.add(key)
            unique.append(m)
    return unique

# ── Scrape one event ──────────────────────────────────────────────────────────

def scrape_event(event_record, delay):
    tid, eid = event_record["tournament_id"], event_record["event_id"]
    all_matches = []

    try:
        html    = fetch_html(MAIN_DRAW_URL, tid, eid)
        matches = dedup(parse_bracket(html, event_record, "main_draw"))
        all_matches.extend(matches)
        main_count = len(matches)
    except Exception as e:
        print(f"      ✗ Main draw error: {e}")
        main_count = 0
    time.sleep(delay)

    qual_count = 0
    if eid in SINGLES_EVENT_IDS:
        try:
            html    = fetch_html(QUAL_URL, tid, eid)
            matches = dedup(parse_bracket(html, event_record, "qualification"))
            all_matches.extend(matches)
            qual_count = len(matches)
        except Exception:
            pass
        time.sleep(delay)

    qual_str = f" + {qual_count} qual" if qual_count else ""
    print(f"    e={eid:>4}  {event_record['event_name']:<30}  {main_count} main{qual_str}")
    return all_matches

# ── Main ──────────────────────────────────────────────────────────────────────

def run(input_file, output_file, filter_tournament=None, filter_event=None, delay=1.0):
    with open(input_file) as f:
        events = json.load(f)

    if filter_tournament:
        events = [e for e in events if e["tournament_id"] == filter_tournament]
    if filter_event:
        events = [e for e in events if e["event_id"] == filter_event]

    if not events:
        print("✗ No matching events found")
        return

    all_matches    = []
    current_t      = None

    for ev in events:
        tid = ev["tournament_id"]
        if tid != current_t:
            current_t = tid
            print(f"\n── t={tid} {ev['slug']} ({ev['season']}) ──")
        all_matches.extend(scrape_event(ev, delay))

    with open(output_file, "w") as f:
        json.dump(all_matches, f, indent=2, ensure_ascii=False)

    print(f"\n{'─'*60}")
    print(f"✓ {len(all_matches)} total matches saved to {output_file}")

    print("\nBy season:")
    for s, c in sorted(Counter(m["season"] for m in all_matches).items()):
        print(f"  {s}: {c:>6}")

    print("\nBy event type:")
    for n, c in sorted(Counter(m["event_name"] for m in all_matches).items(), key=lambda x: -x[1])[:15]:
        print(f"  {c:>5}  {n}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input",      type=str,   default="ttfi_events.json")
    parser.add_argument("--output",     type=str,   default="ttfi_matches.json")
    parser.add_argument("--tournament", type=int)
    parser.add_argument("--event",      type=int)
    parser.add_argument("--delay",      type=float, default=1.0)
    args = parser.parse_args()
    run(args.input, args.output, args.tournament, args.event, args.delay)
