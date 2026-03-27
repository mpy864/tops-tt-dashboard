import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  TrendingUp, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Info, Zap, Clock,
  BarChart2, Star, Activity, Search, Target,
  Users, Layers, ArrowRight, Shield, Trophy
} from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseScoresForPlayer(str, isComp1) {
  if (!str || str === 'N/A')
    return { gamesWon: 0, gamesLost: 0, pointsWon: 0, pointsLost: 0, totalGames: 0 };
  let gW = 0, gL = 0, pW = 0, pL = 0;
  for (const g of str.split(',').map(s => s.trim())) {
    const [a, b] = g.split('-').map(Number);
    if (isNaN(a) || isNaN(b)) continue;
    const [p, o] = isComp1 ? [a, b] : [b, a];
    pW += p; pL += o;
    if (p > o) gW++; else gL++;
  }
  return { gamesWon: gW, gamesLost: gL, pointsWon: pW, pointsLost: pL, totalGames: gW + gL };
}

function checkComeback(str, isComp1, won) {
  if (!won || !str || str === 'N/A') return false;
  const games = str.split(',').map(s => s.trim());
  if (games.length < 2) return false;
  const [a, b] = games[0].split('-').map(Number);
  if (isNaN(a) || isNaN(b)) return false;
  return (isComp1 ? a : b) < (isComp1 ? b : a);
}

function fmtMonthYear(date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Strip everything after the 4-digit year (e.g. "WTT Champions Chongqing 2026 Presented by AITO" → "WTT Champions Chongqing 2026")
function cleanCompetitionName(name) {
  if (!name) return 'Unknown';
  const match = name.match(/^(.*?\d{4})/);
  return match ? match[1].trim() : name;
}

// Filter out unplayed sets (0-0) and return player-perspective scores
function parseDisplayGames(str, isComp1) {
  if (!str || str === 'N/A') return [];
  return str.split(',').map(s => s.trim()).filter(g => {
    const [a, b] = g.split('-').map(Number);
    if (isNaN(a) || isNaN(b)) return false;
    if (a === 0 && b === 0) return false; // unplayed set
    return true;
  }).map(g => {
    const [a, b] = g.split('-').map(Number);
    const pScore = isComp1 ? a : b;
    const oScore = isComp1 ? b : a;
    return { pScore, oScore, pWon: pScore > oScore };
  });
}

// Match score pill: e.g. "3-0", "0-3", "3-2" from player perspective
function getMatchScoreStr(gamesWon, gamesLost) {
  return `${gamesWon}-${gamesLost}`;
}

// ─── Chart builder — always monthly for smooth hover, labels by window ─────────

const Q_START_MONTHS = [1, 4, 7, 10]; // Jan Apr Jul Oct
const Q_MONTH_LABEL = { 1: 'Jan', 4: 'Apr', 7: 'Jul', 10: 'Oct' };

function buildRankChartData(rankingHistory, windowMonths) {
  const cutoff = new Date(Date.now() - windowMonths * 30 * 24 * 60 * 60 * 1000);
  const sorted = [...rankingHistory]
    .filter(r => new Date(r.ranking_date) >= cutoff)
    .sort((a, b) => new Date(a.ranking_date) - new Date(b.ranking_date));
  if (!sorted.length) return [];

  // Always monthly granularity → smooth continuous line
  const byMonth = new Map();
  for (const r of sorted) {
    const d = new Date(r.ranking_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, r);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, r]) => {
      const [yr, mo] = key.split('-').map(Number);
      let label = '';
      if (windowMonths === 6) {
        // Monthly labels for 6M
        label = `${new Date(yr, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' })} '${String(yr).slice(2)}`;
      } else {
        // Quarter-start month labels for 12M/18M (Jan/Apr/Jul/Oct), empty for others
        label = Q_START_MONTHS.includes(mo)
          ? `${Q_MONTH_LABEL[mo]} '${String(yr).slice(2)}`
          : '';
      }
      return { label, rank: r.rank, points: r.points };
    });
}

// ─── Window computation ────────────────────────────────────────────────────────

