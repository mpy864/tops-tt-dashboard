"""
compute_player_benchmarks.py

Identifies SF+ players in major events, computes fundamental statistics over
6, 12, and 18-month windows, and pushes results to Supabase:
  - player_benchmark_stats  : per-player × window stats
  - elite_benchmark_profile : P25/P50/P75 aggregates across the elite set

Usage:
  set -a && source .env && set +a
  python scripts/compute_player_benchmarks.py --gender M
  python scripts/compute_player_benchmarks.py --gender W
"""

import os
import sys
import argparse
import statistics
from datetime import date, timedelta
from collections import defaultdict
from supabase import create_client, Client


# ─── Constants ───────────────────────────────────────────────────────────────

# event_type values that count as "major" for elite identification
MAJOR_EVENT_TYPES = {
    'Olympic Games',
    'Singles World Cup',
    'WTT Grand Smash',
    'WTT Champions',
    'WTT Finals',
}

# wtt_events names containing these substrings also count (case-insensitive)
MAJOR_NAME_FRAGMENTS = ['asian championship', 'asian cup']

# Rounds that qualify as SF or beyond
ELITE_ROUNDS = ['semifinal', 'semi-final', 'semi final', 'final']

# Tiers 1–5 count as "elite events" (Grand Smash/WTTC/Olympics + World Cup/Finals + Champions + Continental)
ELITE_TIERS = {'1', '2', '3', '5'}

# Tier 4 = WTT Star Contender
STAR_CONTENDER_TIERS = {'4'}

# Tier 6 = WTT Contender
CONTENDER_TIERS = {'6'}

# Windows in months → days
WINDOWS = {6: 180, 12: 365, 18: 548}

TODAY = date.today()


# ─── Data loading ─────────────────────────────────────────────────────────────

def identify_elite_players(supabase: Client, gender: str) -> set[int]:
    """
    Find all player IDs who reached SF or better in a major event.
    Uses round_phase string encoding (e.g. "Men's Singles - Semifinal - Match 1").
    """
    # Fetch all major event IDs
    ev_resp = supabase.table('wtt_events') \
        .select('event_id,event_name,event_type') \
        .execute()
    major_ids = set()
    for e in (ev_resp.data or []):
        etype = e.get('event_type') or ''
        ename = (e.get('event_name') or '').lower()
        if etype in MAJOR_EVENT_TYPES:
            major_ids.add(e['event_id'])
        elif any(f in ename for f in MAJOR_NAME_FRAGMENTS):
            major_ids.add(e['event_id'])

    if not major_ids:
        return set()

    # Gender string in round_phase: "Men's Singles ..." or "Women's Singles ..."
    gender_prefix = "men" if gender == 'M' else "women"

    elite_ids: set[int] = set()
    major_id_list = list(major_ids)

    # Fetch in chunks of 200 event IDs (PostgREST .in_ limit)
    chunk_size = 200
    for start in range(0, len(major_id_list), chunk_size):
        chunk = major_id_list[start:start + chunk_size]
        page, size = 0, 1000
        while True:
            q = supabase.table('wtt_matches_singles') \
                .select('comp1_id,comp2_id,round_phase') \
                .in_('event_id', chunk) \
                .not_.is_('result', 'null') \
                .range(page * size, page * size + size - 1) \
                .execute()
            rows = q.data or []
            for r in rows:
                rp = (r.get('round_phase') or '').lower()
                if not rp.startswith(gender_prefix):
                    continue
                if not any(er in rp for er in ELITE_ROUNDS):
                    continue
                elite_ids.add(r['comp1_id'])
                elite_ids.add(r['comp2_id'])
            if len(rows) < size:
                break
            page += 1

    # Remove obvious non-player IDs (team registrations ≥ 1_000_000)
    return {pid for pid in elite_ids if pid and pid < 1_000_000}


