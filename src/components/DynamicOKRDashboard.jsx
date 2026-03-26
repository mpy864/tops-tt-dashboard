import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Info, Zap, Trophy, Clock,
  BarChart2, Shield, FileText, Star, AlertTriangle,
  ArrowUpRight, Activity, Search, Target, Users, Layers
} from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Score Parsing ─────────────────────────────────────────────────────────────
function parseScoresForPlayer(gameScoresStr, isComp1) {
  if (!gameScoresStr || gameScoresStr === 'N/A')
    return { gamesWon: 0, gamesLost: 0, pointsWon: 0, pointsLost: 0, totalGames: 0 };
  const games = gameScoresStr.split(',').map(s => s.trim());
  let gamesWon = 0, gamesLost = 0, pointsWon = 0, pointsLost = 0;
  for (const game of games) {
    const parts = game.split('-');
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10);
    if (isNaN(a) || isNaN(b)) continue;
    const p = isComp1 ? a : b, o = isComp1 ? b : a;
    pointsWon += p; pointsLost += o;
    if (p > o) gamesWon++; else gamesLost++;
  }
  return { gamesWon, gamesLost, pointsWon, pointsLost, totalGames: gamesWon + gamesLost };
}

function isClutchWin(gameScoresStr, isComp1, playerWon) {
  if (!playerWon) return false;
  const { totalGames } = parseScoresForPlayer(gameScoresStr, isComp1);
  return totalGames >= 4;
}

// ─── Per-window Computation (DRY) ─────────────────────────────────────────────
function computeWindowData(matchLedger, rankingHistory, windowMonths, playerCurrentRank) {
  const now = new Date();
  const cutoff = new Date(now - windowMonths * 30 * 24 * 60 * 60 * 1000);
  const filtered = matchLedger.filter(m => m.rawDate >= cutoff);
  const wins = filtered.filter(m => m.result === 'W');
  const total = filtered.length;

  const winRate = total > 0 ? (wins.length / total) * 100 : 0;
  const upsets = wins.filter(m => m.isUpset);
  const upsetYield = wins.length > 0 ? (upsets.length / wins.length) * 100 : 0;
  const clutchWins = wins.filter(m => m.isClutch);
  const clutchIndex = wins.length > 0 ? (clutchWins.length / wins.length) * 100 : 0;

  let totalDiff = 0, diffCount = 0;
  for (const m of filtered) {
    if (m.pointDiff !== null && !isNaN(m.pointDiff)) { totalDiff += m.pointDiff; diffCount++; }
  }
  const avgPtDiff = diffCount > 0 ? totalDiff / diffCount : 0;

  const rankAtStart = rankingHistory.find(r => new Date(r.ranking_date) <= cutoff)?.rank;
  const rankChange = rankAtStart ? rankAtStart - playerCurrentRank : 0;

  const bestWin = wins
    .filter(m => m.opponentRank < 999)
    .sort((a, b) => a.opponentRank - b.opponentRank)[0] || null;

  const recentForm = filtered.slice(0, 10);

  const h2hBuckets = [
    { label: 'Top 10',  min: 1,  max: 10   },
    { label: '11–25',   min: 11, max: 25   },
    { label: '26–50',   min: 26, max: 50   },
    { label: '51+',     min: 51, max: 9999 },
  ].map(b => {
    const bm = filtered.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.result === 'W').length;
    const bl = bm.filter(m => m.result === 'L').length;
    const bt = bw + bl;
    return { label: b.label, wins: bw, losses: bl, total: bt,
      winRate: bt > 0 ? parseFloat(((bw / bt) * 100).toFixed(1)) : 0 };
  });

  const tierMap = {};
  for (const m of filtered) {
    const tier = m.eventTier || 'Unknown';
    if (!tierMap[tier]) tierMap[tier] = { wins: 0, losses: 0 };
    if (m.result === 'W') tierMap[tier].wins++; else tierMap[tier].losses++;
  }
  const tierPerfArr = Object.entries(tierMap).map(([tier, t]) => ({
    tier, wins: t.wins, losses: t.losses,
    total: t.wins + t.losses,
    winRate: (t.wins + t.losses) > 0 ? ((t.wins / (t.wins + t.losses)) * 100).toFixed(1) : '0.0',
  })).sort((a, b) => {
    if (a.tier === 'Unknown') return 1;
    if (b.tier === 'Unknown') return -1;
    return parseInt(a.tier) - parseInt(b.tier);
  });

  const rankingChartData = rankingHistory
    .filter(r => new Date(r.ranking_date) >= cutoff)
    .map(r => ({
      date: new Date(r.ranking_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      rank: r.rank, points: r.points,
    }))
    .reverse();

  const chartRanks = rankingChartData.map(d => d.rank).filter(Boolean);
  const bestRank  = chartRanks.length > 0 ? Math.min(...chartRanks) : null;
  const worstRank = chartRanks.length > 0 ? Math.max(...chartRanks) : null;

  return {
    winRate, upsetYield, clutchIndex, avgPtDiff, rankChange,
    matchCount: total, wins: wins.length, losses: total - wins.length,
    recentForm, bestWin, h2hBuckets, tierPerfArr,
    rankingChartData, bestRank, worstRank,
  };
}

