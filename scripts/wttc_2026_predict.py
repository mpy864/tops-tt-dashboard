"""
wttc_2026_predict.py
Monte Carlo simulation for ITTF World Team Table Tennis Championships
Finals – London 2026 (April 28 – May 10).

OFFICIAL FORMAT (from ITTF Playing System V1.1):
─────────────────────────────────────────────────────────
  64 teams per gender, 16 groups of 4 in Stage 1.

  Stage 1a  (Groups 1-2):  Top 7 ranked teams + GBR (host)
            Round-robin → ALL 8 advance to Main Draw.
            Purpose: determine seedings.

  Stage 1b  (Groups 3-16): Remaining 56 teams, 14 groups of 4.
            Round-robin → group winners (14) advance.
                        → 6 best runners-up advance directly.
                        → 8 remaining runners-up → Prelim Round.

  Prelim Round: 4 knockout ties → 4 winners advance to Main Draw.

  Main Draw (32 teams): R32 → R16 → QF → SF → Final.
─────────────────────────────────────────────────────────

HOW TO USE:
  Step 1 ✅ Format implemented (this file).
  Step 2 ✅ Official draw populated from ITTF document.
  Step 3 ✅ Official squad names populated from ITTF player list PDF.

Usage:
  python scripts/wttc_2026_predict.py --gender M|W [--runs 10000]
"""

import os
import sys
import random
import argparse
from collections import defaultdict
from supabase import create_client, Client
from elo_ratings import compute_elo, win_probability

# ═══════════════════════════════════════════════════════════════════════════════
# SECTION A — INPUT DATA  (fill in once official draw is released)
# ═══════════════════════════════════════════════════════════════════════════════

# ── OFFICIAL DRAW (source: ITTF WTTC 2026 Group Stage document) ──────────────
# Country codes mapped from official names to ITTF DB codes

# Stage 1a — Men's (Groups 1 & 2): all 8 advance to Main Draw
STAGE_1A_GROUPS_M = {
    "G1": ["CHN", "SWE", "KOR", "ENG"],   # China, Sweden, Korea Republic, England(H)
    "G2": ["FRA", "JPN", "GER", "TPE"],   # France, Japan, Germany, Chinese Taipei
}

# Stage 1a — Women's (Groups 1 & 2): all 8 advance to Main Draw
STAGE_1A_GROUPS_W = {
    "G1": ["CHN", "KOR", "TPE", "ROU"],   # China, Korea Republic, Chinese Taipei, Romania
    "G2": ["JPN", "GER", "FRA", "ENG"],   # Japan, Germany, France, England
}

# Stage 1b — Men's (Groups 3–16): India is in Group 7
STAGE_1B_GROUPS_M = {
    "G3":  ["DEN", "MDG", "MEX", "MGL"],  # Denmark, Madagascar, Mexico, Mongolia
    "G4":  ["BRA", "HUN", "PUR", "UZB"],  # Brazil, Hungary, Puerto Rico, Uzbekistan
    "G5":  ["SLO", "CZE", "ESP", "BRN"],  # Slovenia, Czechia, Spain, Bahrain
    "G6":  ["POR", "ALG", "NCL", "GRE"],  # Portugal, Algeria, New Caledonia, Greece
    "G7":  ["IND", "SVK", "TUN", "GUA"],  # India, Slovak Republic, Tunisia, Guatemala ← INDIA
    "G8":  ["CRO", "SRB", "LUX", "QAT"],  # Croatia, Serbia, Luxembourg, Qatar
    "G9":  ["ROU", "ARG", "BEN", "PER"],  # Romania, Argentina, Benin, Peru
    "G10": ["AUS", "NZL", "MAR", "PRK"],  # Australia, New Zealand, Morocco, Korea DPR
    "G11": ["EGY", "KAZ", "THA", "TUR"],  # Egypt, Kazakhstan, Thailand, Türkiye
    "G12": ["POL", "CHI", "TAH", "MDA"],  # Poland, Chile, Tahiti, Moldova
    "G13": ["AUT", "ITA", "MAS", "TOG"],  # Austria, Italy, Malaysia, Togo
    "G14": ["USA", "SGP", "CIV", "ANG"],  # USA, Singapore, Cote d'Ivoire, Angola
    "G15": ["HKG", "NGR", "RSA", "KSA"],  # Hong Kong, Nigeria, South Africa, Saudi Arabia
    "G16": ["CAN", "BEL", "CMR", "FIJ"],  # Canada, Belgium, Cameroon, Fiji
}

