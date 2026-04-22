"""
wttc_simulate.py — ITTF WTTC 2026 London Tournament Simulator
Uses the V8 MatchPredictor (feature_model.py) for per-rubber win probabilities.
Exact DP computes P(team A wins tie); Monte Carlo simulates the full tournament.

Usage:
  python scripts/wttc_simulate.py --gender M --runs 5000
  python scripts/wttc_simulate.py --gender W --runs 5000
  python scripts/wttc_simulate.py --gender M --runs 10000 --push
"""

import os, sys, random, argparse, json
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

from supabase import create_client, Client
from feature_model import MatchPredictor

# ── re-use draw + squad data from existing script ──────────────────────────
from wttc_2026_predict import (
    STAGE_1A_GROUPS_M, STAGE_1A_GROUPS_W,
    STAGE_1B_GROUPS_M, STAGE_1B_GROUPS_W,
    SQUAD_NAMES_M, SQUAD_NAMES_W,
    RESULT_ORDER,
    resolve_squad_names, load_rosters,
)

# ═══════════════════════════════════════════════════════════════════════════
# SECTION A — TIE PROBABILITY (exact DP)
# ═══════════════════════════════════════════════════════════════════════════

# WTTC 2026 rubber order (5 singles, first to 3 rubbers wins):
#   R1: A1 vs B2    R2: A2 vs B1    R3: A3 vs B3
#   R4: A1 vs B1    R5: A2 vs B2  (only played if needed)
RUBBER_SLOTS = [
    (0, 1),  # R1: A1 vs B2
    (1, 0),  # R2: A2 vs B1
    (2, 2),  # R3: A3 vs B3
    (0, 0),  # R4: A1 vs B1
    (1, 1),  # R5: A2 vs B2
]


def p_win_tie(rubber_probs: list[float]) -> float:
    """
    Exact DP: given 5 per-rubber P(A wins rubber), return P(A wins tie).
    Rubbers stop once one team reaches 3.
    """
    dp = {(0, 0): 1.0}
    for pk in rubber_probs:
        next_dp: dict[tuple, float] = {}
        for (wa, wb), prob in dp.items():
            if wa == 3 or wb == 3:
                next_dp[(wa, wb)] = next_dp.get((wa, wb), 0.0) + prob
            else:
                sa = (wa + 1, wb)
                sb = (wa, wb + 1)
                next_dp[sa] = next_dp.get(sa, 0.0) + prob * pk
                next_dp[sb] = next_dp.get(sb, 0.0) + prob * (1 - pk)
        dp = next_dp
    return sum(p for (wa, wb), p in dp.items() if wa == 3)


def rubber_probs_for_tie(team_a: str, team_b: str,
                          rosters: dict[str, list[int]],
                          mp: MatchPredictor) -> list[float]:
    """
    Compute 5 rubber win probabilities for team A vs B.
    Falls back to 0.5 for players not in the model.
    """
    ids_a = rosters.get(team_a, [])
    ids_b = rosters.get(team_b, [])

    def pid(team_ids: list[int], slot: int) -> int | None:
        return team_ids[slot] if slot < len(team_ids) else None

    probs = []
    for slot_a, slot_b in RUBBER_SLOTS:
        pa = pid(ids_a, slot_a)
        pb = pid(ids_b, slot_b)
        if pa and pb:
            probs.append(mp.predict(pa, pb))
        else:
            probs.append(0.5)
    return probs


_tie_cache: dict[tuple, float] = {}


def p_tie_cached(team_a: str, team_b: str,
                  rosters: dict, mp: MatchPredictor) -> float:
    key = (team_a, team_b)
    if key not in _tie_cache:
        rp = rubber_probs_for_tie(team_a, team_b, rosters, mp)
        _tie_cache[key] = p_win_tie(rp)
    return _tie_cache[key]


def sim_tie(team_a: str, team_b: str,
            rosters: dict, mp: MatchPredictor) -> bool:
    """Returns True if team_a wins (random draw vs exact DP probability)."""
    return random.random() < p_tie_cached(team_a, team_b, rosters, mp)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION B — STAGE SIMULATIONS  (same logic as wttc_2026_predict.py)
# ═══════════════════════════════════════════════════════════════════════════

def sim_round_robin(group: list[str], rosters: dict,
                    mp: MatchPredictor) -> dict[str, int]:
    pts: dict[str, int] = defaultdict(int)
    for i, ca in enumerate(group):
        for cb in group[i + 1:]:
            if sim_tie(ca, cb, rosters, mp):
                pts[ca] += 1
            else:
                pts[cb] += 1
    return dict(pts)