// ─── Verdict Engine (Pyramid Apex) ────────────────────────────────────────────
function computeVerdict(w) {
  const { rankChange, winRate, upsetYield, matchCount, wins, losses } = w;

  if (matchCount < 5) return {
    verdict: 'Insufficient Data', grade: 'gray', Icon: AlertTriangle,
    analystSignal: `Only ${matchCount} matches in window.`,
    bossNarrative: 'Too few matches for a reliable directional assessment.',
    coachAction: 'Prioritise tournament entries to build statistical signal.',
  };

  const rankImproved   = rankChange > 0;
  const winRateStrong  = winRate >= 50;

  if (rankImproved && winRateStrong) return {
    verdict: 'Ascending', grade: 'green', Icon: TrendingUp,
    analystSignal: `Rank +${rankChange} · WR ${winRate.toFixed(1)}% · Upset ${upsetYield.toFixed(1)}%`,
    bossNarrative: `Positive trajectory on both rank and results. ${wins}W–${losses}L in window.`,
    coachAction: 'Push toward higher-tier events. Current form warrants elevated competition.',
  };

  if (!rankImproved && !winRateStrong) return {
    verdict: 'Declining', grade: 'red', Icon: TrendingDown,
    analystSignal: `Rank ${rankChange} · WR ${winRate.toFixed(1)}% · ${wins}W–${losses}L`,
    bossNarrative: 'Negative trajectory on rank and win rate. Requires intervention.',
    coachAction: 'Review match selection and physical load. Tactical or fitness gap likely.',
  };

  if (rankImproved && !winRateStrong) return {
    verdict: 'Quietly Rising', grade: 'blue', Icon: ArrowUpRight,
    analystSignal: `Rank +${rankChange} despite ${winRate.toFixed(1)}% WR — quality wins.`,
    bossNarrative: 'Rank improving despite sub-50% win rate. Athlete targeting the right matches.',
    coachAction: 'Maintain selective match targeting. Quality over quantity is working.',
  };

  return {
    verdict: 'Plateau', grade: 'amber', Icon: Minus,
    analystSignal: `WR ${winRate.toFixed(1)}% but rank ${rankChange >= 0 ? 'unchanged' : `−${Math.abs(rankChange)}`}.`,
    bossNarrative: 'Performance stable but not converting to ranking movement. Ceiling hit.',
    coachAction: 'Wins are against lower-ranked opponents. Needs upset wins to break through.',
  };
}