def load_players(supabase: Client, gender: str) -> list[dict]:
    """Load players ranked ≤ 200 + all Indian players, with current rank."""
    # Latest ranking date
    rd = supabase.table('rankings_singles_normalized') \
        .select('ranking_date') \
        .order('ranking_date', desc=True) \
        .limit(1).execute()
    latest_date = rd.data[0]['ranking_date'] if rd.data else None
    if not latest_date:
        raise RuntimeError('No ranking data found')

    # Top 200 by rank
    rank_resp = supabase.table('rankings_singles_normalized') \
        .select('player_id,rank') \
        .eq('ranking_date', latest_date) \
        .lte('rank', 200) \
        .order('rank') \
        .limit(250).execute()
    rank_map = {r['player_id']: r['rank'] for r in (rank_resp.data or [])}

    # Indian players (ranked or not)
    ind_resp = supabase.table('wtt_players') \
        .select('ittf_id') \
        .eq('country_code', 'IND') \
        .eq('gender', gender) \
        .execute()
    ind_ids = {p['ittf_id'] for p in (ind_resp.data or [])}

    # Rankings for Indian players not yet in top-200 map
    extra_ids = [pid for pid in ind_ids if pid not in rank_map]
    if extra_ids:
        er = supabase.table('rankings_singles_normalized') \
            .select('player_id,rank') \
            .eq('ranking_date', latest_date) \
            .in_('player_id', extra_ids) \
            .execute()
        for r in (er.data or []):
            rank_map[r['player_id']] = r['rank']

    all_ids = set(rank_map.keys()) | ind_ids

    # Player profiles
    profiles = {}
    id_list = list(all_ids)
    for i in range(0, len(id_list), 500):
        batch = id_list[i:i + 500]
        pr = supabase.table('wtt_players') \
            .select('ittf_id,player_name,country_code,gender') \
            .in_('ittf_id', batch) \
            .eq('gender', gender) \
            .execute()
        for p in (pr.data or []):
            profiles[p['ittf_id']] = p

    players = []
    for pid, profile in profiles.items():
        players.append({
            'player_id':    pid,
            'player_name':  profile['player_name'],
            'country_code': profile['country_code'],
            'current_rank': rank_map.get(pid),
        })
    return players


def load_matches_for_players(supabase: Client, player_ids: list[int],
                              cutoff_date: str) -> dict[int, list[dict]]:
    """
    Load all matches since cutoff_date for given players.
    Returns dict: player_id → list of match dicts.
    """
    by_player: dict[int, list[dict]] = defaultdict(list)

    def fetch_side(id_field: str):
        for i in range(0, len(player_ids), 200):
            chunk = player_ids[i:i + 200]
            page, size = 0, 1000
            while True:
                q = supabase.table('wtt_matches_singles') \
                    .select('comp1_id,comp2_id,result,event_id,event_date') \
                    .in_(id_field, chunk) \
                    .not_.is_('result', 'null') \
                    .gte('event_date', cutoff_date) \
                    .range(page * size, page * size + size - 1) \
                    .execute()
                rows = q.data or []
                for r in rows:
                    # Normalise so "pid" is always the focal player
                    if id_field == 'comp1_id':
                        pid = r['comp1_id']
                        opp = r['comp2_id']
                        won = r['result'] == 'W'
                    else:
                        pid = r['comp2_id']
                        opp = r['comp1_id']
                        won = r['result'] == 'L'
                    by_player[pid].append({
                        'opp_id':     opp,
                        'won':        won,
                        'event_id':   r['event_id'],
                        'event_date': r['event_date'],
                    })
                if len(rows) < size:
                    break
                page += 1

    fetch_side('comp1_id')
    fetch_side('comp2_id')
    return by_player


def load_opp_rank_map(supabase: Client, opp_ids: list[int],
                      cutoff_date: str) -> dict[int, list[tuple]]:
    """
    Returns dict: opp_id → sorted list of (ranking_date_str, rank) tuples.
    Used to binary-search the closest ranking before a match date.
    """
    opp_rank: dict[int, list[tuple]] = defaultdict(list)
    for i in range(0, len(opp_ids), 200):
        chunk = opp_ids[i:i + 200]
        page, size = 0, 5000
        while True:
            q = supabase.table('rankings_singles_normalized') \
                .select('player_id,ranking_date,rank') \
                .in_('player_id', chunk) \
                .gte('ranking_date', cutoff_date) \
                .order('ranking_date') \
                .range(page * size, page * size + size - 1) \
                .execute()
            rows = q.data or []
            for r in rows:
                opp_rank[r['player_id']].append((r['ranking_date'], r['rank']))
            if len(rows) < size:
                break
            page += 1
    return opp_rank


def get_rank_at_date(rank_history: list[tuple], match_date: str) -> int | None:
    """Binary search for closest rank on or before match_date."""
    if not rank_history:
        return None
    lo, hi = 0, len(rank_history) - 1
    result = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if rank_history[mid][0] <= match_date:
            result = rank_history[mid][1]
            lo = mid + 1
        else:
            hi = mid - 1
    return result