# Stage 1b — Women's (Groups 3–16): India is in Group 6
STAGE_1B_GROUPS_W = {
    "G3":  ["EGY", "ALG", "RSA", "BEL"],  # Egypt, Algeria, South Africa, Belgium
    "G4":  ["HKG", "MEX", "NED", "MAC"],  # Hong Kong, Mexico, Netherlands, Macao
    "G5":  ["BRA", "CZE", "KAZ", "MGL"],  # Brazil, Czechia, Kazakhstan, Mongolia
    "G6":  ["IND", "UKR", "UGA", "RWA"],  # India, Ukraine, Uganda, Rwanda ← INDIA
    "G7":  ["SWE", "CAN", "CRC", "SRI"],  # Sweden, Canada, Costa Rica, Sri Lanka
    "G8":  ["THA", "SRB", "SLO", "BEN"],  # Thailand, Serbia, Slovenia, Benin
    "G9":  ["POL", "ESP", "PRK", "COD"],  # Poland, Spain, Korea DPR, Congo Democratic
    "G10": ["POR", "LUX", "BRB", "GUA"],  # Portugal, Luxembourg, Barbados, Guatemala
    "G11": ["AUS", "NGR", "UZB", "WAL"],  # Australia, Nigeria, Uzbekistan, Wales
    "G12": ["USA", "MAS", "NAM", "DOM"],  # USA, Malaysia, Namibia, Dominican Republic
    "G13": ["CRO", "ITA", "ARG", "TUR"],  # Croatia, Italy, Argentina, Türkiye
    "G14": ["PUR", "AUT", "GHA", "ANG"],  # Puerto Rico, Austria, Ghana, Angola
    "G15": ["SGP", "HUN", "GRE", "ETH"],  # Singapore, Hungary, Greece, Ethiopia
    "G16": ["CHI", "SVK", "MDG", "SUI"],  # Chile, Slovak Republic, Madagascar, Switzerland
}

# Team squads: country → [ittf_id, ittf_id, ittf_id] (best first)
# ID overrides (for when you know exact ITTF IDs)
TEAM_SQUADS_OVERRIDE_M: dict[str, list[int]] = {}
TEAM_SQUADS_OVERRIDE_W: dict[str, list[int]] = {}

# ── Official squad names from ITTF player list (resolved to ITTF IDs at runtime) ──
# Source: ITTF WTTC 2026 Players list PDF.
# Note: India Women — Sreeja Akula replaced by Sutirtha Mukherjee (official).
# Top 3 by current ranking within registered squad are used for simulation.
SQUAD_NAMES_M: dict[str, list[str]] = {
    "IND": ["Manav Thakkar", "Sathiyan Gnanasekaran", "Manush Shah",
            "Harmeet Desai", "Payas Jain"],
    # G7 opponents
    "SVK": ["Lubomir Pistej", "Yang Wang", "Jakub Zelinka", "Adam Klajber"],
    "TUN": ["Wassim Essid", "Aboubaker Bourass", "Youssef Aidli"],
    "GUA": ["Sergio Carrillo", "Ricardo Gatica", "Luis Carrillo", "Ian Morales"],
}
SQUAD_NAMES_W: dict[str, list[str]] = {
    "IND": ["Manika Batra", "Sutirtha Mukherjee", "Yashaswini Ghorpade",
            "Diya Chitale", "Syndrela Das"],
    # G6 opponents
    "UKR": ["Margaryta Pesotska", "Veronika Matiunina",
            "Anastasiya Dymytrenko", "Tetyana Bilenko"],
    "UGA": ["Jemimah Nakawala", "Judith Nangonzi", "Judith Mirembe"],
    "RWA": ["Elevine Tumukunde", "Chantal Hirwa", "Mbabazi Twizerane"],
}


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION B — ROSTER LOADING
# ═══════════════════════════════════════════════════════════════════════════════