const VS = {
  green: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', badge: 'bg-emerald-600 text-white' },
  red:   { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-800',     badge: 'bg-red-600 text-white'     },
  blue:  { bg: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-800',     badge: 'bg-sky-600 text-white'     },
  amber: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   badge: 'bg-amber-500 text-white'   },
  gray:  { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-700',   badge: 'bg-slate-500 text-white'   },
};

const KPI_DEFS = [
  { key: 'winRate',    label: 'Win Rate',        Icon: Target,   fmt: v => `${v.toFixed(1)}%`,                        tip: 'Wins ÷ total matches in the selected window.',                         good: v => v >= 50 },
  { key: 'upsetYield', label: 'Upset Yield',     Icon: Trophy,   fmt: v => `${v.toFixed(1)}%`,                        tip: '% of wins against higher-ranked opponents. Measures ambition quality.', good: v => v >= 25 },
  { key: 'clutchIndex',label: 'Clutch Index',    Icon: Zap,      fmt: v => `${v.toFixed(1)}%`,                        tip: '% of wins that required 4 or 5 games. Higher = resilient under pressure.', good: v => v >= 50 },
  { key: 'avgPtDiff',  label: 'Pt Diff / Game',  Icon: BarChart2, fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,   tip: 'Avg point margin per game across all matches. Positive = dominant.',    good: v => v > 0  },
];

// ─── Main Component ────────────────────────────────────────────────────────────
export default function DynamicOKRDashboard() {
  const [players, setPlayers]                   = useState([]);
  const [selectedPlayer, setSelectedPlayer]     = useState(null);
  const [playerMetrics, setPlayerMetrics]       = useState(null);
  const [loading, setLoading]                   = useState(true);
  const [fetching, setFetching]                 = useState(false);
  const [error, setError]                       = useState(null);
  const [searchTerm, setSearchTerm]             = useState('');
  const [filteredPlayers, setFilteredPlayers]   = useState([]);
  const [activeTab, setActiveTab]               = useState('overview');
  const [timeWindow, setTimeWindow]             = useState('6M');
  const [expandedTournament, setExpandedTournament] = useState(null);
  const [activeTooltip, setActiveTooltip]       = useState(null);

  // Load players
  useEffect(() => {
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('mv_player_selector_singles')
          .select('player_id,player_name,gender,rank,gender_label')
          .order('rank', { ascending: true });
        if (err) throw err;
        setPlayers(data || []);
        setFilteredPlayers(data || []);
        if (data?.length > 0) setSelectedPlayer(data[0].player_id);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Fetch & compute on player change
  useEffect(() => {
    if (!selectedPlayer) return;
    (async () => {
      setFetching(true); setError(null);
      try {
        const [
          { data: matches,    error: e1 },
          { data: rankings,   error: e2 },
          { data: events,     error: e3 },
          { data: allPlayers, error: e4 },
        ] = await Promise.all([
          supabase.from('wtt_matches_singles')
            .select('match_id,comp1_id,comp2_id,result,event_date,event_id,round_phase,game_scores')
            .or(`comp1_id.eq.${selectedPlayer},comp2_id.eq.${selectedPlayer}`)
            .order('event_date', { ascending: false }).limit(500),
          supabase.from('rankings_singles_normalized')
            .select('rank,ranking_date,points').eq('player_id', selectedPlayer)
            .order('ranking_date', { ascending: false }).limit(200),
          supabase.from('wtt_events').select('event_id,event_name,event_tier'),
          supabase.from('wtt_players').select('ittf_id,player_name'),
        ]);
        if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4;

        const opponentIds = [...new Set(
          (matches || []).map(m => m.comp1_id === selectedPlayer ? m.comp2_id : m.comp1_id)
        )];
        const { data: oppRankings, error: e5 } = await supabase
          .from('rankings_singles_normalized')
          .select('player_id,rank,ranking_date')
          .in('player_id', opponentIds)
          .order('ranking_date', { ascending: false });
        if (e5) throw e5;

        const oppRankMap = {};
        for (const r of (oppRankings || [])) {
          if (!oppRankMap[r.player_id]) oppRankMap[r.player_id] = [];
          oppRankMap[r.player_id].push(r);
        }

        setPlayerMetrics(buildMetrics(matches, rankings, events, allPlayers, oppRankMap, selectedPlayer));
      } catch (err) { setError(err.message); }
      finally { setFetching(false); }
    })();
  }, [selectedPlayer]);

  function buildMetrics(matches, rankings, events, allPlayers, oppRankMap, playerId) {
    const playerCurrentRank = rankings?.[0]?.rank || 999;

    const getOpponentRankAtDate = (match) => {
      const oppId = match.comp1_id === playerId ? match.comp2_id : match.comp1_id;
      const history = oppRankMap[oppId] || [];
      const matchDate = new Date(match.event_date);
      return history.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
    };

    const matchLedger = (matches || []).map(m => {
      const isComp1 = m.comp1_id === playerId;
      const won = isComp1 ? m.result === 'W' : m.result === 'L';
      const oppId = isComp1 ? m.comp2_id : m.comp1_id;
      const opponentRank = getOpponentRankAtDate(m);
      const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } = parseScoresForPlayer(m.game_scores, isComp1);
      const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
      return {
        rawDate:      new Date(m.event_date),
        date:         new Date(m.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
        opponent:     allPlayers?.find(p => p.ittf_id === oppId)?.player_name || 'Unknown',
        opponentRank,
        tournament:   events?.find(e => e.event_id === m.event_id)?.event_name || 'Unknown',
        eventTier:    events?.find(e => e.event_id === m.event_id)?.event_tier || null,
        round:        m.round_phase || 'N/A',
        score:        m.game_scores || 'N/A',
        result:       won ? 'W' : 'L',
        isUpset:      won && opponentRank < playerCurrentRank,
        isClutch:     isClutchWin(m.game_scores, isComp1, won),
        gamesWon, gamesLost, pointDiff,
      };
    });

    return {
      ranking: playerCurrentRank,
      matchLedger,
      rankingHistory: rankings || [],
      windows: {
        '6M':  computeWindowData(matchLedger, rankings || [], 6,  playerCurrentRank),
        '12M': computeWindowData(matchLedger, rankings || [], 12, playerCurrentRank),
        '18M': computeWindowData(matchLedger, rankings || [], 18, playerCurrentRank),
      },
    };
  }

  const activeWindow = useMemo(() =>
    playerMetrics?.windows[timeWindow] || null, [playerMetrics, timeWindow]);

  const verdict = useMemo(() =>
    activeWindow ? computeVerdict(activeWindow) : null, [activeWindow]);

  const handleSearch = v => {
    setSearchTerm(v);
    setFilteredPlayers(!v.trim() ? players
      : players.filter(p => p.player_name.toLowerCase().includes(v.toLowerCase())));
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-500">
        <Activity size={18} className="animate-pulse" />
        <span className="text-sm">Loading players…</span>
      </div>
    </div>
  );

  const TABS = [
    { id: 'overview',   label: 'Overview',   Icon: Activity   },
    { id: 'trajectory', label: 'Trajectory', Icon: TrendingUp },
    { id: 'matchplay',  label: 'Matchplay',  Icon: Shield     },
    { id: 'ledger',     label: 'Ledger',     Icon: FileText   },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        .okr-dash * { font-family: 'Sora', sans-serif; }
      `}</style>

      <div className="okr-dash min-h-screen bg-slate-50 p-6">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Header */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Player Intelligence</h1>
              <p className="text-xs text-slate-400 mt-0.5">TOPS Analytics · WTT Singles</p>
            </div>
            {/* Global time window — controls EVERYTHING */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
              <Clock size={13} className="text-slate-400 ml-2 mr-1" />
              {['6M', '12M', '18M'].map(w => (
                <button key={w} onClick={() => setTimeWindow(w)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-bold tracking-wide transition-all ${
                    timeWindow === w ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-400 hover:text-slate-700'
                  }`}>
                  {w}
                </button>
              ))}
            </div>
          </div>

          {/* Player selector */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" placeholder="Search player…" value={searchTerm}
                onChange={e => handleSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <select value={selectedPlayer || ''}
              onChange={e => { setSelectedPlayer(parseInt(e.target.value)); setActiveTab('overview'); }}
              className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
              <option value="">Select player…</option>
              {filteredPlayers.map(p => (
                <option key={p.player_id} value={p.player_id}>
                  {p.player_name} ({p.gender_label}) — #{p.rank}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          {fetching && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-600 text-sm flex items-center gap-2">
              <Activity size={14} className="animate-pulse" /> Computing {timeWindow} window metrics…
            </div>
          )}

          {selectedPlayer && activeWindow && verdict && (() => {
            const vs = VS[verdict.grade];
            const { Icon } = verdict;
            return (
              <>
                {/* ═══ PYRAMID APEX: Verdict Card ═══ */}
                <div className={`rounded-xl border-2 ${vs.bg} ${vs.border} p-5`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${vs.badge} shadow-sm`}>
                        <Icon size={22} />
                      </div>
                      <div>
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${vs.text} opacity-50`}>
                          Trajectory Verdict · {timeWindow}
                        </p>
                        <p className={`text-2xl font-bold ${vs.text} leading-tight`}>{verdict.verdict}</p>
                      </div>
                    </div>
                    <code className={`text-xs ${vs.text} opacity-60 font-mono hidden sm:block`}>{verdict.analystSignal}</code>
                  </div>
                  <div className={`mt-4 pt-4 border-t ${vs.border} grid grid-cols-2 gap-4`}>
                    <div>
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${vs.text} opacity-40 mb-1`}>Assessment</p>
                      <p className={`text-sm ${vs.text} leading-relaxed`}>{verdict.bossNarrative}</p>
                    </div>
                    <div>
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${vs.text} opacity-40 mb-1`}>Coaching Implication</p>
                      <p className={`text-sm ${vs.text} leading-relaxed`}>{verdict.coachAction}</p>
                    </div>
                  </div>
                </div>

                {/* ═══ KPI Strip — all driven by timeWindow ═══ */}
                <div className="grid grid-cols-4 gap-3">
                  {KPI_DEFS.map(({ key, label, Icon: KIcon, fmt, tip, good }) => {
                    const val = activeWindow[key];
                    return (
                      <div key={key} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm relative">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <KIcon size={12} className="text-slate-400" />
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest">{label}</span>
                          </div>
                          <div className="relative"
                            onMouseEnter={() => setActiveTooltip(key)}
                            onMouseLeave={() => setActiveTooltip(null)}>
                            <Info size={12} className="text-slate-300 hover:text-slate-500 cursor-help transition-colors" />
                            {activeTooltip === key && (
                              <div className="absolute right-0 bottom-6 w-52 bg-slate-900 text-white text-xs rounded-lg p-2.5 z-30 shadow-2xl leading-relaxed">
                                {tip}
                              </div>
                            )}
                          </div>
                        </div>
                        <p className={`text-2xl font-bold ${good(val) ? 'text-slate-900' : 'text-slate-400'}`}>{fmt(val)}</p>
                        <p className="text-[10px] text-slate-400 mt-1">{activeWindow.matchCount} matches · {timeWindow}</p>
                      </div>
                    );
                  })}
                </div>

                {/* ═══ Tabs ═══ */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="flex border-b border-slate-100">
                    {TABS.map(({ id, label, Icon: TIcon }) => (
                      <button key={id} onClick={() => setActiveTab(id)}
                        className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all ${
                          activeTab === id
                            ? 'border-slate-900 text-slate-900 bg-slate-50'
                            : 'border-transparent text-slate-400 hover:text-slate-700'
                        }`}>
                        <TIcon size={13} />
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="p-6">

                    {/* ══ OVERVIEW — Where does this player stand right now? ══ */}
                    {activeTab === 'overview' && (
                      <div className="space-y-7">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-slate-50 rounded-xl p-4">
                            <p className="text-xs text-slate-400 mb-1">World Rank</p>
                            <p className="text-3xl font-bold text-slate-900">#{playerMetrics.ranking}</p>
                            <p className={`text-xs mt-1.5 font-semibold ${
                              activeWindow.rankChange > 0 ? 'text-emerald-600'
                              : activeWindow.rankChange < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                              {activeWindow.rankChange > 0 ? `↑ +${activeWindow.rankChange} places`
                               : activeWindow.rankChange < 0 ? `↓ ${activeWindow.rankChange} places`
                               : '— No change'}
                              <span className="text-slate-400 font-normal"> vs {timeWindow} ago</span>
                            </p>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-4">
                            <p className="text-xs text-slate-400 mb-1">Record ({timeWindow})</p>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-2xl font-bold text-emerald-600">{activeWindow.wins}W</span>
                              <span className="text-slate-300 text-xl">–</span>
                              <span className="text-2xl font-bold text-red-500">{activeWindow.losses}L</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">{activeWindow.matchCount} total matches</p>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-4">
                            <p className="text-xs text-slate-400 mb-1">Best Win ({timeWindow})</p>
                            {activeWindow.bestWin ? (
                              <>
                                <p className="text-xl font-bold text-slate-900">Rank #{activeWindow.bestWin.opponentRank}</p>
                                <p className="text-xs text-slate-700 truncate mt-0.5">{activeWindow.bestWin.opponent}</p>
                                <p className="text-xs text-slate-400">{activeWindow.bestWin.date}</p>
                              </>
                            ) : <p className="text-sm text-slate-400 mt-2">No wins in window</p>}
                          </div>
                        </div>

                        {/* Recent form strip */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Recent Form</h3>
                            <span className="text-xs text-slate-400">Last {activeWindow.recentForm.length} matches · {timeWindow}</span>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {activeWindow.recentForm.map((m, i) => (
                              <div key={i} className="relative group">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center cursor-default
                                  transition-transform hover:scale-110 ${
                                  m.result === 'W'
                                    ? m.isUpset ? 'bg-emerald-500 text-white shadow-md'
                                               : 'bg-emerald-100 text-emerald-600'
                                    : 'bg-red-100 text-red-500'
                                  }`}>
                                  {m.result === 'W' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                                </div>
                                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-56 bg-slate-900 text-white
                                  text-xs rounded-xl p-3 hidden group-hover:block z-20 shadow-2xl pointer-events-none">
                                  <p className="font-semibold">{m.result === 'W' ? '✓ Win' : '✗ Loss'} · {m.date}</p>
                                  <p className="text-slate-300 mt-1 truncate">{m.opponent}</p>
                                  <p className="text-slate-400">Rank #{m.opponentRank === 999 ? '—' : m.opponentRank} · {m.round}</p>
                                  <p className="text-slate-500 text-[10px] truncate mt-0.5">{m.tournament}</p>
                                  {m.isUpset  && <p className="text-emerald-400 mt-1 font-semibold">⭐ Upset win</p>}
                                  {m.isClutch && <p className="text-amber-400 font-semibold">⚡ Clutch ({m.gamesWon}–{m.gamesLost})</p>}
                                </div>
                              </div>
                            ))}
                            {activeWindow.recentForm.length === 0 &&
                              <p className="text-sm text-slate-400">No matches in this window</p>}
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">
                            Dark green = upset win · Hover each box for match detail
                          </p>
                        </div>
                      </div>
                    )}

                    {/* ══ TRAJECTORY — Which direction are they moving? ══ */}
                    {activeTab === 'trajectory' && (
                      <div className="space-y-7">

                        {/* Ranking chart — LINKED to global time window */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Ranking Trajectory</h3>
                              <p className="text-xs text-slate-400 mt-0.5">{timeWindow} window · Y-axis inverted — lower rank number = better</p>
                            </div>
                            <div className="flex gap-4 text-xs font-semibold">
                              {activeWindow.bestRank &&
                                <span className="text-emerald-600">Peak #{activeWindow.bestRank}</span>}
                              {activeWindow.worstRank && activeWindow.worstRank !== activeWindow.bestRank &&
                                <span className="text-slate-400">Low #{activeWindow.worstRank}</span>}
                            </div>
                          </div>
                          <div className="bg-slate-50 rounded-xl p-4">
                            {activeWindow.rankingChartData.length > 1 ? (
                              <ResponsiveContainer width="100%" height={250}>
                                <AreaChart data={activeWindow.rankingChartData} margin={{ top: 10, right: 10, bottom: 0, left: -15 }}>
                                  <defs>
                                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%"  stopColor="#0f172a" stopOpacity={0.1} />
                                      <stop offset="95%" stopColor="#0f172a" stopOpacity={0} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} />
                                  <YAxis reversed domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }}
                                    tickLine={false} axisLine={false} tickFormatter={v => `#${v}`} />
                                  <Tooltip
                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '10px', fontSize: 12 }}
                                    labelStyle={{ color: '#94a3b8' }}
                                    formatter={v => [`#${v}`, 'Rank']}
                                  />
                                  {activeWindow.bestRank && (
                                    <ReferenceLine y={activeWindow.bestRank} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
                                      label={{ value: `Peak`, position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                                  )}
                                  <Area type="monotone" dataKey="rank" stroke="#0f172a" strokeWidth={2.5}
                                    fill="url(#rg)" dot={false} activeDot={{ r: 4, fill: '#0f172a', strokeWidth: 0 }} />
                                </AreaChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
                                Not enough ranking data for {timeWindow} window
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Cross-window comparison table */}
                        <div>
                          <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest mb-3">All Windows — Side by Side</h3>
                          <div className="overflow-x-auto rounded-xl border border-slate-100">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                  <th className="text-left px-4 py-3 text-xs text-slate-400 font-medium w-32">Metric</th>
                                  {['6M', '12M', '18M'].map(w => (
                                    <th key={w} className={`text-right px-4 py-3 text-xs font-bold ${w === timeWindow ? 'text-slate-900' : 'text-slate-400'}`}>
                                      {w === timeWindow ? `▶ ${w}` : w}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {KPI_DEFS.map(({ key, label, fmt }) => (
                                  <tr key={key} className="hover:bg-slate-50">
                                    <td className="px-4 py-3 text-xs text-slate-500 font-medium">{label}</td>
                                    {['6M', '12M', '18M'].map(w => (
                                      <td key={w} className={`px-4 py-3 text-right font-semibold text-sm ${w === timeWindow ? 'text-slate-900' : 'text-slate-400'}`}>
                                        {fmt(playerMetrics.windows[w][key])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                                <tr className="hover:bg-slate-50">
                                  <td className="px-4 py-3 text-xs text-slate-500 font-medium">Rank Change</td>
                                  {['6M', '12M', '18M'].map(w => {
                                    const v = playerMetrics.windows[w].rankChange;
                                    return (
                                      <td key={w} className={`px-4 py-3 text-right font-semibold text-sm ${
                                        w === timeWindow
                                          ? v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-slate-900'
                                          : 'text-slate-400'}`}>
                                        {v > 0 ? `+${v}` : v === 0 ? '—' : v}
                                      </td>
                                    );
                                  })}
                                </tr>
                                <tr className="hover:bg-slate-50">
                                  <td className="px-4 py-3 text-xs text-slate-500 font-medium">Matches (W–L)</td>
                                  {['6M', '12M', '18M'].map(w => (
                                    <td key={w} className={`px-4 py-3 text-right font-semibold text-sm ${w === timeWindow ? 'text-slate-900' : 'text-slate-400'}`}>
                                      {playerMetrics.windows[w].wins}W–{playerMetrics.windows[w].losses}L
                                    </td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">▶ = selected window. Toggle above to update all metrics.</p>
                        </div>

                      </div>
                    )}

                    {/* ══ MATCHPLAY — How do they perform under pressure? ══ */}
                    {activeTab === 'matchplay' && (
                      <div className="space-y-7">

                        {/* H2H rank buckets */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Users size={13} className="text-slate-400" />
                            <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Head-to-Head by Rank Tier ({timeWindow})</h3>
                          </div>
                          <div className="space-y-2.5">
                            {activeWindow.h2hBuckets.map(b => (
                              <div key={b.label} className="flex items-center gap-3">
                                <div className="w-16 text-xs font-semibold text-slate-600 shrink-0">{b.label}</div>
                                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                                  {b.total > 0 && (
                                    <div className={`h-full rounded-full transition-all duration-500 ${b.winRate >= 50 ? 'bg-slate-800' : 'bg-red-400'}`}
                                      style={{ width: `${Math.max(b.winRate, 3)}%` }} />
                                  )}
                                </div>
                                <div className="text-xs font-medium text-slate-600 w-32 shrink-0 text-right">
                                  {b.total > 0
                                    ? <>{b.wins}W–{b.losses}L <span className={b.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}>({b.winRate}%)</span></>
                                    : <span className="text-slate-300">No matches</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Clutch + Pressure metrics */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Zap size={13} className="text-slate-400" />
                            <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Pressure Metrics ({timeWindow})</h3>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: 'Clutch Index',    value: `${activeWindow.clutchIndex.toFixed(1)}%`,  sub: 'Wins in 4–5 game matches',    good: activeWindow.clutchIndex >= 50 },
                              { label: 'Upset Yield',     value: `${activeWindow.upsetYield.toFixed(1)}%`,   sub: '% wins vs higher-ranked',      good: activeWindow.upsetYield >= 25  },
                              { label: 'Pt Diff / Game',  value: `${activeWindow.avgPtDiff >= 0 ? '+' : ''}${activeWindow.avgPtDiff.toFixed(2)}`, sub: 'Avg margin per game', good: activeWindow.avgPtDiff > 0 },
                            ].map(item => (
                              <div key={item.label} className="bg-slate-50 rounded-xl p-4">
                                <p className="text-xs text-slate-400 mb-1">{item.label}</p>
                                <p className={`text-2xl font-bold ${item.good ? 'text-emerald-600' : 'text-red-500'}`}>{item.value}</p>
                                <p className="text-xs text-slate-400 mt-1">{item.sub}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Tier performance */}
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Layers size={13} className="text-slate-400" />
                            <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Performance by Event Tier ({timeWindow})</h3>
                          </div>
                          {activeWindow.tierPerfArr.length === 0 ? (
                            <p className="text-sm text-slate-400">No tier data in this window</p>
                          ) : (
                            <div className="rounded-xl border border-slate-100 overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-100">
                                    {['Tier', 'W', 'L', 'Total', 'Win %'].map((h, i) => (
                                      <th key={h} className={`py-2.5 px-4 text-xs text-slate-400 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {activeWindow.tierPerfArr.map(t => (
                                    <tr key={t.tier} className="hover:bg-slate-50">
                                      <td className="py-2.5 px-4 font-semibold text-slate-800">
                                        {t.tier === 'Unknown' ? '—' : `Grade ${t.tier}`}
                                      </td>
                                      <td className="py-2.5 px-4 text-right text-emerald-600 font-semibold">{t.wins}</td>
                                      <td className="py-2.5 px-4 text-right text-red-500 font-semibold">{t.losses}</td>
                                      <td className="py-2.5 px-4 text-right text-slate-500">{t.total}</td>
                                      <td className="py-2.5 px-4 text-right">
                                        <span className={`font-bold ${parseFloat(t.winRate) >= 50 ? 'text-emerald-600' : 'text-red-500'}`}>
                                          {t.winRate}%
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                      </div>
                    )}

                    {/* ══ LEDGER — Raw evidence ══ */}
                    {activeTab === 'ledger' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Match Ledger</h3>
                          <span className="text-xs text-slate-400">Last 50 matches · all time · grouped by tournament</span>
                        </div>
                        {Object.entries(
                          playerMetrics.matchLedger.reduce((acc, m) => {
                            if (!acc[m.tournament]) acc[m.tournament] = [];
                            acc[m.tournament].push(m);
                            return acc;
                          }, {})
                        ).map(([tournament, tMatches]) => (
                          <div key={tournament} className="border border-slate-200 rounded-xl overflow-hidden">
                            <button
                              onClick={() => setExpandedTournament(expandedTournament === tournament ? null : tournament)}
                              className="w-full px-4 py-3 bg-slate-50 flex justify-between items-center hover:bg-slate-100 transition-colors">
                              <div className="flex items-center gap-2.5">
                                <span className="text-sm font-semibold text-slate-800">{tournament}</span>
                                <span className="text-xs text-emerald-600 font-semibold">{tMatches.filter(m => m.result === 'W').length}W</span>
                                <span className="text-xs text-red-500 font-semibold">{tMatches.filter(m => m.result === 'L').length}L</span>
                              </div>
                              {expandedTournament === tournament
                                ? <ChevronUp size={14} className="text-slate-400" />
                                : <ChevronDown size={14} className="text-slate-400" />}
                            </button>

                            {expandedTournament === tournament && (
                              <div className="border-t border-slate-100">
                                <div className="px-4 py-2 bg-slate-50 grid grid-cols-6 gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                  <div>Date</div>
                                  <div className="col-span-2">Opponent</div>
                                  <div className="text-center">Opp Rank</div>
                                  <div>Round</div>
                                  <div className="text-center">Result</div>
                                </div>
                                {tMatches.map((m, i) => (
                                  <div key={i} className="px-4 py-2.5 grid grid-cols-6 gap-2 text-sm items-center border-t border-slate-50 hover:bg-slate-50">
                                    <div className="text-xs text-slate-400">{m.date}</div>
                                    <div className="col-span-2 text-slate-800 font-medium truncate">{m.opponent}</div>
                                    <div className="text-center text-xs text-slate-500">
                                      {m.opponentRank === 999 ? '—' : `#${m.opponentRank}`}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate">{m.round}</div>
                                    <div className="flex items-center gap-1 justify-center">
                                      {m.result === 'W'
                                        ? <CheckCircle2 size={16} className={m.isUpset ? 'text-emerald-500' : 'text-green-400'} />
                                        : <XCircle size={16} className="text-red-400" />
                                      }
                                      {m.isUpset  && <Star size={10} className="text-emerald-500" />}
                                      {m.isClutch && <Zap  size={10} className="text-amber-400" />}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