def load_event_tier_map(supabase: Client) -> dict[int, str]:
    """Returns {event_id: event_tier} from wtt_events_graded."""
    resp = supabase.table('wtt_events_graded') \
        .select('event_id,event_tier') \
        .execute()
    return {r['event_id']: r['event_tier'] for r in (resp.data or []) if r['event_tier']}


# ─── Stats computation ────────────────────────────────────────────────────────

def compute_stats(matches: list[dict], opp_rank_map: dict,
                  tier_map: dict, window_days: int) -> dict:
    """Compute fundamental stats for matches within the given window."""
    cutoff = TODAY - timedelta(days=window_days)

    played = 0
    wins = 0
    top50_played = top50_wins = 0
    top100_played = top100_wins = 0
    opp_ranks = []
    opp_ranks_beaten = []
    elite_count = 0
    star_contender_count = 0
    contender_count = 0

    for m in matches:
        mdate = m['event_date']
        if not mdate:
            continue
        match_day = date.fromisoformat(mdate[:10])
        if match_day < cutoff:
            continue

        played += 1
        won = m['won']
        if won:
            wins += 1

        opp_id = m['opp_id']
        opp_hist = opp_rank_map.get(opp_id, [])
        opp_rank = get_rank_at_date(opp_hist, mdate[:10])

        if opp_rank is not None:
            opp_ranks.append(opp_rank)
            if won:
                opp_ranks_beaten.append(opp_rank)
            if opp_rank <= 50:
                top50_played += 1
                if won:
                    top50_wins += 1
            if opp_rank <= 100:
                top100_played += 1
                if won:
                    top100_wins += 1

        tier = tier_map.get(m['event_id'], '')
        if tier in ELITE_TIERS:
            elite_count += 1
        elif tier in STAR_CONTENDER_TIERS:
            star_contender_count += 1
        elif tier in CONTENDER_TIERS:
            contender_count += 1

    return {
        'matches_played':      played,
        'win_rate':            round(wins / played, 4) if played else None,
        'win_rate_top50':      round(top50_wins / top50_played, 4) if top50_played else None,
        'win_rate_top100':     round(top100_wins / top100_played, 4) if top100_played else None,
        'matches_top50':       top50_played,
        'matches_top100':      top100_played,
        'avg_opp_rank':        round(statistics.mean(opp_ranks), 1) if opp_ranks else None,
        'avg_opp_rank_beaten': round(statistics.mean(opp_ranks_beaten), 1) if opp_ranks_beaten else None,
        'elite_event_pct':     round(elite_count / played, 4) if played else None,
        'star_contender_pct':  round(star_contender_count / played, 4) if played else None,
        'contender_pct':       round(contender_count / played, 4) if played else None,
    }