function computeWindowData(matchLedger, rankingHistory, windowMonths, playerCurrentRank) {
  const cutoff = new Date(Date.now() - windowMonths * 30 * 24 * 60 * 60 * 1000);
  const filtered = matchLedger.filter(m => m.rawDate >= cutoff);
  const wins   = filtered.filter(m => m.result === 'W');
  const losses = filtered.filter(m => m.result === 'L');
  const total  = filtered.length;

  const winRate     = total > 0 ? (wins.length / total) * 100 : 0;
  const upsetYield  = wins.length > 0 ? (wins.filter(m => m.isUpset).length / wins.length) * 100 : 0;
  const clutchIndex = wins.length > 0 ? (wins.filter(m => m.isClutch).length / wins.length) * 100 : 0;

  let td = 0, dc = 0;
  for (const m of filtered) { if (m.pointDiff != null) { td += m.pointDiff; dc++; } }
  const avgPtDiff = dc > 0 ? td / dc : 0;

  const rankAtStart = rankingHistory.find(r => new Date(r.ranking_date) <= cutoff)?.rank;
  const rankChange  = rankAtStart ? rankAtStart - playerCurrentRank : 0;

  const straightSetsWins   = wins.filter(m => m.isStraightWin).length;
  const straightSetsLosses = losses.filter(m => m.isStraightLoss).length;
  const comebackWins       = wins.filter(m => m.isComeback).length;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOpponentRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const rankTierBuckets = [
    { label: '0–20',   min: 0,   max: 20   },
    { label: '21–50',  min: 21,  max: 50   },
    { label: '51–100', min: 51,  max: 100  },
    { label: '100+',   min: 101, max: 9999 },
  ].map(b => {
    const bm = filtered.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.result === 'W').length;
    const bl = bm.filter(m => m.result === 'L').length;
    const bt = bw + bl;
    return { ...b, wins: bw, losses: bl, total: bt,
      winRate: bt > 0 ? parseFloat(((bw / bt) * 100).toFixed(1)) : 0, matches: bm };
  });

  const tierMap = {};
  for (const m of filtered) {
    const t = m.eventTier != null ? String(m.eventTier) : 'Unknown';
    if (!tierMap[t]) tierMap[t] = { wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') tierMap[t].wins++; else tierMap[t].losses++;
    tierMap[t].matches.push(m);
  }
  const tierPerfArr = Object.entries(tierMap).map(([tier, t]) => ({
    tier, wins: t.wins, losses: t.losses, total: t.wins + t.losses,
    winRate: (t.wins + t.losses) > 0 ? ((t.wins / (t.wins + t.losses)) * 100).toFixed(1) : '0.0',
    matches: t.matches,
  })).sort((a, b) => a.tier === 'Unknown' ? 1 : b.tier === 'Unknown' ? -1 : parseInt(a.tier) - parseInt(b.tier));

  const cmap = {};
  for (const m of filtered) {
    if (!cmap[m.opponent]) cmap[m.opponent] = { name: m.opponent, wins: 0, losses: 0, currentRank: m.opponentCurrentRank, matches: [] };
    if (m.result === 'W') cmap[m.opponent].wins++; else cmap[m.opponent].losses++;
    cmap[m.opponent].matches.push(m);
  }
  const frequentCompetitors = Object.values(cmap)
    .map(c => ({ ...c, total: c.wins + c.losses, winRate: (c.wins + c.losses) > 0 ? ((c.wins / (c.wins + c.losses)) * 100).toFixed(1) : '0.0' }))
    .sort((a, b) => b.total - a.total).slice(0, 5);

  const nmap = {};
  for (const m of filtered) {
    const cc = m.opponentCountry;
    if (!cc) continue;
    if (!nmap[cc]) nmap[cc] = { country: cc, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') nmap[cc].wins++; else nmap[cc].losses++;
    nmap[cc].matches.push(m);
  }
  const topNations = Object.values(nmap)
    .map(n => ({ ...n, total: n.wins + n.losses, winRate: (n.wins + n.losses) > 0 ? ((n.wins / (n.wins + n.losses)) * 100).toFixed(1) : '0.0' }))
    .sort((a, b) => b.total - a.total).slice(0, 8);

  const dnaGroups = {
    straightWins:   wins.filter(m => m.isStraightWin),
    straightLosses: losses.filter(m => m.isStraightLoss),
    comebacks:      wins.filter(m => m.isComeback),
    clutch:         wins.filter(m => m.isClutch),
  };

  return {
    winRate, upsetYield, clutchIndex, avgPtDiff, rankChange,
    matchCount: total, wins: wins.length, losses: losses.length,
    straightSetsWins, straightSetsLosses, comebackWins,
    avgOpponentRankBeaten, rankTierBuckets, tierPerfArr,
    frequentCompetitors, topNations, dnaGroups,
    allMatches: filtered,
  };
}

// ─── Match Table grouped by competition ───────────────────────────────────────

function MatchTable({ matches }) {
  if (!matches?.length)
    return <p className="text-xs text-slate-400 px-4 py-3">No matches in this window.</p>;

  // Group by cleaned competition name
  const grouped = {};
  for (const m of matches) {
    const comp = cleanCompetitionName(m.tournament);
    if (!grouped[comp]) grouped[comp] = [];
    grouped[comp].push(m);
  }

  return (
    <div>
      {Object.entries(grouped).map(([comp, compMatches]) => (
        <div key={comp}>
          {/* Competition header */}
          <div className="px-4 py-1.5 bg-slate-100 border-y border-slate-200">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{comp}</p>
          </div>
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-4 py-1.5 bg-slate-50 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            <div className="col-span-2">Month/Year</div>
            <div className="col-span-4">Opponent</div>
            <div className="col-span-2 text-center">Rank</div>
            <div className="col-span-2 text-center">Nation</div>
            <div className="col-span-2 text-right">Result</div>
          </div>
          {compMatches.map((m, i) => (
            <MatchRow key={i} match={m} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MatchRow({ match: m }) {
  const [open, setOpen] = useState(false);
  const games = parseDisplayGames(m.score, m.isComp1);
  const scoreStr = getMatchScoreStr(m.gamesWon, m.gamesLost);
  const isWin = m.result === 'W';

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full grid grid-cols-12 gap-2 px-4 py-2.5 hover:bg-blue-50/40 transition-colors items-center text-left">
        <div className="col-span-2 text-xs text-slate-500">{fmtMonthYear(m.rawDate)}</div>
        <div className="col-span-4 text-sm font-semibold text-slate-700 truncate">{m.opponent}</div>
        <div className="col-span-2 text-center text-xs text-slate-500">
          {m.opponentRank === 999 ? '—' : `#${m.opponentRank}`}
        </div>
        <div className="col-span-2 text-center text-xs text-slate-500 uppercase tracking-wide">
          {m.opponentCountry || '—'}
        </div>
        <div className="col-span-2 flex items-center justify-end gap-1.5">
          {/* Score pill */}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isWin ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
            {scoreStr}
          </span>
          {m.isUpset    && <Star size={10} className="text-emerald-500" />}
          {m.isClutch   && <Zap  size={10} className="text-amber-400"  />}
          {m.isComeback && <span className="text-[9px] text-sky-500 font-bold">↩</span>}
          {open ? <ChevronUp size={11} className="text-slate-400" /> : <ChevronDown size={11} className="text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-100 space-y-2">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Round</p>
              <p className="font-medium text-slate-700">{m.round}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Nation</p>
              <p className="font-medium text-slate-700 uppercase">{m.opponentCountry || '—'}</p>
            </div>
          </div>
          {games.length > 0 && (
            <div>
              <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1.5">Set Scores</p>
              <div className="flex gap-1.5 flex-wrap">
                {games.map((g, i) => (
                  <span key={i} className={`px-2 py-1 rounded text-xs font-bold ${
                    g.pWon ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                    {g.pScore}–{g.oScore}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(m.isUpset || m.isClutch || m.isComeback) && (
            <div className="flex gap-2 flex-wrap pt-0.5">
              {m.isUpset    && <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5"><Star size={9} />Upset win</span>}
              {m.isClutch   && <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-0.5"><Zap size={9} />Clutch</span>}
              {m.isComeback && <span className="text-[10px] text-sky-600 font-semibold">↩ Comeback</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Window Toggle ─────────────────────────────────────────────────────────────

function WindowToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {['6M', '12M', '18M'].map(w => (
        <button key={w} onClick={() => onChange(w)}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
            value === w ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          {w}
        </button>
      ))}
    </div>
  );
}

// ─── Win% horizontal section tabs ─────────────────────────────────────────────

const WIN_SECTIONS = [
  { id: 'tier',        label: 'By Event Tier',     Icon: Layers  },
  { id: 'rankTier',   label: 'By Opp. Rank',       Icon: Target  },
  { id: 'competitors', label: 'Top Competitors',    Icon: Users   },
  { id: 'nations',     label: 'Top Nations',        Icon: Shield  },
];

// ─── Main Component ────────────────────────────────────────────────────────────

export default function DynamicOKRDashboard() {
  const [players, setPlayers]               = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerMetrics, setPlayerMetrics]   = useState(null);
  const [loading, setLoading]               = useState(true);
  const [fetching, setFetching]             = useState(false);
  const [error, setError]                   = useState(null);
  const [searchTerm, setSearchTerm]         = useState('');
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [activeTab, setActiveTab]           = useState('rank');
  const [timeWindow, setTimeWindow]         = useState('6M');
  const [activeTooltip, setActiveTooltip]   = useState(null);

  // Win% horizontal section + sub-accordions
  const [winSection, setWinSection]                     = useState('tier');
  const [expandedEventTier, setExpandedEventTier]       = useState(null);
  const [expandedRankTier, setExpandedRankTier]         = useState(null);
  const [expandedCompetitor, setExpandedCompetitor]     = useState(null);
  const [expandedNation, setExpandedNation]             = useState(null);

  // Matches hero card dropdown
  const [matchesDropdownOpen, setMatchesDropdownOpen]   = useState(false);

  // DNA accordion
  const [dnaSection, setDnaSection]                     = useState(null);

  // Recent Form
  const [formShowAll, setFormShowAll]                   = useState(false);
  const [expandedFormIdx, setExpandedFormIdx]           = useState(null);

  const topRef     = useRef(null);
  const contentRef = useRef(null);
  const sectionRef = useRef({});

  const scrollToRef = (key) => {
    setTimeout(() => {
      sectionRef.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setMatchesDropdownOpen(false);
    setDnaSection(null); setExpandedFormIdx(null);
    setTimeout(() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const switchWinSection = (section) => {
    setWinSection(section);
    setExpandedEventTier(null); setExpandedRankTier(null);
    setExpandedCompetitor(null); setExpandedNation(null);
  };

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

  useEffect(() => {
    if (!selectedPlayer) return;
    (async () => {
      setFetching(true); setError(null);
      setDnaSection(null); setExpandedFormIdx(null);
      setFormShowAll(false); setMatchesDropdownOpen(false);
      setExpandedEventTier(null); setExpandedRankTier(null);
      setExpandedCompetitor(null); setExpandedNation(null);
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
          supabase.from('wtt_players').select('ittf_id,player_name,country_code'),
        ]);
        if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4;

        const oppIds = [...new Set(
          (matches || []).map(m => m.comp1_id === selectedPlayer ? m.comp2_id : m.comp1_id)
        )];
        const { data: oppRanks, error: e5 } = await supabase
          .from('rankings_singles_normalized')
          .select('player_id,rank,ranking_date')
          .in('player_id', oppIds)
          .order('ranking_date', { ascending: false });
        if (e5) throw e5;

        const oppRankMap = {};
        for (const r of (oppRanks || [])) {
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
    const matchLedger = (matches || []).map(m => {
      const isComp1 = m.comp1_id === playerId;
      const won     = isComp1 ? m.result === 'W' : m.result === 'L';
      const oppId   = isComp1 ? m.comp2_id : m.comp1_id;
      const oppP    = allPlayers?.find(p => p.ittf_id === oppId);
      const oppH    = oppRankMap[oppId] || [];
      const matchDate = new Date(m.event_date);
      const opponentRank        = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
      const opponentCurrentRank = oppH[0]?.rank ?? 999;
      const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } = parseScoresForPlayer(m.game_scores, isComp1);
      const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
      return {
        rawDate: matchDate,
        date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
        opponent: oppP?.player_name || 'Unknown',
        opponentCountry: oppP?.country_code || null,
        opponentRank, opponentCurrentRank,
        tournament: events?.find(e => e.event_id === m.event_id)?.event_name || 'Unknown',
        eventTier:  events?.find(e => e.event_id === m.event_id)?.event_tier ?? null,
        round:  m.round_phase || 'N/A',
        score:  m.game_scores || 'N/A',
        result: won ? 'W' : 'L',
        isComp1,
        isUpset:       won && opponentRank < playerCurrentRank,
        isClutch:      won && totalGames >= 4,
        isStraightWin: won && gamesLost === 0 && totalGames >= 3,
        isStraightLoss:!won && gamesWon === 0 && totalGames >= 3,
        isComeback:    checkComeback(m.game_scores, isComp1, won),
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

  const activeWindow = useMemo(
    () => playerMetrics?.windows[timeWindow] || null,
    [playerMetrics, timeWindow]
  );

  const rankChartData = useMemo(() => {
    if (!playerMetrics?.rankingHistory) return [];
    return buildRankChartData(playerMetrics.rankingHistory, parseInt(timeWindow));
  }, [playerMetrics, timeWindow]);

  const chartRanks = rankChartData.map(d => d.rank).filter(Boolean);
  const bestRank   = chartRanks.length ? Math.min(...chartRanks) : null;

  const recentAll     = useMemo(() => playerMetrics?.matchLedger.slice(0, 12) || [], [playerMetrics]);
  const recentDisplay = formShowAll ? recentAll : recentAll.slice(0, 5);

  const handleSearch = v => {
    setSearchTerm(v);
    setFilteredPlayers(!v.trim() ? players
      : players.filter(p => p.player_name.toLowerCase().includes(v.toLowerCase())));
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-400">
        <Activity size={18} className="animate-pulse" />
        <span className="text-sm">Loading players…</span>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        .okr * { font-family: 'Sora', sans-serif; }
        .slide-down { animation: sd 0.15s ease-out; }
        @keyframes sd { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div className="okr min-h-screen bg-slate-50 p-6">
        <div className="max-w-5xl mx-auto space-y-5" ref={topRef}>

          {/* Header */}
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">Player Intelligence</h1>
            <p className="text-xs text-slate-400 mt-0.5">TOPS Analytics · TT</p>
          </div>

          {/* Player selector */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" placeholder="Search player…" value={searchTerm}
                onChange={e => handleSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <select value={selectedPlayer || ''}
              onChange={e => { setSelectedPlayer(parseInt(e.target.value)); setActiveTab('rank'); }}
              className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100">
              <option value="">Select player…</option>
              {filteredPlayers.map(p => (
                <option key={p.player_id} value={p.player_id}>
                  {p.player_name} ({p.gender_label}) — #{p.rank}
                </option>
              ))}
            </select>
          </div>

          {error   && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>}
          {fetching && (
            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-blue-500 text-sm flex items-center gap-2">
              <Activity size={13} className="animate-pulse" /> Computing metrics…
            </div>
          )}

          {selectedPlayer && activeWindow && playerMetrics && (
            <>
              {/* ═══ KPI Strip — sole navigation ═══ */}
              <div className="grid grid-cols-4 gap-3">

                <button onClick={() => switchTab('rank')}
                  className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition-all group ${activeTab === 'rank' ? 'border-blue-300 bg-blue-50/50 shadow-sm' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp size={12} className="text-slate-400" />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Rank</span>
                    </div>
                    <ArrowRight size={11} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <p className="text-2xl font-bold text-slate-800">#{playerMetrics.ranking}</p>
                  <p className={`text-xs mt-1 font-semibold ${
                    activeWindow.rankChange > 0 ? 'text-emerald-600'
                    : activeWindow.rankChange < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {activeWindow.rankChange > 0 ? `↑ +${activeWindow.rankChange}`
                      : activeWindow.rankChange < 0 ? `↓ ${activeWindow.rankChange}` : '—'}
                    <span className="text-slate-400 font-normal"> {timeWindow}</span>
                  </p>
                </button>

                <button onClick={() => switchTab('winpct')}
                  className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition-all group ${activeTab === 'winpct' ? 'border-blue-300 bg-blue-50/50 shadow-sm' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Trophy size={12} className="text-slate-400" />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Win %</span>
                    </div>
                    <ArrowRight size={11} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{activeWindow.winRate.toFixed(1)}%</p>
                  <p className="text-xs text-slate-500 mt-1">
                    <span className="text-emerald-600 font-semibold">{activeWindow.wins}W</span>
                    {' / '}
                    <span className="text-red-400 font-semibold">{activeWindow.losses}L</span>
                    <span className="text-slate-400 ml-1">· {timeWindow}</span>
                  </p>
                </button>

                <button onClick={() => switchTab('dna')}
                  className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition-all group ${activeTab === 'dna' ? 'border-blue-300 bg-blue-50/50 shadow-sm' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Activity size={12} className="text-slate-400" />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">DNA</span>
                    </div>
                    <ArrowRight size={11} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{activeWindow.clutchIndex.toFixed(1)}%</p>
                  <p className="text-xs text-slate-400 mt-1">Clutch index · {timeWindow}</p>
                </button>

                <button onClick={() => switchTab('form')}
                  className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition-all group ${activeTab === 'form' ? 'border-blue-300 bg-blue-50/50 shadow-sm' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} className="text-slate-400" />
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Recent Form</span>
                    </div>
                    <ArrowRight size={11} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    {recentAll.slice(0, 5).map((m, i) => (
                      <div key={i} className={`w-5 h-5 rounded-full ${
                        m.result === 'W' ? m.isUpset ? 'bg-emerald-500' : 'bg-emerald-200' : 'bg-red-300'}`} />
                    ))}
                    {!recentAll.length && <span className="text-xs text-slate-400">No data</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">Last {Math.min(5, recentAll.length)} matches</p>
                </button>

              </div>

              {/* ═══ Tab Content — no duplicate tab bar ═══ */}
              <div ref={contentRef} className="space-y-4">

                {/* ══ RANK ══ */}
                {activeTab === 'rank' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ranking Trajectory</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {timeWindow === '6M' ? 'Monthly x-axis' : 'Quarterly x-axis (Jan/Apr/Jul/Oct)'} · lower = better
                        </p>
                      </div>
                      <WindowToggle value={timeWindow} onChange={setTimeWindow} />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Current Rank', value: `#${playerMetrics.ranking}`, color: 'text-slate-800' },
                        { label: `Peak (${timeWindow})`,   value: bestRank ? `#${bestRank}` : '—', color: 'text-emerald-600' },
                        {
                          label: `Change (${timeWindow})`,
                          value: activeWindow.rankChange > 0 ? `+${activeWindow.rankChange}`
                            : activeWindow.rankChange === 0 ? '—' : `${activeWindow.rankChange}`,
                          color: activeWindow.rankChange > 0 ? 'text-emerald-600'
                            : activeWindow.rankChange < 0 ? 'text-red-400' : 'text-slate-400',
                        },
                      ].map(c => (
                        <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{c.label}</p>
                          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      {rankChartData.length > 1 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <AreaChart data={rankChartData} margin={{ top: 10, right: 40, bottom: 0, left: -10 }}>
                            <defs>
                              <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.12} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                              </linearGradient>
                              <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#10b981" stopOpacity={0.08} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}    />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }}
                              tickLine={false} axisLine={false}
                              interval={0}
                              // Hide ticks with empty labels
                              tickFormatter={v => v}
                            />
                            <YAxis yAxisId="rank" reversed domain={['auto', 'auto']}
                              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                              tickFormatter={v => `#${v}`} />
                            <YAxis yAxisId="pts" orientation="right"
                              tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
                              labelStyle={{ color: '#64748b', fontWeight: 600 }}
                              formatter={(v, name) => [name === 'rank' ? `#${v}` : v, name === 'rank' ? 'Rank' : 'Points']}
                            />
                            {bestRank && (
                              <ReferenceLine yAxisId="rank" y={bestRank}
                                stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
                                label={{ value: `Peak #${bestRank}`, position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                            )}
                            <Area yAxisId="rank" type="monotone" dataKey="rank"
                              stroke="#3b82f6" strokeWidth={2} fill="url(#rg)"
                              dot={false} activeDot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
                            <Area yAxisId="pts" type="monotone" dataKey="points"
                              stroke="#10b981" strokeWidth={1.5} fill="url(#pg)"
                              dot={false} activeDot={{ r: 3, fill: '#10b981', strokeWidth: 0 }}
                              strokeDasharray="4 4" />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
                          Not enough ranking data for {timeWindow} window
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400 mt-2">
                        — Rank (left axis) &nbsp;·&nbsp; - - Points (right axis)
                      </p>
                    </div>
                  </div>
                )}

                {/* ══ WIN % ══ */}
                {activeTab === 'winpct' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Win %</h3>
                      <WindowToggle value={timeWindow} onChange={setTimeWindow} />
                    </div>

                    {/* Hero row */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Win Rate',         value: `${activeWindow.winRate.toFixed(1)}%`,    sub: `${activeWindow.wins}W / ${activeWindow.losses}L` },
                        { label: 'Upset Yield',      value: `${activeWindow.upsetYield.toFixed(1)}%`, sub: '% of wins vs higher-ranked' },
                        { label: 'Avg Opp Rank Won', value: activeWindow.avgOpponentRankBeaten ? `#${activeWindow.avgOpponentRankBeaten}` : '—', sub: 'avg rank of opp. beaten' },
                        { label: 'Matches', value: activeWindow.matchCount, sub: `${timeWindow} window`, clickable: true },
                      ].map(card => (
                        <div key={card.label} className="relative">
                          <div
                            onClick={card.clickable ? () => setMatchesDropdownOpen(o => !o) : undefined}
                            className={`bg-white border border-slate-200 rounded-xl p-3 ${card.clickable ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all' : ''}`}>
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{card.label}</p>
                            <div className="flex items-center gap-1">
                              <p className="text-xl font-bold text-slate-800">{card.value}</p>
                              {card.clickable && (matchesDropdownOpen
                                ? <ChevronUp size={13} className="text-slate-400" />
                                : <ChevronDown size={13} className="text-slate-400" />)}
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">{card.sub}</p>
                          </div>
                          {card.clickable && matchesDropdownOpen && (
                            <div className="slide-down absolute top-full left-0 z-20 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
                              style={{ minWidth: '640px' }}>
                              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-600">All {activeWindow.matchCount} matches · {timeWindow}</span>
                                <button onClick={() => setMatchesDropdownOpen(false)}>
                                  <ChevronUp size={13} className="text-slate-400" />
                                </button>
                              </div>
                              <div className="max-h-72 overflow-y-auto">
                                <MatchTable matches={activeWindow.allMatches} />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* ── Horizontal section tabs ── */}
                    <div className="flex gap-1 border-b border-slate-200">
                      {WIN_SECTIONS.map(({ id, label, Icon }) => (
                        <button key={id} onClick={() => switchWinSection(id)}
                          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold rounded-t-lg border transition-all whitespace-nowrap ${
                            winSection === id
                              ? 'bg-gradient-to-b from-blue-50 to-white border-slate-200 border-b-white text-blue-700 -mb-px'
                              : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                          <Icon size={12} />
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Section content */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

                      {/* By Event Tier */}
                      {winSection === 'tier' && (
                        <div className="slide-down">
                          {activeWindow.tierPerfArr.length === 0
                            ? <p className="text-sm text-slate-400 p-4">No tier data in this window.</p>
                            : activeWindow.tierPerfArr.map(t => (
                              <div key={t.tier} className="border-b border-slate-100 last:border-0">
                                <button
                                  onClick={() => setExpandedEventTier(expandedEventTier === t.tier ? null : t.tier)}
                                  className="w-full grid grid-cols-12 gap-2 px-4 py-3 hover:bg-slate-50 transition-colors items-center text-left">
                                  <div className="col-span-4 text-sm font-semibold text-slate-700">
                                    {t.tier === 'Unknown' ? 'Unclassified' : `Grade ${t.tier}`}
                                  </div>
                                  <div className="col-span-4 text-sm text-center">
                                    <span className="text-emerald-600 font-semibold">{t.wins}W</span>
                                    {' / '}
                                    <span className="text-red-400 font-semibold">{t.losses}L</span>
                                  </div>
                                  <div className={`col-span-3 text-center font-bold text-sm ${parseFloat(t.winRate) >= 50 ? 'text-emerald-600' : 'text-red-400'}`}>
                                    {t.winRate}%
                                  </div>
                                  <div className="col-span-1 text-right">
                                    {expandedEventTier === t.tier
                                      ? <ChevronUp size={12} className="text-slate-400 ml-auto" />
                                      : <ChevronDown size={12} className="text-slate-400 ml-auto" />}
                                  </div>
                                </button>
                                {expandedEventTier === t.tier && (
                                  <div className="slide-down border-t border-slate-100 bg-slate-50/40">
                                    <MatchTable matches={t.matches} />
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                      {/* By Opponent Rank */}
                      {winSection === 'rankTier' && (
                        <div className="slide-down">
                          {activeWindow.rankTierBuckets.map(b => (
                            <div key={b.label} className="border-b border-slate-100 last:border-0">
                              <button
                                onClick={() => setExpandedRankTier(expandedRankTier === b.label ? null : b.label)}
                                className="w-full grid grid-cols-12 gap-2 px-4 py-3 hover:bg-slate-50 transition-colors items-center text-left">
                                <div className="col-span-4 text-sm font-semibold text-slate-700">Rank {b.label}</div>
                                <div className="col-span-4 text-center text-sm">
                                  {b.total > 0
                                    ? <><span className="text-emerald-600 font-semibold">{b.wins}W</span>{' / '}<span className="text-red-400 font-semibold">{b.losses}L</span></>
                                    : <span className="text-slate-300 text-xs">No matches</span>}
                                </div>
                                <div className={`col-span-3 text-center font-bold text-sm ${
                                  b.total === 0 ? 'text-slate-300' : b.winRate >= 50 ? 'text-emerald-600' : 'text-red-400'}`}>
                                  {b.total > 0 ? `${b.winRate}%` : '—'}
                                </div>
                                <div className="col-span-1 text-right">
                                  {b.total > 0 && (expandedRankTier === b.label
                                    ? <ChevronUp size={12} className="text-slate-400 ml-auto" />
                                    : <ChevronDown size={12} className="text-slate-400 ml-auto" />)}
                                </div>
                              </button>
                              {expandedRankTier === b.label && b.matches.length > 0 && (
                                <div className="slide-down border-t border-slate-100 bg-slate-50/40">
                                  <MatchTable matches={b.matches} />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Top Competitors */}
                      {winSection === 'competitors' && (
                        <div className="slide-down">
                          {activeWindow.frequentCompetitors.length === 0
                            ? <p className="text-sm text-slate-400 p-4">No data in this window.</p>
                            : activeWindow.frequentCompetitors.map((c, ci) => (
                              <div key={ci} className="border-b border-slate-100 last:border-0">
                                <button
                                  onClick={() => setExpandedCompetitor(expandedCompetitor === c.name ? null : c.name)}
                                  className="w-full grid grid-cols-12 gap-2 px-4 py-3 hover:bg-slate-50 transition-colors items-center text-left">
                                  <div className="col-span-4 text-sm font-semibold text-slate-700 truncate">{c.name}</div>
                                  <div className="col-span-2 text-center text-xs text-slate-400">
                                    {c.currentRank === 999 ? '—' : `#${c.currentRank}`}
                                  </div>
                                  <div className="col-span-3 text-center text-sm">
                                    <span className="text-emerald-600 font-semibold">{c.wins}W</span>
                                    {' / '}
                                    <span className="text-red-400 font-semibold">{c.losses}L</span>
                                  </div>
                                  <div className="col-span-2 text-center">
                                    <span className={`text-sm font-bold ${parseFloat(c.winRate) >= 50 ? 'text-emerald-600' : 'text-red-400'}`}>
                                      {c.winRate}%
                                    </span>
                                  </div>
                                  <div className="col-span-1 text-right">
                                    {expandedCompetitor === c.name
                                      ? <ChevronUp size={12} className="text-slate-400 ml-auto" />
                                      : <ChevronDown size={12} className="text-slate-400 ml-auto" />}
                                  </div>
                                </button>
                                {expandedCompetitor === c.name && (
                                  <div className="slide-down border-t border-slate-100 bg-slate-50/40">
                                    <MatchTable matches={c.matches} />
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Top Nations */}
                      {winSection === 'nations' && (
                        <div className="slide-down">
                          {activeWindow.topNations.length === 0
                            ? <p className="text-sm text-slate-400 p-4">No nation data in this window.</p>
                            : activeWindow.topNations.map((n, ni) => (
                              <div key={ni} className="border-b border-slate-100 last:border-0">
                                <button
                                  onClick={() => setExpandedNation(expandedNation === n.country ? null : n.country)}
                                  className="w-full grid grid-cols-12 gap-2 px-4 py-3 hover:bg-slate-50 transition-colors items-center text-left">
                                  <div className="col-span-4 text-sm font-semibold text-slate-700 uppercase tracking-wide">{n.country}</div>
                                  <div className="col-span-2 text-center text-xs text-slate-400">{n.total} matches</div>
                                  <div className="col-span-3 text-center text-sm">
                                    <span className="text-emerald-600 font-semibold">{n.wins}W</span>
                                    {' / '}
                                    <span className="text-red-400 font-semibold">{n.losses}L</span>
                                  </div>
                                  <div className="col-span-2 text-center">
                                    <span className={`text-sm font-bold ${parseFloat(n.winRate) >= 50 ? 'text-emerald-600' : 'text-red-400'}`}>
                                      {n.winRate}%
                                    </span>
                                  </div>
                                  <div className="col-span-1 text-right">
                                    {expandedNation === n.country
                                      ? <ChevronUp size={12} className="text-slate-400 ml-auto" />
                                      : <ChevronDown size={12} className="text-slate-400 ml-auto" />}
                                  </div>
                                </button>
                                {expandedNation === n.country && (
                                  <div className="slide-down border-t border-slate-100 bg-slate-50/40">
                                    <MatchTable matches={n.matches} />
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      )}

                    </div>
                  </div>
                )}

                {/* ══ PERFORMANCE DNA ══ */}
                {activeTab === 'dna' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Performance DNA</h3>
                      <WindowToggle value={timeWindow} onChange={setTimeWindow} />
                    </div>

                    {/* Avg Pt Diff summary */}
                    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Avg Point Differential per Game</p>
                        <p className={`text-3xl font-bold ${
                          activeWindow.avgPtDiff > 0 ? 'text-emerald-600'
                          : activeWindow.avgPtDiff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {activeWindow.avgPtDiff >= 0 ? '+' : ''}{activeWindow.avgPtDiff.toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">Across {activeWindow.matchCount} matches · {timeWindow}</p>
                      </div>
                      <BarChart2 size={32} className="text-slate-200" />
                    </div>

                    <div className="space-y-2">
                      {[
                        {
                          key: 'straightWins',
                          title: 'Straight Sets Wins (3-0)',
                          Icon: CheckCircle2,
                          count: activeWindow.straightSetsWins,
                          pct: activeWindow.wins > 0 ? ((activeWindow.straightSetsWins / activeWindow.wins) * 100).toFixed(1) : null,
                          pctOf: `of ${activeWindow.wins} wins`,
                          color: 'text-emerald-600',
                          tip: 'Matches won without dropping a single game.',
                          matches: activeWindow.dnaGroups.straightWins,
                        },
                        {
                          key: 'straightLosses',
                          title: 'Straight Sets Losses (0-3)',
                          Icon: XCircle,
                          count: activeWindow.straightSetsLosses,
                          pct: activeWindow.losses > 0 ? ((activeWindow.straightSetsLosses / activeWindow.losses) * 100).toFixed(1) : null,
                          pctOf: `of ${activeWindow.losses} losses`,
                          color: 'text-red-400',
                          tip: 'Matches lost without winning a single game.',
                          matches: activeWindow.dnaGroups.straightLosses,
                        },
                        {
                          key: 'comebacks',
                          title: 'Comeback Wins',
                          Icon: ArrowRight,
                          count: activeWindow.comebackWins,
                          pct: activeWindow.wins > 0 ? ((activeWindow.comebackWins / activeWindow.wins) * 100).toFixed(1) : null,
                          pctOf: 'won after losing game 1',
                          color: 'text-sky-600',
                          tip: 'Matches won despite losing the opening game.',
                          matches: activeWindow.dnaGroups.comebacks,
                        },
                        {
                          key: 'clutch',
                          title: `Clutch Index · ${activeWindow.clutchIndex.toFixed(1)}%`,
                          Icon: Zap,
                          count: activeWindow.dnaGroups.clutch.length,
                          pct: activeWindow.wins > 0 ? ((activeWindow.dnaGroups.clutch.length / activeWindow.wins) * 100).toFixed(1) : null,
                          pctOf: 'wins in 4–5 game matches',
                          color: 'text-amber-600',
                          tip: '% of wins that required 4 or 5 games.',
                          matches: activeWindow.dnaGroups.clutch,
                        },
                      ].map(item => (
                        <div key={item.key} className="border border-slate-200 rounded-xl overflow-hidden">
                          <button
                            onClick={() => setDnaSection(dnaSection === item.key ? null : item.key)}
                            className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
                              dnaSection === item.key ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'}`}>
                            <div className="flex items-center gap-3">
                              <item.Icon size={13} className="text-slate-400" />
                              <div className="text-left">
                                <p className="text-sm font-semibold text-slate-700">{item.title}</p>
                                <p className="text-xs text-slate-400">
                                  <span className={`font-bold ${item.color}`}>{item.count}</span>
                                  {item.pct && <span> · {item.pct}% {item.pctOf}</span>}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="relative"
                                onMouseEnter={() => setActiveTooltip(item.key)}
                                onMouseLeave={() => setActiveTooltip(null)}>
                                <Info size={11} className="text-slate-300 hover:text-slate-400 cursor-help" />
                                {activeTooltip === item.key && (
                                  <div className="absolute right-0 bottom-5 w-48 bg-white border border-slate-200 text-slate-600 text-xs rounded-lg p-2.5 z-30 shadow-lg leading-relaxed">
                                    {item.tip}
                                  </div>
                                )}
                              </div>
                              {dnaSection === item.key
                                ? <ChevronUp size={14} className="text-slate-400" />
                                : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </button>
                          {dnaSection === item.key && (
                            <div className="slide-down border-t border-slate-100">
                              <MatchTable matches={item.matches} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ══ RECENT FORM ══ */}
                {activeTab === 'form' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recent Form</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Click any row to expand · showing last {recentDisplay.length}</p>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                      {recentDisplay.map((m, i) => {
                        const isWin = m.result === 'W';
                        const scoreStr = getMatchScoreStr(m.gamesWon, m.gamesLost);
                        const games = parseDisplayGames(m.score, m.isComp1);
                        return (
                          <div key={i}>
                            <button
                              onClick={() => setExpandedFormIdx(expandedFormIdx === i ? null : i)}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                                expandedFormIdx === i ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isWin ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-400'}`}>
                                {isWin ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-700 truncate">{m.opponent}</p>
                                <p className="text-xs text-slate-400">
                                  {m.opponentRank === 999 ? 'Unranked' : `#${m.opponentRank}`}
                                  {m.opponentCountry && <span className="ml-1 uppercase">· {m.opponentCountry}</span>}
                                  {' · '}{fmtMonthYear(m.rawDate)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {m.isUpset    && <Star size={10} className="text-emerald-500" />}
                                {m.isClutch   && <Zap  size={10} className="text-amber-400"  />}
                                {m.isComeback && <span className="text-[9px] text-sky-500 font-bold">↩</span>}
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  isWin ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                                  {scoreStr}
                                </span>
                                {expandedFormIdx === i
                                  ? <ChevronUp size={12} className="text-slate-400" />
                                  : <ChevronDown size={12} className="text-slate-400" />}
                              </div>
                            </button>

                            {expandedFormIdx === i && (
                              <div className="slide-down border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-2">
                                <div className="grid grid-cols-3 gap-3 text-xs">
                                  <div>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Competition</p>
                                    <p className="font-medium text-slate-700">{cleanCompetitionName(m.tournament)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Round</p>
                                    <p className="font-medium text-slate-700">{m.round}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Nation</p>
                                    <p className="font-medium text-slate-700 uppercase">{m.opponentCountry || '—'}</p>
                                  </div>
                                </div>
                                {games.length > 0 && (
                                  <div>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1.5">Set Scores</p>
                                    <div className="flex gap-1.5 flex-wrap">
                                      {games.map((g, gi) => (
                                        <span key={gi} className={`px-2 py-1 rounded text-xs font-bold ${
                                          g.pWon ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-500'}`}>
                                          {g.pScore}–{g.oScore}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {recentAll.length === 0 && (
                        <p className="text-sm text-slate-400 p-4">No matches found.</p>
                      )}
                    </div>

                    {recentAll.length > 5 && (
                      <button
                        onClick={() => { setFormShowAll(o => !o); setExpandedFormIdx(null); }}
                        className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors flex items-center justify-center gap-1.5">
                        {formShowAll
                          ? <><ChevronUp size={13} /> Show less</>
                          : <><ChevronDown size={13} /> Show {Math.min(12, recentAll.length)} matches</>}
                      </button>
                    )}

                    <p className="text-[10px] text-slate-400">
                      <span className="text-emerald-500 font-semibold">★</span> Upset win &nbsp;·&nbsp;
                      <span className="text-amber-500 font-semibold">⚡</span> Clutch (4–5 games) &nbsp;·&nbsp;
                      <span className="text-sky-500 font-semibold">↩</span> Comeback
                    </p>
                  </div>
                )}

              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