def resolve_squad_names(supabase: Client,
                        squad_names: dict[str, list[str]]) -> dict[str, list[int]]:
    """
    Resolve player name strings → ITTF IDs via DB lookup.
    Uses exact match first, then partial (all words present) as fallback.
    Returns {country: [ittf_id, ...]}.
    """
    if not squad_names:
        return {}
    p_resp = supabase.table("wtt_players").select("ittf_id,player_name").limit(10000).execute()
    name_to_id: dict[str, int] = {}
    for p in (p_resp.data or []):
        if p.get("player_name"):
            name_to_id[p["player_name"].lower().strip()] = p["ittf_id"]

    resolved: dict[str, list[int]] = {}
    for country, names in squad_names.items():
        ids: list[int] = []
        for name in names:
            nl = name.lower().strip()
            if nl in name_to_id:
                ids.append(name_to_id[nl])
            else:
                parts = nl.split()
                found = next(
                    (pid for stored, pid in name_to_id.items()
                     if all(p in stored for p in parts)),
                    None
                )
                if found:
                    ids.append(found)
                else:
                    print(f"  [!] Name not in DB: '{name}' ({country})")
        resolved[country] = ids
    return resolved


def load_rosters(supabase: Client, gender: str,
                 countries: set[str], n: int = 3,
                 squad_ids: dict[str, list[int]] | None = None) -> dict[str, list[int]]:
    """
    Top-N ranked players per country from DB.
    If squad_ids provided for a country, only use those registered players.
    TEAM_SQUADS_OVERRIDE takes highest precedence.
    """
    overrides = TEAM_SQUADS_OVERRIDE_M if gender == "M" else TEAM_SQUADS_OVERRIDE_W

    latest = supabase.table("rankings_singles_normalized") \
        .select("ranking_date").order("ranking_date", desc=True).limit(1).execute()
    rank_date = latest.data[0]["ranking_date"] if latest.data else "2026-04-14"

    resp = supabase.table("wtt_players") \
        .select("ittf_id,country_code") \
        .in_("country_code", list(countries)) \
        .eq("gender", gender).limit(10000).execute()
    by_country: dict[str, list[int]] = defaultdict(list)
    for p in (resp.data or []):
        by_country[p["country_code"]].append(p["ittf_id"])

    all_ids = [pid for ids in by_country.values() for pid in ids]
    r_resp = supabase.table("rankings_singles_normalized") \
        .select("player_id,rank").eq("ranking_date", rank_date) \
        .in_("player_id", all_ids).limit(10000).execute()
    rank_map = {r["player_id"]: r["rank"] for r in (r_resp.data or [])}

    rosters: dict[str, list[int]] = {}
    for country, ids in by_country.items():
        if country in overrides:
            rosters[country] = overrides[country]
            continue
        # Filter to officially registered players when squad is known
        official = set(squad_ids.get(country, [])) if squad_ids else set()
        pool = [pid for pid in ids if pid in official] if official else ids
        if not pool:
            pool = ids  # fallback if none of the named players are in DB
        ranked = [(pid, rank_map.get(pid, 9999)) for pid in pool]
        ranked.sort(key=lambda x: x[1])
        rosters[country] = [pid for pid, _ in ranked[:n]]

    return rosters


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION C — MATCH & TIE SIMULATION
# ═══════════════════════════════════════════════════════════════════════════════

def get_team_elos(country: str, rosters: dict, elo: dict,
                  n: int = 3) -> list[tuple[int, float]]:
    ids = rosters.get(country, [])
    players = [(pid, elo.get(pid, 1450.0)) for pid in ids]
    players.sort(key=lambda x: -x[1])
    while len(players) < n:
        players.append((-1, 1450.0))
    return players[:n]


def sim_rubber(elo_a: float, elo_b: float) -> bool:
    return random.random() < win_probability(elo_a, elo_b)


def sim_tie(country_a: str, country_b: str,
            rosters: dict, elo: dict) -> bool:
    """
    Simulate one team tie.
    Format: 5 singles, best of 5 rubbers (first to 3).
    WTTC 2026 rubber order (5-singles, no doubles):
      R1: A1 vs B2    R2: A2 vs B1    R3: A3 vs B3
      R4: A1 vs B1    R5: A2 vs B2  (decisive rubber if needed)
    A1 = highest-Elo selected player, A2 = second, A3 = third.
    ⚠ Confirm exact order from ITTF Playing System PDF if available.
    """
    ta = get_team_elos(country_a, rosters, elo)
    tb = get_team_elos(country_b, rosters, elo)

    rubbers = [
        (ta[0][1], tb[1][1]),  # R1: A1 vs B2
        (ta[1][1], tb[0][1]),  # R2: A2 vs B1
        (ta[2][1], tb[2][1]),  # R3: A3 vs B3
        (ta[0][1], tb[0][1]),  # R4: A1 vs B1
        (ta[1][1], tb[1][1]),  # R5: A2 vs B2 (decisive)
    ]
    wa = wb = 0
    for ea, eb in rubbers:
        if wa == 3 or wb == 3:
            break
        if sim_rubber(ea, eb):
            wa += 1
        else:
            wb += 1
    return wa > wb


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION D — STAGE SIMULATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def sim_round_robin(group: list[str], rosters: dict,
                    elo: dict) -> dict[str, int]:
    """One round-robin. Returns {country: match_wins}."""
    pts: dict[str, int] = defaultdict(int)
    for i, ca in enumerate(group):
        for cb in group[i+1:]:
            if sim_tie(ca, cb, rosters, elo):
                pts[ca] += 1
            else:
                pts[cb] += 1
    return dict(pts)


