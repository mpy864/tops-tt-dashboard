import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { X, ArrowLeft, Plus, ChevronDown, ChevronUp } from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];
const MAX_PLAYERS   = 5;
const WINDOWS       = [
  { label: '6M',  months: 6  },
  { label: '12M', months: 12 },
  { label: '18M', months: 18 },
];

const WL_FILTERS = [
  { id: 'rank',       label: 'By rank'   },
  { id: 'tier',       label: 'By tier'   },
  { id: 'nation',     label: 'By nation' },
  { id: 'style',      label: 'By style'  },
  { id: 'grip',       label: 'By grip'   },
];

const RANK_BUCKETS = [
  { label: 'Top 10',   min: 1,   max: 10  },
  { label: '11–25',    min: 11,  max: 25  },
  { label: '26–50',    min: 26,  max: 50  },
  { label: '51–100',   min: 51,  max: 100 },
  { label: '101–200',  min: 101, max: 200 },
  { label: '200+',     min: 201, max: 9999},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

function fmtStyle(handedness, grip) {
  const parts = [];
  if (handedness) parts.push(handedness.replace(' Hand',''));
  if (grip) parts.push(grip);
  return parts.join(' · ') || '—';
}

function windowCutoff(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

function parseScores(gameScores, isComp1) {
  if (!gameScores) return { gamesWon: 0, gamesLost: 0 };
  const games = gameScores.split(',').map(g => {
    const [a, b] = g.split('-').map(Number);
    return isComp1 ? { p: a, o: b } : { p: b, o: a };
  }).filter(g => !(g.p === 0 && g.o === 0));
  return {
    gamesWon:  games.filter(g => g.p > g.o).length,
    gamesLost: games.filter(g => g.o > g.p).length,
  };
}

// ─── Build metrics for one player ─────────────────────────────────────────────

function buildPlayerMetrics(matches, rankings, events, allPlayers, oppRankMap, pid, windowMonths) {
  const cutoff = windowCutoff(windowMonths);
  const playerRank = rankings?.[0]?.rank || 999;

  const filtered = (matches || []).filter(m => {
    const d = new Date(m.event_date);
    return !isNaN(d) && d >= cutoff;
  });

  const ledger = filtered.map(m => {
    const isComp1 = parseInt(m.comp1_id) === pid;
    const won     = isComp1 ? m.result === 'W' : m.result === 'L';
    const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
    const oppP    = allPlayers?.find(p => parseInt(p.ittf_id) === oppId);
    const oppH    = oppRankMap[oppId] || [];
    const matchDate = new Date(m.event_date);
    const oppRank   = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
    const event     = events?.find(e => e.event_id === m.event_id);
    const { gamesWon, gamesLost } = parseScores(m.game_scores, isComp1);
    const totalGames = gamesWon + gamesLost;
    return {
      rawDate: matchDate,
      won,
      result: won ? 'W' : 'L',
      oppId,
      opponent: oppP?.player_name || 'Unknown',
      opponentCountry: oppP?.country_code || null,
      opponentHandedness: oppP?.handedness || null,
      opponentGrip: oppP?.grip || null,
      opponentRank: oppRank,
      eventTier: event?.tops_grade ?? null,
      eventName: event?.event_name || 'Unknown',
      gamesWon, gamesLost, totalGames,
      isClutch:   won && gamesLost === gamesWon - 1,
      isComeback: (() => {
        if (!won || !m.game_scores) return false;
        const games = m.game_scores.split(',');
        if (!games[0]) return false;
        const [a, b] = games[0].split('-').map(Number);
        return isComp1 ? a < b : b < a;
      })(),
      isStraightWin:  won  && gamesLost === 0 && totalGames >= 3,
      isStraightLoss: !won && gamesWon  === 0 && totalGames >= 3,
      isUpset: won && oppRank < playerRank,
    };
  });

  const wins   = ledger.filter(m => m.won);
  const losses = ledger.filter(m => !m.won);
  const total  = wins.length + losses.length;
  const winRate = total > 0 ? (wins.length / total) * 100 : 0;

  const clutchGames = ledger.filter(m => m.gamesLost === m.gamesWon - 1 || m.gamesLost === m.gamesWon + 1);
  const clutchWins  = clutchGames.filter(m => m.won).length;
  const clutchIndex = clutchGames.length > 0 ? (clutchWins / clutchGames.length) * 100 : null;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOppRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const upsetWins = wins.filter(m => m.isUpset).length;
  const upsetYield = wins.length > 0 ? (upsetWins / wins.length) * 100 : 0;

  // WL breakdowns
  const rankBuckets = RANK_BUCKETS.map(b => {
    const bm = ledger.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.won).length;
    const bl = bm.filter(m => !m.won).length;
    const bt = bw + bl;
    return { ...b, wins: bw, losses: bl, total: bt, winPct: bt > 0 ? (bw/bt)*100 : 0 };
  }).filter(b => b.total > 0);

  const tierMap = {};
  for (const m of ledger) {
    const t = m.eventTier != null ? String(m.eventTier) : 'Unknown';
    if (!tierMap[t]) tierMap[t] = { wins: 0, losses: 0 };
    if (m.won) tierMap[t].wins++; else tierMap[t].losses++;
  }
  const tierBuckets = Object.entries(tierMap).map(([tier, t]) => {
    const bt = t.wins + t.losses;
    return { label: tier === 'Unknown' ? 'Unclassified' : `Grade ${tier}`, tier,
      wins: t.wins, losses: t.losses, total: bt, winPct: bt > 0 ? (t.wins/bt)*100 : 0 };
  }).sort((a, b) => a.tier === 'Unknown' ? 1 : b.tier === 'Unknown' ? -1 : parseInt(a.tier)-parseInt(b.tier));

  const nationMap = {};
  for (const m of ledger) {
    const cc = m.opponentCountry; if (!cc) continue;
    if (!nationMap[cc]) nationMap[cc] = { wins: 0, losses: 0 };
    if (m.won) nationMap[cc].wins++; else nationMap[cc].losses++;
  }
  const nationBuckets = Object.entries(nationMap).map(([cc, n]) => {
    const bt = n.wins + n.losses;
    return { label: cc.toUpperCase(), wins: n.wins, losses: n.losses, total: bt, winPct: bt > 0 ? (n.wins/bt)*100 : 0 };
  }).sort((a, b) => b.total - a.total).slice(0, 6);

  const styleMap = {};
  for (const m of ledger) {
    const hand = m.opponentHandedness || 'Unknown';
    const grip = m.opponentGrip || 'Unknown';
    const key  = hand === 'Unknown' && grip === 'Unknown' ? 'Unknown'
      : [hand.replace(' Hand',''), grip].filter(s => s && s !== 'Unknown').join(' · ') || 'Unknown';
    if (!styleMap[key]) styleMap[key] = { wins: 0, losses: 0 };
    if (m.won) styleMap[key].wins++; else styleMap[key].losses++;
  }
  const styleBuckets = Object.entries(styleMap)
    .filter(([k]) => k !== 'Unknown')
    .map(([k, v]) => {
      const bt = v.wins + v.losses;
      return { label: k, wins: v.wins, losses: v.losses, total: bt, winPct: bt > 0 ? (v.wins/bt)*100 : 0 };
    }).sort((a, b) => b.total - a.total);

  const gripMap = {};
  for (const m of ledger) {
    const g = m.opponentGrip || 'Unknown';
    if (!gripMap[g]) gripMap[g] = { wins: 0, losses: 0 };
    if (m.won) gripMap[g].wins++; else gripMap[g].losses++;
  }
  const gripBuckets = Object.entries(gripMap)
    .filter(([k]) => k !== 'Unknown')
    .map(([k, v]) => {
      const bt = v.wins + v.losses;
      return { label: k, wins: v.wins, losses: v.losses, total: bt, winPct: bt > 0 ? (v.wins/bt)*100 : 0 };
    }).sort((a, b) => b.total - a.total);

  return {
    total, wins: wins.length, losses: losses.length, winRate,
    clutchIndex, avgOppRankBeaten, upsetYield,
    straightSetsWins:   wins.filter(m => m.isStraightWin).length,
    straightSetsLosses: losses.filter(m => m.isStraightLoss).length,
    comebackWins:       wins.filter(m => m.isComeback).length,
    rankBuckets, tierBuckets, nationBuckets, styleBuckets, gripBuckets,
    ledger,
  };
}

// ─── Mini bar component ───────────────────────────────────────────────────────

function MiniBar({ wins, losses, color }) {
  const total = wins + losses;
  if (total === 0) return <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>;
  const pct = (wins / total) * 100;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 2, minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
        {wins}W/{losses}L
      </span>
    </div>
  );
}