def rank_group(group: list[str], pts: dict[str, int]) -> list[str]:
    return sorted(group, key=lambda c: -pts.get(c, 0))


def sim_stage1a(groups: dict, rosters: dict,
                mp: MatchPredictor) -> tuple[list[str], dict[str, int]]:
    group_positions: dict[str, int] = {}
    all_teams_ordered = []
    for _grp, members in groups.items():
        pts = sim_round_robin(members, rosters, mp)
        ranked = rank_group(members, pts)
        for pos, team in enumerate(ranked, 1):
            group_positions[team] = pos
        all_teams_ordered.extend(ranked)
    return all_teams_ordered, group_positions


def sim_stage1b(groups: dict, rosters: dict,
                mp: MatchPredictor) -> tuple[list[str], list[str]]:
    winners: list[str] = []
    runners_up: list[tuple[str, int]] = []
    for _grp, members in groups.items():
        pts = sim_round_robin(members, rosters, mp)
        ranked = rank_group(members, pts)
        winners.append(ranked[0])
        runners_up.append((ranked[1], pts.get(ranked[1], 0)))
    runners_up.sort(key=lambda x: -x[1])
    direct_runners = [t for t, _ in runners_up[:6]]
    prelim_runners = [t for t, _ in runners_up[6:]]
    return winners + direct_runners, prelim_runners


def sim_prelim_round(teams: list[str], rosters: dict,
                     mp: MatchPredictor) -> list[str]:
    random.shuffle(teams)
    winners = []
    for i in range(0, len(teams), 2):
        if i + 1 < len(teams):
            a, b = teams[i], teams[i + 1]
            winners.append(a if sim_tie(a, b, rosters, mp) else b)
    return winners


def build_main_draw(stage1a_teams: list[str],
                    stage1a_positions: dict[str, int],
                    stage1b_direct: list[str],
                    prelim_winners: list[str]) -> list[str]:
    g1_teams = stage1a_teams[:4]
    g2_teams = stage1a_teams[4:]
    g1_sorted = sorted(g1_teams, key=lambda t: stage1a_positions.get(t, 9))
    g2_sorted = sorted(g2_teams, key=lambda t: stage1a_positions.get(t, 9))
    seeds = {
        1:  g1_sorted[0] if g1_sorted      else "BYE",
        32: g2_sorted[0] if g2_sorted      else "BYE",
        16: g1_sorted[1] if len(g1_sorted) > 1 else "BYE",
        17: g2_sorted[1] if len(g2_sorted) > 1 else "BYE",
        9:  g1_sorted[2] if len(g1_sorted) > 2 else "BYE",
        24: g2_sorted[2] if len(g2_sorted) > 2 else "BYE",
        8:  g1_sorted[3] if len(g1_sorted) > 3 else "BYE",
        25: g2_sorted[3] if len(g2_sorted) > 3 else "BYE",
    }
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
                         mp: MatchPredictor) -> dict[str, str]:
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
                winner = a if sim_tie(a, b, rosters, mp) else b
                loser  = b if winner == a else a
                next_round.append(winner)
                results[winner] = label
        current_round = next_round
        round_idx += 1
    if len(current_round) == 2:
        a, b = current_round[0], current_round[1]
        winner = a if sim_tie(a, b, rosters, mp) else b
        loser  = b if winner == a else a
        results[winner] = "Gold"
        results[loser]  = "Silver"
    for team, res in results.items():
        if res == "SF":
            results[team] = "Bronze"
    return results


# ═══════════════════════════════════════════════════════════════════════════
# SECTION C — FULL TOURNAMENT + MONTE CARLO
# ═══════════════════════════════════════════════════════════════════════════

def sim_tournament(stage1a_groups: dict, stage1b_groups: dict,
                   rosters: dict, mp: MatchPredictor) -> dict[str, str]:
    """One full tournament simulation. Returns {team: best_result}."""
    s1a_teams, s1a_pos = sim_stage1a(stage1a_groups, rosters, mp)
    s1b_direct, prelim_teams = sim_stage1b(stage1b_groups, rosters, mp)
    prelim_winners = sim_prelim_round(prelim_teams, rosters, mp)
    prelim_losers  = [t for t in prelim_teams if t not in prelim_winners]
    bracket = build_main_draw(s1a_teams, s1a_pos, s1b_direct, prelim_winners)
    knockout_results = sim_knockout_bracket(bracket, rosters, mp)
    results: dict[str, str] = {**knockout_results}
    for team in prelim_losers:
        results[team] = "Prelim"
    for team in s1a_teams:
        if team not in results:
            results[team] = "Stage1a"
    return results