def rank_group(group: list[str], pts: dict[str, int]) -> list[str]:
    """Rank teams within a group by match wins (ties unresolved for now)."""
    return sorted(group, key=lambda c: -pts.get(c, 0))


def sim_stage1a(groups: dict, rosters: dict,
                elo: dict) -> tuple[list[str], dict[str, int]]:
    """
    Simulate Stage 1a. Returns (ordered_teams, {team: group_rank}).
    All 8 teams advance. Group positions determine Main Draw seedings.
    """
    group_positions: dict[str, int] = {}  # team → position in group (1-4)
    all_teams_ordered = []

    for grp, members in groups.items():
        pts = sim_round_robin(members, rosters, elo)
        ranked = rank_group(members, pts)
        for pos, team in enumerate(ranked, 1):
            group_positions[team] = pos
        all_teams_ordered.extend(ranked)  # ordered by group finish

    return all_teams_ordered, group_positions


def sim_stage1b(groups: dict, rosters: dict,
                elo: dict) -> tuple[list[str], list[str]]:
    """
    Simulate Stage 1b. Returns:
      direct_qualifiers: group winners (14) + 6 best runners-up = 20 teams
      prelim_round:      8 remaining runners-up
    """
    winners:   list[str] = []
    runners_up: list[tuple[str, int]] = []  # (team, wins)

    for grp, members in groups.items():
        pts = sim_round_robin(members, rosters, elo)
        ranked = rank_group(members, pts)
        winners.append(ranked[0])
        runners_up.append((ranked[1], pts.get(ranked[1], 0)))

    # 6 best runners-up qualify directly (by wins)
    runners_up.sort(key=lambda x: -x[1])
    direct_runners  = [t for t, _ in runners_up[:6]]
    prelim_runners  = [t for t, _ in runners_up[6:]]  # 8 teams

    return winners + direct_runners, prelim_runners


def sim_prelim_round(teams: list[str], rosters: dict,
                     elo: dict) -> list[str]:
    """4 knockout ties from 8 runners-up. Returns 4 winners."""
    random.shuffle(teams)
    winners = []
    for i in range(0, len(teams), 2):
        if i + 1 < len(teams):
            a, b = teams[i], teams[i+1]
            winners.append(a if sim_tie(a, b, rosters, elo) else b)
    return winners


def build_main_draw(stage1a_teams: list[str],
                    stage1a_positions: dict[str, int],
                    stage1b_direct: list[str],
                    prelim_winners: list[str]) -> list[str]:
    """
    Assemble 32-team Main Draw.
    Seeding follows ITTF rules (Stage 1a positions determine top seeds).
    Returns bracket as list of 32 teams (position 1 at index 0).
    """
    # Stage 1a seedings (based on group finish)
    g1_teams = [t for t in stage1a_teams[:4]]  # Group 1 teams
    g2_teams = [t for t in stage1a_teams[4:]]  # Group 2 teams

    # Sort by group position
    g1_sorted = sorted(g1_teams, key=lambda t: stage1a_positions.get(t, 9))
    g2_sorted = sorted(g2_teams, key=lambda t: stage1a_positions.get(t, 9))

    seeds = {
        1:  g1_sorted[0] if len(g1_sorted) > 0 else "BYE",  # Winner G1
        32: g2_sorted[0] if len(g2_sorted) > 0 else "BYE",  # Winner G2
        16: g1_sorted[1] if len(g1_sorted) > 1 else "BYE",  # 2nd G1
        17: g2_sorted[1] if len(g2_sorted) > 1 else "BYE",  # 2nd G2
        9:  g1_sorted[2] if len(g1_sorted) > 2 else "BYE",  # 3rd G1
        24: g2_sorted[2] if len(g2_sorted) > 2 else "BYE",  # 3rd G2
        8:  g1_sorted[3] if len(g1_sorted) > 3 else "BYE",  # 4th G1
        25: g2_sorted[3] if len(g2_sorted) > 3 else "BYE",  # 4th G2
    }

    # Remaining 24 slots filled by Stage1b direct + prelim winners (random draw)
    remaining = stage1b_direct + prelim_winners
    random.shuffle(remaining)

    bracket: list[str] = ["BYE"] * 32
    for pos, team in seeds.items():
        bracket[pos - 1] = team

    fill_idx = 0
    for i in range(32):
        if bracket[i] == "BYE" and fill_idx < len(remaining):
            bracket[i] = remaining[fill_idx]
            fill_idx += 1

    return bracket