// ─── WL breakdown section ────────────────────────────────────────────────────

function WLBreakdown({ metrics, color }) {
  const [filter, setFilter] = useState('rank');
  if (!metrics) return null;

  const buckets = {
    rank:   metrics.rankBuckets,
    tier:   metrics.tierBuckets,
    nation: metrics.nationBuckets,
    style:  metrics.styleBuckets,
    grip:   metrics.gripBuckets,
  }[filter] || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {WL_FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            fontSize: 10, padding: '3px 8px', borderRadius: 99, border: '1px solid',
            borderColor: filter === f.id ? color : '#e2e8f0',
            background: filter === f.id ? color : 'white',
            color: filter === f.id ? 'white' : '#64748b',
            cursor: 'pointer', fontWeight: 500,
          }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {buckets.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>No data</span>}
        {buckets.map((b, i) => (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>{b.label}</span>
              <span style={{ fontSize: 11, color: b.winPct >= 50 ? '#059669' : '#dc2626', fontWeight: 600 }}>
                {b.winPct.toFixed(0)}%
              </span>
            </div>
            <MiniBar wins={b.wins} losses={b.losses} color={color} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rank chart ───────────────────────────────────────────────────────────────

function RankChart({ playersData, windowMonths }) {
  const cutoff = windowCutoff(windowMonths);

  const chartData = useMemo(() => {
    const pointMap = {};
    playersData.forEach(({ pid, rankings, color, name }) => {
      (rankings || []).forEach(r => {
        const d = new Date(r.ranking_date);
        if (d < cutoff) return;
        const key = r.ranking_date;
        if (!pointMap[key]) pointMap[key] = { date: key, x: d.getTime() };
        pointMap[key][pid] = r.rank;
      });
    });
    return Object.values(pointMap).sort((a, b) => a.x - b.x);
  }, [playersData, windowMonths]);

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return `${d.toLocaleString('default', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="x" type="number" domain={['auto','auto']}
          tickFormatter={fmtDate} tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickCount={5} />
        <YAxis reversed tick={{ fontSize: 10, fill: '#94a3b8' }} />
        <Tooltip
          formatter={(v, name) => [`#${v}`, playersData.find(p => p.pid === parseInt(name))?.name || name]}
          labelFormatter={fmtDate}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
        {playersData.map(({ pid, color }) => (
          <Area key={pid} type="monotone" dataKey={String(pid)}
            stroke={color} fill={color} fillOpacity={0.08}
            strokeWidth={2} dot={false} connectNulls />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── H2H Matrix ──────────────────────────────────────────────────────────────

function H2HMatrix({ playersData }) {
  if (playersData.length < 2) return null;

  // Build matrix: for each pair (A, B), find matches where A played B
  const matrix = {};
  playersData.forEach(a => {
    matrix[a.pid] = {};
    playersData.forEach(b => {
      if (a.pid === b.pid) { matrix[a.pid][b.pid] = null; return; }
      const h2h = (a.matches || []).filter(m => {
        const isComp1 = parseInt(m.comp1_id) === a.pid;
        const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
        return oppId === b.pid;
      });
      const wins   = h2h.filter(m => (parseInt(m.comp1_id) === a.pid ? m.result === 'W' : m.result === 'L')).length;
      const losses = h2h.length - wins;
      matrix[a.pid][b.pid] = { wins, losses, total: h2h.length };
    });
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontWeight: 500, fontSize: 11 }}>vs</th>
            {playersData.map((p, i) => (
              <th key={p.pid} style={{ padding: '8px 12px', textAlign: 'center', color: PLAYER_COLORS[i], fontWeight: 600, fontSize: 11 }}>
                {p.name.split(' ')[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playersData.map((rowP, ri) => (
            <tr key={rowP.pid} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 12px', fontWeight: 600, color: PLAYER_COLORS[ri], fontSize: 11 }}>
                {rowP.name.split(' ')[0]}
              </td>
              {playersData.map((colP, ci) => {
                if (rowP.pid === colP.pid) return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center', background: '#f8fafc', color: '#cbd5e1' }}>—</td>
                );
                const cell = matrix[rowP.pid]?.[colP.pid];
                if (!cell || cell.total === 0) return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center', color: '#cbd5e1', fontSize: 11 }}>—</td>
                );
                return (
                  <td key={colP.pid} style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <span style={{
                      fontWeight: 700, fontSize: 12,
                      color: cell.wins > cell.losses ? '#059669' : cell.losses > cell.wins ? '#dc2626' : '#64748b',
                    }}>
                      {cell.wins}W/{cell.losses}L
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function H2HDashboard() {
  const [allPlayers, setAllPlayers]     = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [searchTerm, setSearchTerm]     = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [windowMonths, setWindowMonths] = useState(6);
  const [playerData, setPlayerData]     = useState({});
  const [loading, setLoading]           = useState(true);
  const [fetching, setFetching]         = useState(false);
  const [expandedSection, setExpandedSection] = useState('stats');

  // Load player list
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('mv_player_selector_singles')
        .select('player_id,player_name,gender,rank,gender_label')
        .order('rank', { ascending: true });
      setAllPlayers(data || []);
      setLoading(false);
    })();
  }, []);

  // Fetch data for newly added players
  useEffect(() => {
    const missing = selectedIds.filter(id => !playerData[id]);
    if (missing.length === 0) return;

    setFetching(true);
    (async () => {
      for (const pid of missing) {
        try {
          const cutoff18m = new Date();
          cutoff18m.setMonth(cutoff18m.getMonth() - 18);
          const co = cutoff18m.toISOString().split('T')[0];

          const [
            { data: matches },
            { data: rankings },
            { data: events },
          ] = await Promise.all([
            supabase.from('wtt_matches_singles')
              .select('match_id,comp1_id,comp2_id,result,event_date,event_id,game_scores')
              .or(`comp1_id.eq.${pid},comp2_id.eq.${pid}`)
              .gte('event_date', co)
              .order('event_date', { ascending: false }).limit(500),
            supabase.from('rankings_singles_normalized')
              .select('rank,ranking_date,points')
              .eq('player_id', pid)
              .gte('ranking_date', co)
              .order('ranking_date', { ascending: false }).limit(100),
            supabase.from('wtt_events_graded')
              .select('event_id,event_name,event_tier,tops_grade'),
          ]);

          // Fetch opponent data
          const oppIds = [...new Set((matches || []).map(m =>
            parseInt(m.comp1_id) === pid ? parseInt(m.comp2_id) : parseInt(m.comp1_id)
          ))];

          const { data: opponents } = await supabase
            .from('wtt_players')
            .select('ittf_id,player_name,country_code,dob,handedness,grip')
            .in('ittf_id', oppIds);

          const cutoff18 = new Date();
          cutoff18.setMonth(cutoff18.getMonth() - 18);
          const { data: oppRanks } = await supabase
            .from('rankings_singles_normalized')
            .select('player_id,rank,ranking_date')
            .in('player_id', oppIds)
            .gte('ranking_date', cutoff18.toISOString().split('T')[0])
            .order('ranking_date', { ascending: false })
            .limit(50000);

          const oppRankMap = {};
          for (const r of (oppRanks || [])) {
            const key = parseInt(r.player_id);
            if (!oppRankMap[key]) oppRankMap[key] = [];
            oppRankMap[key].push(r);
          }

          const { data: profile } = await supabase
            .from('wtt_players')
            .select('dob,handedness,grip')
            .eq('ittf_id', pid)
            .single();

          setPlayerData(prev => ({
            ...prev,
            [pid]: { matches, rankings, events, opponents, oppRankMap, profile },
          }));
        } catch (e) {
          console.error(`Error fetching ${pid}:`, e);
        }
      }
      setFetching(false);
    })();
  }, [selectedIds]);

  const addPlayer = (pid) => {
    if (selectedIds.includes(pid) || selectedIds.length >= MAX_PLAYERS) return;
    setSelectedIds(prev => [...prev, pid]);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const removePlayer = (pid) => {
    setSelectedIds(prev => prev.filter(id => id !== pid));
  };

  const filteredSearch = allPlayers.filter(p =>
    !selectedIds.includes(p.player_id) &&
    p.player_name.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 8);

  // Build metrics for each selected player per window
  const playersWithMetrics = useMemo(() => {
    return selectedIds.map((pid, i) => {
      const info  = allPlayers.find(p => p.player_id === pid);
      const data  = playerData[pid];
      const color = PLAYER_COLORS[i];
      if (!data) return { pid, name: info?.player_name || '...', color, info, data: null, metrics: null, matches: [] };
      const metrics = buildPlayerMetrics(
        data.matches, data.rankings, data.events, data.opponents, data.oppRankMap, pid, windowMonths
      );
      return { pid, name: info?.player_name || '...', color, info, data, metrics, matches: data.matches || [] };
    });
  }, [selectedIds, playerData, windowMonths, allPlayers]);

  const hasData = playersWithMetrics.some(p => p.metrics);

  // ─── Stat rows config ──────────────────────────────────────────────────────
  const STAT_ROWS = [
    { label: 'World rank',        fmt: p => p.info?.rank ? `#${p.info.rank}` : '—', highlight: (vals) => vals.indexOf(Math.min(...vals.filter(v => v > 0))) },
    { label: 'Win rate',          fmt: p => p.metrics ? `${p.metrics.winRate.toFixed(1)}%` : '—', numFn: p => p.metrics?.winRate ?? -1, higher: true },
    { label: 'Matches',           fmt: p => p.metrics ? `${p.metrics.total}` : '—', numFn: p => p.metrics?.total ?? -1, higher: true },
    { label: 'Clutch index',      fmt: p => p.metrics?.clutchIndex != null ? `${p.metrics.clutchIndex.toFixed(1)}%` : '—', numFn: p => p.metrics?.clutchIndex ?? -1, higher: true },
    { label: 'Avg opp rank beaten', fmt: p => p.metrics?.avgOppRankBeaten ? `#${p.metrics.avgOppRankBeaten}` : '—', numFn: p => p.metrics?.avgOppRankBeaten ?? 9999, higher: false },
    { label: 'Upset yield',       fmt: p => p.metrics ? `${p.metrics.upsetYield.toFixed(1)}%` : '—', numFn: p => p.metrics?.upsetYield ?? -1, higher: true },
    { label: 'Straight sets wins',  fmt: p => p.metrics ? `${p.metrics.straightSetsWins}` : '—', numFn: p => p.metrics?.straightSetsWins ?? -1, higher: true },
    { label: 'Straight sets losses',fmt: p => p.metrics ? `${p.metrics.straightSetsLosses}` : '—', numFn: p => p.metrics?.straightSetsLosses ?? -1, higher: false },
    { label: 'Comeback wins',     fmt: p => p.metrics ? `${p.metrics.comebackWins}` : '—', numFn: p => p.metrics?.comebackWins ?? -1, higher: true },
    { label: 'Style',             fmt: p => p.data?.profile ? fmtStyle(p.data.profile.handedness, p.data.profile.grip) : '—' },
    { label: 'Age',               fmt: p => p.data?.profile?.dob ? `${calcAge(p.data.profile.dob)}` : '—' },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Sora, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Player dashboard
          </a>
          <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            TOPS · Compare
          </p>
        </div>

        {/* ── Player selector ── */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Select players (up to {MAX_PLAYERS})
          </p>

          {/* Selected player pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: selectedIds.length > 0 ? 10 : 0 }}>
            {playersWithMetrics.map((p, i) => (
              <div key={p.pid} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: `${PLAYER_COLORS[i]}15`, border: `1px solid ${PLAYER_COLORS[i]}40`,
                borderRadius: 99, padding: '4px 10px 4px 8px',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: PLAYER_COLORS[i] }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{p.name}</span>
                <button onClick={() => removePlayer(p.pid)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Search input */}
          {selectedIds.length < MAX_PLAYERS && (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', background: '#fafafa' }}>
                <Plus size={13} color="#94a3b8" />
                <input
                  placeholder="Add player…"
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  style={{ border: 'none', background: 'none', outline: 'none', fontSize: 13, flex: 1, color: '#1e293b' }}
                />
              </div>
              {showDropdown && searchTerm && filteredSearch.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: 'white', border: '1px solid #e2e8f0', borderRadius: 8,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginTop: 4, overflow: 'hidden',
                }}>
                  {filteredSearch.map(p => (
                    <button key={p.player_id} onClick={() => addPlayer(p.player_id)} style={{
                      width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
                      background: 'none', cursor: 'pointer', fontSize: 13, color: '#1e293b',
                      borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span>{p.player_name}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.gender_label} · #{p.rank}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Empty state ── */}
        {selectedIds.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>Add players to compare</p>
            <p style={{ fontSize: 13 }}>Select up to 5 players to see side-by-side stats, H2H records and rank trajectories</p>
          </div>
        )}

        {/* ── Loading ── */}
        {fetching && (
          <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 13 }}>
            Loading player data…
          </div>
        )}

        {/* ── Window toggle ── */}
        {hasData && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            {WINDOWS.map(w => (
              <button key={w.months} onClick={() => setWindowMonths(w.months)} style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
                border: '1px solid', cursor: 'pointer',
                borderColor: windowMonths === w.months ? '#1e293b' : '#e2e8f0',
                background: windowMonths === w.months ? '#1e293b' : 'white',
                color: windowMonths === w.months ? 'white' : '#64748b',
              }}>{w.label}</button>
            ))}
          </div>
        )}

        {/* ── Stats comparison table ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'stats' ? null : 'stats')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'stats' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stats comparison</span>
              {expandedSection === 'stats' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'stats' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 500, width: 160 }}>Metric</th>
                      {playersWithMetrics.map((p, i) => (
                        <th key={p.pid} style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: PLAYER_COLORS[i] }}>
                          {p.name.split(' ')[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {STAT_ROWS.map((row, ri) => {
                      // Find best value for highlighting
                      const numVals = row.numFn ? playersWithMetrics.map(p => row.numFn(p)) : null;
                      const bestVal = numVals ? (row.higher !== false ? Math.max(...numVals.filter(v => v >= 0)) : Math.min(...numVals.filter(v => v >= 0 && v < 9999))) : null;

                      return (
                        <tr key={ri} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '9px 16px', fontSize: 11, color: '#64748b', fontWeight: 500 }}>{row.label}</td>
                          {playersWithMetrics.map((p, i) => {
                            const val    = row.fmt(p);
                            const numVal = row.numFn ? row.numFn(p) : null;
                            const isBest = numVal != null && numVal === bestVal && numVal >= 0 && numVal < 9999 && playersWithMetrics.length > 1;
                            return (
                              <td key={p.pid} style={{ padding: '9px 14px', textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 13, fontWeight: isBest ? 700 : 500,
                                  color: isBest ? PLAYER_COLORS[i] : '#475569',
                                  background: isBest ? `${PLAYER_COLORS[i]}12` : 'none',
                                  padding: isBest ? '2px 8px' : 0,
                                  borderRadius: isBest ? 6 : 0,
                                }}>{val}</span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── H2H Matrix ── */}
        {hasData && playersWithMetrics.length >= 2 && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'h2h' ? null : 'h2h')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'h2h' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Head to head</span>
              {expandedSection === 'h2h' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'h2h' && (
              <div style={{ padding: '4px 0 8px' }}>
                <H2HMatrix playersData={playersWithMetrics} />
                <p style={{ fontSize: 10, color: '#94a3b8', padding: '8px 16px 4px' }}>
                  All-time records across all available match data
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Rank trajectory ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'rank' ? null : 'rank')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'rank' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rank trajectory</span>
              {expandedSection === 'rank' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'rank' && (
              <div style={{ padding: '16px' }}>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                  {playersWithMetrics.map((p, i) => (
                    <div key={p.pid} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 16, height: 2, background: PLAYER_COLORS[i], borderRadius: 1 }} />
                      <span style={{ fontSize: 11, color: '#64748b' }}>{p.name.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>
                <RankChart
                  playersData={playersWithMetrics.filter(p => p.data).map(p => ({
                    pid: p.pid, name: p.name, color: p.color, rankings: p.data?.rankings,
                  }))}
                  windowMonths={windowMonths}
                />
                <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>Lower = better rank</p>
              </div>
            )}
          </div>
        )}

        {/* ── W/L Breakdown ── */}
        {hasData && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <button onClick={() => setExpandedSection(s => s === 'wl' ? null : 'wl')} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: expandedSection === 'wl' ? '1px solid #f1f5f9' : 'none',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Win / Loss breakdown</span>
              {expandedSection === 'wl' ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
            </button>
            {expandedSection === 'wl' && (
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: `repeat(${Math.min(playersWithMetrics.length, 3)}, 1fr)`, gap: 20 }}>
                {playersWithMetrics.map((p, i) => (
                  <div key={p.pid}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: PLAYER_COLORS[i], marginBottom: 10 }}>
                      {p.name.split(' ')[0]}
                    </p>
                    <WLBreakdown metrics={p.metrics} color={PLAYER_COLORS[i]} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