def compute_percentiles(values: list[float]) -> tuple[float, float, float, float]:
    """Return (p25, p50, p75, mean). Values must be non-empty."""
    sv = sorted(values)
    n = len(sv)

    def pct(p):
        idx = p / 100 * (n - 1)
        lo, hi = int(idx), min(int(idx) + 1, n - 1)
        frac = idx - lo
        return round(sv[lo] * (1 - frac) + sv[hi] * frac, 4)

    return pct(25), pct(50), pct(75), round(statistics.mean(sv), 4)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gender', choices=['M', 'W'], required=True)
    args = parser.parse_args()
    gender = args.gender

    supabase = create_client(
        os.environ['SUPABASE_URL'],
        os.environ['SUPABASE_SERVICE_KEY'],
    )

    print(f"\n{'='*60}")
    print(f" Elite Benchmark Computation — {'Men' if gender=='M' else 'Women'}")
    print(f"{'='*60}")

    print('\n[1/6] Identifying elite players (SF+ at major events)…')
    elite_ids = identify_elite_players(supabase, gender)
    print(f'  → {len(elite_ids)} elite players identified')

    print('[2/6] Loading players (top 200 ranked + all Indian)…')
    players = load_players(supabase, gender)
    # Ensure all elite players are included even if outside top 200
    player_ids_set = {p['player_id'] for p in players}
    missing_elite = elite_ids - player_ids_set
    if missing_elite:
        mel = list(missing_elite)
        for i in range(0, len(mel), 500):
            pr = supabase.table('wtt_players') \
                .select('ittf_id,player_name,country_code,gender') \
                .in_('ittf_id', mel[i:i+500]) \
                .eq('gender', gender) \
                .execute()
            for p in (pr.data or []):
                players.append({
                    'player_id':    p['ittf_id'],
                    'player_name':  p['player_name'],
                    'country_code': p['country_code'],
                    'current_rank': None,
                })
    print(f'  → {len(players)} total players to analyse')

    # Oldest cutoff = 18 months back
    cutoff_18m = (TODAY - timedelta(days=548)).isoformat()
    player_ids = [p['player_id'] for p in players]

    print('[3/6] Loading match history (18 months)…')
    by_player = load_matches_for_players(supabase, player_ids, cutoff_18m)
    total_matches = sum(len(v) for v in by_player.values())
    print(f'  → {total_matches} match records loaded')

    print('[4/6] Loading opponent ranking history…')
    all_opp_ids = list({
        m['opp_id']
        for matches in by_player.values()
        for m in matches
        if m['opp_id'] < 1_000_000
    })
    opp_rank_map = load_opp_rank_map(supabase, all_opp_ids, cutoff_18m)
    print(f'  → Ranking history loaded for {len(opp_rank_map)} opponents')

    print('[5/6] Loading event tier map…')
    tier_map = load_event_tier_map(supabase)
    print(f'  → {len(tier_map)} events with tier data')

    print('[6/6] Computing stats and upserting…')
    stat_rows = []
    for player in players:
        pid = player['player_id']
        matches = by_player.get(pid, [])
        is_elite = pid in elite_ids

        for months, days in WINDOWS.items():
            stats = compute_stats(matches, opp_rank_map, tier_map, days)
            row = {
                'player_id':     pid,
                'player_name':   player['player_name'],
                'country_code':  player['country_code'],
                'gender':        gender,
                'window_months': months,
                'current_rank':  player['current_rank'],
                'is_elite':      is_elite,
                **stats,
            }
            stat_rows.append(row)

    # Upsert in batches of 500
    for i in range(0, len(stat_rows), 500):
        supabase.table('player_benchmark_stats') \
            .upsert(stat_rows[i:i+500], on_conflict='player_id,window_months') \
            .execute()

    print(f'  → {len(stat_rows)} rows upserted to player_benchmark_stats')

    # Build elite_benchmark_profile
    METRICS = [
        'matches_played', 'win_rate', 'win_rate_top50', 'win_rate_top100',
        'avg_opp_rank', 'avg_opp_rank_beaten',
        'elite_event_pct', 'star_contender_pct', 'contender_pct',
    ]
    profile_rows = []
    for months in WINDOWS:
        elite_rows = [
            r for r in stat_rows
            if r['is_elite'] and r['window_months'] == months
            and r['matches_played'] >= 5  # exclude inactive players
        ]
        for metric in METRICS:
            vals = [r[metric] for r in elite_rows if r[metric] is not None]
            if not vals:
                continue
            p25, p50, p75, mean = compute_percentiles(vals)
            profile_rows.append({
                'gender':        gender,
                'window_months': months,
                'metric':        metric,
                'p25':           p25,
                'p50':           p50,
                'p75':           p75,
                'mean':          mean,
                'player_count':  len(vals),
            })

    supabase.table('elite_benchmark_profile') \
        .upsert(profile_rows, on_conflict='gender,window_months,metric') \
        .execute()
    print(f'  → {len(profile_rows)} profile rows upserted to elite_benchmark_profile')

    # Summary printout
    print(f"\n{'─'*60}")
    print(f" Benchmark profile — {'Men' if gender=='M' else 'Women'}")
    print(f" {'Metric':<22} {'Window':>6}  {'P25':>6}  {'P50':>6}  {'P75':>6}  N")
    print(f"{'─'*60}")
    for r in sorted(profile_rows, key=lambda x: (x['window_months'], x['metric'])):
        def fmt(v):
            if v is None:
                return '  —   '
            if r['metric'] in ('win_rate', 'win_rate_top50', 'win_rate_top100',
                               'elite_event_pct', 'star_contender_pct', 'contender_pct'):
                return f'{v*100:5.1f}%'
            return f'{v:6.1f}'
        print(f"  {r['metric']:<22} {r['window_months']:>5}M  "
              f"{fmt(r['p25'])}  {fmt(r['p50'])}  {fmt(r['p75'])}  "
              f"n={r['player_count']}")

    print(f"\nDone.\n")


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(__file__))
    main()