def monte_carlo(stage1a_groups: dict, stage1b_groups: dict,
                rosters: dict, mp: MatchPredictor,
                runs: int, verbose: bool = True) -> dict[str, dict[str, float]]:
    """
    Run `runs` full tournament simulations.
    Returns {team: {result: probability}}.
    """
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for i in range(runs):
        if verbose and i % 500 == 0:
            print(f"  … {i}/{runs}", end="\r", flush=True)
        results = sim_tournament(stage1a_groups, stage1b_groups, rosters, mp)
        for team, res in results.items():
            counts[team][res] += 1
    if verbose:
        print(f"  … {runs}/{runs} done      ")
    probs: dict[str, dict[str, float]] = {}
    for team, res_counts in counts.items():
        total = sum(res_counts.values())
        probs[team] = {res: cnt / total for res, cnt in res_counts.items()}
    return probs


# ═══════════════════════════════════════════════════════════════════════════
# SECTION D — SUPABASE PUSH
# ═══════════════════════════════════════════════════════════════════════════

def push_results(supabase: Client, gender: str,
                 probs: dict[str, dict[str, float]], runs: int) -> None:
    """Write simulation results to wttc_sim_results (replace latest run)."""
    rows = []
    for team, res_probs in probs.items():
        for result, prob in res_probs.items():
            rows.append({
                "gender":        gender,
                "team":          team,
                "result":        result,
                "probability":   round(prob, 6),
                "runs":          runs,
                "model_version": 8,
            })
    # Insert in batches of 500
    for i in range(0, len(rows), 500):
        supabase.table("wttc_sim_results").insert(rows[i:i + 500]).execute()
    print(f"  Pushed {len(rows)} rows to wttc_sim_results ({gender})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION E — LINEUP UTILITY (matchup-level probabilities)
# ═══════════════════════════════════════════════════════════════════════════

def compute_matchup(team_a: str, team_b: str,
                    rosters: dict, mp: MatchPredictor,
                    pmap: dict) -> dict:
    """Return matchup details for a specific team pair."""
    ids_a = rosters.get(team_a, [])
    ids_b = rosters.get(team_b, [])
    rp = rubber_probs_for_tie(team_a, team_b, rosters, mp)
    p_win = p_win_tie(rp)
    rubber_labels = ["A1 vs B2", "A2 vs B1", "A3 vs B3", "A1 vs B1", "A2 vs B2"]
    rubber_details = []
    for k, (prob, (sa, sb)) in enumerate(zip(rp, RUBBER_SLOTS)):
        pa = ids_a[sa] if sa < len(ids_a) else None
        pb = ids_b[sb] if sb < len(ids_b) else None
        rubber_details.append({
            "label":    rubber_labels[k],
            "player_a": pmap.get(pa, {}).get("player_name", str(pa)) if pa else "?",
            "player_b": pmap.get(pb, {}).get("player_name", str(pb)) if pb else "?",
            "p_win":    round(prob, 4),
        })
    return {
        "team_a":        team_a,
        "team_b":        team_b,
        "p_win":         round(p_win, 4),
        "rubber_details": rubber_details,
    }


# ═══════════════════════════════════════════════════════════════════════════
# SECTION F — MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="WTTC 2026 V8 Tournament Simulator")
    parser.add_argument("--gender", choices=["M", "W"], default="M")
    parser.add_argument("--runs",   type=int, default=5000)
    parser.add_argument("--target", type=str, default="IND",
                        help="Country code to show detailed output for")
    parser.add_argument("--push",   action="store_true",
                        help="Push results to Supabase wttc_sim_results table")
    parser.add_argument("--matchup", nargs=2, metavar=("TEAM_A", "TEAM_B"),
                        help="Show matchup breakdown for two teams (no simulation)")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL + SUPABASE_SERVICE_KEY (or VITE_ equivalents) in .env")
    supabase = create_client(url, key)

    gender = args.gender
    glabel = "Men" if gender == "M" else "Women"
    stage1a_groups = STAGE_1A_GROUPS_M if gender == "M" else STAGE_1A_GROUPS_W
    stage1b_groups = STAGE_1B_GROUPS_M if gender == "M" else STAGE_1B_GROUPS_W

    all_countries = {c for g in {**stage1a_groups, **stage1b_groups}.values()
                     for c in g}

    print(f"\n{'='*65}")
    print(f"  ITTF WTTC 2026 London — {glabel}'s Team  |  V8 MatchPredictor")
    print(f"{'='*65}")

    print("[1/3] Loading V8 MatchPredictor model…")
    mp = MatchPredictor.load(gender)
    print(f"  Model loaded — {len(mp.states):,} player states")

    print("[2/3] Resolving rosters…")
    squad_names = SQUAD_NAMES_M if gender == "M" else SQUAD_NAMES_W
    squad_ids   = resolve_squad_names(supabase, squad_names)
    rosters     = load_rosters(supabase, gender, all_countries, squad_ids=squad_ids)

    p_resp = supabase.table("wtt_players") \
        .select("ittf_id,player_name,country_code").limit(10000).execute()
    pmap = {p["ittf_id"]: p for p in (p_resp.data or [])}

    # ── Matchup mode ──────────────────────────────────────────────────────
    if args.matchup:
        ta, tb = args.matchup[0].upper(), args.matchup[1].upper()
        info = compute_matchup(ta, tb, rosters, mp, pmap)
        print(f"\n── {ta} vs {tb} ──────────────────────────────────────")
        print(f"  P({ta} wins tie) = {info['p_win']*100:.1f}%")
        print()
        for rd in info["rubber_details"]:
            print(f"  {rd['label']:<12}  {rd['player_a']:<28} vs {rd['player_b']:<28}"
                  f"  P(A) = {rd['p_win']*100:.1f}%")
        return

    # ── India squad preview ───────────────────────────────────────────────
    target = args.target
    ind_ids = rosters.get(target, [])
    print(f"\n── {target} {glabel}'s Roster (top 3 for simulation) ──")
    for i, pid in enumerate(ind_ids[:3], 1):
        st = mp.get_state(pid)
        name = pmap.get(pid, {}).get("player_name", str(pid))
        print(f"  {i}. {name:<32}  Elo: {st['elo']:>6.0f}  "
              f"EloRecent: {st.get('elo_recent', st['elo']):>6.0f}")

    # Show group opponents matchup odds
    target_group = None
    for gid, members in {**stage1a_groups, **stage1b_groups}.items():
        if target in members:
            target_group = (gid, members)
            break
    if target_group:
        gid, members = target_group
        print(f"\n── {target} Group {gid} matchups ──")
        for opp in members:
            if opp == target:
                continue
            p = p_tie_cached(target, opp, rosters, mp)
            print(f"  {target} vs {opp:<6}  P(win) = {p*100:.1f}%")

    # ── Monte Carlo ────────────────────────────────────────────────────────
    print(f"\n[3/3] Running {args.runs:,} tournament simulations…")
    _tie_cache.clear()   # reset cache for fresh simulation run
    probs = monte_carlo(stage1a_groups, stage1b_groups, rosters, mp,
                        runs=args.runs, verbose=True)

    # ── Target country detail ─────────────────────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  {target} — Tournament Probability Breakdown")
    print(f"{'─'*65}")
    target_probs = probs.get(target, {})
    for res in RESULT_ORDER:
        p = target_probs.get(res, 0)
        if p > 0:
            bar = "█" * int(p * 40)
            print(f"  {res:<10} {p*100:>5.1f}%  {bar}")

    # ── Top 16 by Gold probability ─────────────────────────────────────────
    print(f"\n{'─'*65}")
    print(f"  Top 16 Teams by Gold probability  ({glabel}'s)")
    print(f"{'─'*65}")
    team_gold = sorted(
        [(t, probs.get(t, {}).get("Gold", 0)) for t in all_countries if t in probs],
        key=lambda x: -x[1]
    )[:16]
    for rank, (team, p_gold) in enumerate(team_gold, 1):
        p_medal = sum(probs.get(team, {}).get(r, 0)
                      for r in ["Gold", "Silver", "Bronze"])
        p_sf    = sum(probs.get(team, {}).get(r, 0)
                      for r in ["Gold", "Silver", "Bronze", "SF"])
        ids = rosters.get(team, [])
        top_name = pmap.get(ids[0], {}).get("player_name", team) if ids else team
        print(f"  {rank:>2}. {team:<6} {top_name:<26}  "
              f"Gold: {p_gold*100:>5.2f}%  Medal: {p_medal*100:>5.1f}%  "
              f"Semis: {p_sf*100:>5.1f}%")

    # ── Push to Supabase ──────────────────────────────────────────────────
    if args.push:
        print(f"\nPushing results to Supabase…")
        push_results(supabase, gender, probs, args.runs)
        print("Done.")

    print(f"\n  Tip: re-run with --push to save to DB for the dashboard.")
    print(f"  Matchup: python scripts/wttc_simulate.py --gender {gender} "
          f"--matchup IND CHN\n")


if __name__ == "__main__":
    main()