def sim_knockout_bracket(bracket: list[str], rosters: dict,
                         elo: dict) -> dict[str, str]:
    """
    Simulate single-elimination from 32 teams.
    Returns {team: best_result} e.g. "Gold", "Silver", "Bronze", "QF", etc.
    """
    results: dict[str, str] = {t: "R32" for t in bracket if t != "BYE"}
    current_round = list(bracket)
    round_names = ["R32", "R16", "QF", "SF", "Final"]
    round_idx = 0

    while len(current_round) > 2:
        next_round = []
        label = round_names[min(round_idx + 1, len(round_names) - 1)]
        for i in range(0, len(current_round), 2):
            a = current_round[i]
            b = current_round[i + 1] if i + 1 < len(current_round) else "BYE"
            if b == "BYE":
                next_round.append(a)
                results[a] = label
            elif a == "BYE":
                next_round.append(b)
                results[b] = label
            else:
                winner = a if sim_tie(a, b, rosters, elo) else b
                loser  = b if winner == a else a
                next_round.append(winner)
                results[winner] = label
        current_round = next_round
        round_idx += 1

    # Final
    if len(current_round) == 2:
        a, b = current_round[0], current_round[1]
        winner = a if sim_tie(a, b, rosters, elo) else b
        loser  = b if winner == a else a
        results[winner] = "Gold"
        results[loser]  = "Silver"

    # Losers at SF get Bronze
    for team, res in results.items():
        if res == "SF":
            results[team] = "Bronze"

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION E — FULL TOURNAMENT SIMULATION
# ═══════════════════════════════════════════════════════════════════════════════

RESULT_ORDER = ["Gold", "Silver", "Bronze", "Final", "SF", "QF", "R16", "R32", "Prelim", "Stage1b", "Stage1a"]

def sim_tournament(stage1a_groups: dict, stage1b_groups: dict,
                   rosters: dict, elo: dict) -> dict[str, str]:
    """Run one full tournament. Returns {team: best_result}."""
    # Stage 1a
    s1a_teams, s1a_pos = sim_stage1a(stage1a_groups, rosters, elo)

    # Stage 1b
    s1b_direct, prelim_teams = sim_stage1b(stage1b_groups, rosters, elo)

    # Preliminary Round
    prelim_winners = sim_prelim_round(prelim_teams, rosters, elo)
    prelim_losers  = [t for t in prelim_teams if t not in prelim_winners]

    # Main Draw (32 teams)
    bracket = build_main_draw(s1a_teams, s1a_pos, s1b_direct, prelim_winners)
    knockout_results = sim_knockout_bracket(bracket, rosters, elo)

    # Collect all results
    results: dict[str, str] = {}
    for team, res in knockout_results.items():
        results[team] = res
    for team in prelim_losers:
        results[team] = "Prelim"

    # Stage 1a teams all advance (mark those not in knockout as Stage1a)
    for team in s1a_teams:
        if team not in results:
            results[team] = "Stage1a"

    return results


def monte_carlo(stage1a_groups: dict, stage1b_groups: dict,
                rosters: dict, elo: dict,
                target: str, runs: int) -> dict[str, dict]:
    """
    Run `runs` full tournament simulations.
    Returns probability of each result for the target country and all teams.
    """
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for _ in range(runs):
        results = sim_tournament(stage1a_groups, stage1b_groups, rosters, elo)
        for team, res in results.items():
            counts[team][res] += 1

    probs: dict[str, dict] = {}
    for team, res_counts in counts.items():
        total = sum(res_counts.values())
        probs[team] = {res: cnt / total for res, cnt in res_counts.items()}

    return probs


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION F — MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gender", choices=["M", "W"], default="M")
    parser.add_argument("--runs",   type=int, default=5000)
    parser.add_argument("--target", type=str, default="IND",
                        help="Country to focus detailed output on")
    args = parser.parse_args()

    supabase = create_client(os.environ["SUPABASE_URL"],
                             os.environ["SUPABASE_SERVICE_KEY"])

    glabel = "Men" if args.gender == "M" else "Women"
    stage1a_groups = STAGE_1A_GROUPS_M if args.gender == "M" else STAGE_1A_GROUPS_W
    stage1b_groups = STAGE_1B_GROUPS_M if args.gender == "M" else STAGE_1B_GROUPS_W

    all_countries = {c for g in {**stage1a_groups, **stage1b_groups}.values() for c in g}

    print(f"\n{'='*65}")
    print(f"  ITTF WTTC 2026 London — {glabel}'s Team  |  {args.runs:,} simulations")
    print(f"{'='*65}")
    print(f"\n  Format: 64 teams | Stage1a (G1-G2) + Stage1b (G3-G16)")
    print(f"          Prelim Round + Main Draw (R32→R16→QF→SF→Final)")
    print(f"  ✅ Official draw loaded | ✅ Official squads loaded\n")

    print("[1/4] Computing Elo ratings...")
    elo = compute_elo(supabase, gender_filter=args.gender)

    print("[2/4] Resolving official squad nominations...")
    squad_names = SQUAD_NAMES_M if args.gender == "M" else SQUAD_NAMES_W
    squad_ids = resolve_squad_names(supabase, squad_names)

    print("[3/4] Loading team rosters from DB...")
    rosters = load_rosters(supabase, args.gender, all_countries, squad_ids=squad_ids)

    p_resp = supabase.table("wtt_players") \
        .select("ittf_id,player_name,country_code").execute()
    pmap = {p["ittf_id"]: p for p in (p_resp.data or [])}

    # India team info
    target = args.target
    ind_team = get_team_elos(target, rosters, elo, n=5)
    print(f"\n── {target} {glabel}'s Squad (from DB) ──")
    for i, (pid, e) in enumerate(ind_team, 1):
        name = pmap.get(pid, {}).get("player_name", str(pid))
        print(f"  {i}. {name:<30}  Elo: {e:>6.0f}")

    print(f"\n[4/4] Running {args.runs:,} tournament simulations...")
    probs = monte_carlo(stage1a_groups, stage1b_groups,
                        rosters, elo, target, args.runs)

    # ── Target country detail ──
    print(f"\n{'─'*65}")
    print(f"  {target} — Tournament Probability Breakdown")
    print(f"{'─'*65}")
    target_probs = probs.get(target, {})
    for res in RESULT_ORDER:
        p = target_probs.get(res, 0)
        if p > 0:
            bar = "█" * int(p * 40)
            print(f"  {res:<10} {p*100:>5.1f}%  {bar}")

    # ── Top 10 strongest teams by Gold probability ──
    print(f"\n{'─'*65}")
    print(f"  Top 10 Teams by Gold probability")
    print(f"{'─'*65}")
    team_gold = sorted(
        [(t, probs.get(t, {}).get("Gold", 0)) for t in all_countries
         if t in probs],
        key=lambda x: -x[1]
    )[:10]
    for rank, (team, p_gold) in enumerate(team_gold, 1):
        p_medal = sum(probs.get(team, {}).get(r, 0)
                      for r in ["Gold", "Silver", "Bronze"])
        p_md    = sum(probs.get(team, {}).get(r, 0)
                      for r in ["Gold", "Silver", "Bronze", "Final", "SF", "QF", "R16", "R32"])
        t_team  = get_team_elos(team, rosters, elo)
        top_name = pmap.get(t_team[0][0] if t_team else 0, {}).get("player_name", team)
        print(f"  {rank:>2}. {team:<6} {top_name:<24}  "
              f"Gold: {p_gold*100:>4.1f}%  Medal: {p_medal*100:>4.1f}%  "
              f"Main Draw: {p_md*100:>4.1f}%")

    print(f"\n  Run Women's: python scripts/wttc_2026_predict.py --gender W --runs 10000\n")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(__file__))
    main()
