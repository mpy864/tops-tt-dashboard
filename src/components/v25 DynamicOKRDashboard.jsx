import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  ChevronDown, ChevronUp, Search, Star, Zap, Activity, ArrowRight
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
    if (a === 0 && b === 0) continue; // skip unplayed sets
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

function cleanCompetitionName(name) {
  if (!name) return 'Unknown competition';
  const match = name.match(/^(.*?\d{4})/);
  return match ? match[1].trim() : name;
}

function cleanRound(round) {
  if (!round || round === 'N/A') return null;
  const rofMatch = round.match(/Round of \d+/i);
  if (rofMatch) return rofMatch[0];
  const common = ['Final', 'Semi-Final', 'Quarter-Final', 'Group Stage', 'Qualifying'];
  for (const r of common) {
    if (round.toLowerCase().includes(r.toLowerCase())) return r;
  }
  const parts = round.split(' - ');
  return parts.length > 1 ? parts[parts.length - 2] || null : null;
}

function parseDisplayGames(str, isComp1) {
  if (!str || str === 'N/A') return [];
  return str.split(',').map(s => s.trim()).filter(g => {
    const [a, b] = g.split('-').map(Number);
    return !isNaN(a) && !isNaN(b) && !(a === 0 && b === 0);
  }).map(g => {
    const [a, b] = g.split('-').map(Number);
    const pScore = isComp1 ? a : b;
    const oScore = isComp1 ? b : a;
    return { pScore, oScore, pWon: pScore > oScore };
  });
}

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
  if (!handedness && !grip) return null;
  const parts = [];
  if (handedness) parts.push(handedness.replace(' Hand', ''));
  if (grip) parts.push(grip);
  return parts.join(' · ');
}

function getInitials(name) {
  if (!name || name === 'Unknown') return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const Q_START = new Set([1, 4, 7, 10]);
const Q_LABEL = { 1: 'Jan', 4: 'Apr', 7: 'Jul', 10: 'Oct' };

function buildRankChartData(rankingHistory, windowMonths) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const sorted = [...rankingHistory]
    .filter(r => new Date(r.ranking_date) >= cutoff)
    .sort((a, b) => new Date(a.ranking_date) - new Date(b.ranking_date));
  if (!sorted.length) return { data: [], ticks: [] };

  // Every point gets a numeric timestamp — Recharts maps cursor correctly
  const data = sorted.map(r => {
    const d = new Date(r.ranking_date);
    return {
      x: d.getTime(),
      fullDate: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      rank: r.rank,
    };
  });

  // Compute which timestamps should get x-axis labels
  const ticks = [];
  const seen = new Set();
  for (const pt of data) {
    const d = new Date(pt.x);
    const mo = d.getMonth() + 1;
    const key = `${d.getFullYear()}-${mo}`;
    if (windowMonths === 6) {
      // Label every month
      if (!seen.has(key)) { seen.add(key); ticks.push(pt.x); }
    } else {
      // Label quarter-start months only (Jan/Apr/Jul/Oct)
      if (Q_START.has(mo) && !seen.has(key)) { seen.add(key); ticks.push(pt.x); }
    }
  }

  return { data, ticks };
}

function CustomXTick({ x, y, payload }) {
  if (!payload?.value) return null;
  return <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill="#94a3b8">{payload.value}</text>;
}

// ─── Window computation ────────────────────────────────────────────────────────

function computeWindowData(matchLedger, rankingHistory, windowMonths, playerCurrentRank) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const filtered = matchLedger.filter(m => m.rawDate >= cutoff);
  const wins     = filtered.filter(m => m.result === 'W');
  const losses   = filtered.filter(m => m.result === 'L');
  const total    = filtered.length;

  const winRate     = total > 0 ? (wins.length / total) * 100 : 0;
  const upsetYield  = wins.length > 0 ? (wins.filter(m => m.isUpset).length / wins.length) * 100 : 0;
  const clutchIndex = wins.length > 0 ? (wins.filter(m => m.isClutch).length / wins.length) * 100 : 0;

  let td = 0, dc = 0;
  for (const m of filtered) { if (m.pointDiff != null) { td += m.pointDiff; dc++; } }
  const avgPtDiff = dc > 0 ? td / dc : 0;

  const rankAtStart = rankingHistory.find(r => new Date(r.ranking_date) <= cutoff)?.rank;
  const rankChange  = rankAtStart ? rankAtStart - playerCurrentRank : 0;

  const beaten = wins.filter(m => m.opponentRank < 999).map(m => m.opponentRank);
  const avgOppRankBeaten = beaten.length > 0
    ? Math.round(beaten.reduce((s, v) => s + v, 0) / beaten.length) : null;

  const straightSetsWins   = wins.filter(m => m.isStraightWin).length;
  const straightSetsLosses = losses.filter(m => m.isStraightLoss).length;
  const comebackWins       = wins.filter(m => m.isComeback).length;

  const rankBuckets = [
    { label: 'Top 20',      min: 0,   max: 20   },
    { label: 'Rank 21–50',  min: 21,  max: 50   },
    { label: 'Rank 51–100', min: 51,  max: 100  },
    { label: 'Rank 100+',   min: 101, max: 9999 },
  ].map(b => {
    const bm = filtered.filter(m => m.opponentRank >= b.min && m.opponentRank <= b.max);
    const bw = bm.filter(m => m.result === 'W').length;
    const bl = bm.filter(m => m.result === 'L').length;
    const bt = bw + bl;
    return { ...b, wins: bw, losses: bl, total: bt,
      winPct: bt > 0 ? (bw / bt) * 100 : 0, matches: bm };
  });

  const tierMap = {};
  for (const m of filtered) {
    const t = m.eventTier != null ? String(m.eventTier) : 'Unknown';
    if (!tierMap[t]) tierMap[t] = { wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') tierMap[t].wins++; else tierMap[t].losses++;
    tierMap[t].matches.push(m);
  }
  const tierBuckets = Object.entries(tierMap).map(([tier, t]) => {
    const bt = t.wins + t.losses;
    return { label: tier === 'Unknown' ? 'Unclassified' : `Grade ${tier}`, tier,
      wins: t.wins, losses: t.losses, total: bt,
      winPct: bt > 0 ? (t.wins / bt) * 100 : 0, matches: t.matches };
  }).sort((a, b) => a.tier === 'Unknown' ? 1 : b.tier === 'Unknown' ? -1 : parseInt(a.tier) - parseInt(b.tier));

  const cmap = {};
  for (const m of filtered) {
    if (!cmap[m.opponent]) cmap[m.opponent] = { name: m.opponent, wins: 0, losses: 0, currentRank: m.opponentCurrentRank, matches: [] };
    if (m.result === 'W') cmap[m.opponent].wins++; else cmap[m.opponent].losses++;
    cmap[m.opponent].matches.push(m);
  }
  const topCompetitors = Object.values(cmap)
    .map(c => { const bt = c.wins + c.losses; return { ...c, total: bt, winPct: bt > 0 ? (c.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total).slice(0, 5);

  const nmap = {};
  for (const m of filtered) {
    const cc = m.opponentCountry; if (!cc) continue;
    if (!nmap[cc]) nmap[cc] = { country: cc, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') nmap[cc].wins++; else nmap[cc].losses++;
    nmap[cc].matches.push(m);
  }
  const topNations = Object.values(nmap)
    .map(n => { const bt = n.wins + n.losses; return { ...n, total: bt, winPct: bt > 0 ? (n.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total).slice(0, 8);

  // By playing style (handedness)
  const stylemap = {};
  for (const m of filtered) {
    const hand = m.opponentHandedness || 'Unknown';
    const grip = m.opponentGrip || 'Unknown';
    const key = hand === 'Unknown' && grip === 'Unknown' ? 'Unknown'
      : [hand.replace(' Hand',''), grip].filter(s => s && s !== 'Unknown').join(' · ') || 'Unknown';
    if (!stylemap[key]) stylemap[key] = { style: key, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') stylemap[key].wins++; else stylemap[key].losses++;
    stylemap[key].matches.push(m);
  }
  const styleGroups = Object.values(stylemap)
    .map(s => { const bt = s.wins + s.losses; return { ...s, total: bt, winPct: bt > 0 ? (s.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total);

  // By grip only
  const gripmap = {};
  for (const m of filtered) {
    const grip = m.opponentGrip || 'Unknown';
    if (!gripmap[grip]) gripmap[grip] = { grip, wins: 0, losses: 0, matches: [] };
    if (m.result === 'W') gripmap[grip].wins++; else gripmap[grip].losses++;
    gripmap[grip].matches.push(m);
  }
  const gripGroups = Object.values(gripmap)
    .map(g => { const bt = g.wins + g.losses; return { ...g, total: bt, winPct: bt > 0 ? (g.wins / bt) * 100 : 0 }; })
    .sort((a, b) => b.total - a.total);

  return {
    winRate, upsetYield, clutchIndex, avgPtDiff, rankChange,
    matchCount: total, wins: wins.length, losses: losses.length,
    straightSetsWins, straightSetsLosses, comebackWins, avgOppRankBeaten,
    rankBuckets, tierBuckets, topCompetitors, topNations, styleGroups, gripGroups,
    dnaGroups: {
      straightWins:   wins.filter(m => m.isStraightWin),
      straightLosses: losses.filter(m => m.isStraightLoss),
      comebacks:      wins.filter(m => m.isComeback),
      clutch:         wins.filter(m => m.isClutch),
    },
    allMatches: filtered,
  };
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

function computeVerdict(w) {
  if (w.matchCount < 5) return { text: 'Insufficient data', tone: 'gray' };
  const up = w.rankChange > 0, strong = w.winRate >= 50;
  if (up && strong)   return { text: `Ascending — up ${w.rankChange} places`,                    tone: 'green' };
  if (!up && !strong) return { text: 'Declining — rank and win rate both falling',                tone: 'red'   };
  if (up && !strong)  return { text: `Quietly rising — rank up ${w.rankChange} on quality wins`, tone: 'blue'  };
  return                     { text: 'Plateau — results stable, no ranking movement',            tone: 'amber' };
}

const TONE = {
  green: { text: 'text-emerald-700', bg: 'bg-emerald-50',  dot: '#10b981' },
  red:   { text: 'text-red-600',     bg: 'bg-red-50',      dot: '#ef4444' },
  blue:  { text: 'text-sky-700',     bg: 'bg-sky-50',      dot: '#3b82f6' },
  amber: { text: 'text-amber-700',   bg: 'bg-amber-50',    dot: '#f59e0b' },
  gray:  { text: 'text-slate-500',   bg: 'bg-slate-100',   dot: '#94a3b8' },
};

// ─── MatchRow — HTML table, 28% / 40% / 32%, table-layout: fixed ─────────────
// Row 1 (collapsed): Name | Competition | Score pill + chevron
// Row 2a (expanded): rank·nation | round·date | flags
// Row 2b (expanded): colspan=3, set scores right-aligned

const TR_STYLE = { cursor: 'pointer' };

function MatchRow({ match: m }) {
  const [open, setOpen] = useState(false);
  const isWin     = m.result === 'W';
  const scoreStr  = `${m.gamesWon}-${m.gamesLost}`;
  const comp      = cleanCompetitionName(m.tournament);
  const round     = cleanRound(m.round);
  const games     = parseDisplayGames(m.score, m.isComp1);
  const isUnknown = !m.opponent || m.opponent === 'Unknown';
  const hasDetail = !isUnknown;

  const row1Bg = open
    ? { backgroundColor: 'rgba(239,246,255,0.6)' }
    : {};
  const row2Bg = { backgroundColor: 'var(--row2-bg, #f8fafc)' };

  return (
    <>
      {/* ── Row 1: collapsed ── */}
      <tr
        onClick={() => hasDetail && setOpen(o => !o)}
        style={{ ...TR_STYLE, borderBottom: open ? 'none' : undefined, ...row1Bg }}
        className={`border-b border-slate-100 ${hasDetail ? 'hover:bg-blue-50/20' : ''} transition-colors`}>

        {/* Col 1 — name */}
        <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
          <span style={{
            fontSize: 13, fontWeight: 500,
            color: isUnknown ? '#94a3b8' : 'var(--color-text-primary)',
            fontStyle: isUnknown ? 'italic' : 'normal',
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isUnknown ? 'Opponent data unavailable' : m.opponent}
          </span>
        </td>

        {/* Col 2 — competition (centred) */}
        <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'center' }}>
          <span style={{
            fontSize: 12, color: 'var(--color-text-secondary)',
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {isUnknown ? '—' : comp}
          </span>
        </td>

        {/* Col 3 — score pill + flags + chevron (right) */}
        <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {m.isUpset    && <Star size={10} style={{ color: '#10b981' }} />}
            {m.isClutch   && <Zap  size={10} style={{ color: '#f59e0b' }} />}
            {m.isComeback && <span style={{ fontSize: 9, color: '#0ea5e9', fontWeight: 700 }}>↩</span>}
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: '2px 8px', borderRadius: 99, minWidth: 34, textAlign: 'center',
              background: isWin ? '#d1fae5' : '#fee2e2',
              color: isWin ? '#065f46' : '#991b1b',
            }}>
              {scoreStr}
            </span>
            {hasDetail && (
              open
                ? <ChevronUp size={11} style={{ color: '#94a3b8' }} />
                : <ChevronDown size={11} style={{ color: '#94a3b8' }} />
            )}
            {!hasDetail && <span style={{ display: 'inline-block', width: 11 }} />}
          </span>
        </td>
      </tr>

      {/* ── Row 2a: meta (rank·nation | round·date | flags) ── */}
      {open && (
        <tr style={row2Bg} className="border-b-0">
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {m.opponentRank !== 999 && `#${m.opponentRank}`}
              {m.opponentRank !== 999 && m.opponentCountry && ' · '}
              {m.opponentCountry && m.opponentCountry.toUpperCase()}
            </span>
          </td>
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle', textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {round && `${round} · `}{fmtMonthYear(m.rawDate)}
            </span>
          </td>
          <td style={{ padding: '5px 14px 2px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-flex', gap: 6, fontSize: 10, fontWeight: 600 }}>
              {m.isUpset    && <span style={{ color: '#059669', display:'flex', alignItems:'center', gap:2 }}><Star size={9} />Upset</span>}
              {m.isClutch   && <span style={{ color: '#b45309', display:'flex', alignItems:'center', gap:2 }}><Zap size={9} />Clutch</span>}
              {m.isComeback && <span style={{ color: '#0284c7' }}>↩ Comeback</span>}
            </span>
          </td>
        </tr>
      )}

      {open && (
        <tr style={{ ...row2Bg, borderBottom: '0.5px solid #f1f5f9' }}>
          <td colSpan={3} style={{ padding: '3px 14px 10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              {/* Opponent age + style — left */}
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {[
                  calcAge(m.opponentDob) ? `Age ${calcAge(m.opponentDob)}` : null,
                  fmtStyle(m.opponentHandedness, m.opponentGrip),
                ].filter(Boolean).join(' · ')}
              </span>
              {/* Game scores — right */}
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {games.length > 0
                  ? games.map((g, i) => (
                    <span key={i} style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                      background: g.pWon ? '#d1fae5' : '#fee2e2',
                      color: g.pWon ? '#065f46' : '#991b1b',
                    }}>
                      {g.pScore}–{g.oScore}
                    </span>
                  ))
                  : <span style={{ fontSize: 11, color: '#cbd5e1' }}>No score data</span>
                }
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// MatchList — wraps rows in a shared table with fixed 28/40/32 columns
function MatchList({ matches }) {
  if (!matches?.length)
    return <p className="text-xs text-slate-400 px-4 py-3">No matches in this window.</p>;
  return (
    <table style={{
      width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse',
    }}>
      <colgroup>
        <col style={{ width: '28%' }} />
        <col style={{ width: '40%' }} />
        <col style={{ width: '32%' }} />
      </colgroup>
      <tbody>
        {matches.map((m, i) => <MatchRow key={i} match={m} />)}
      </tbody>
    </table>
  );
}

// ─── WLBarRows — table-row fragments sharing 28/40/32 colgroup ───────────────

function WLBarRows({ label, wins, losses, winPct, isOpen, onToggle, children }) {
  const total = wins + losses;
  const HL = isOpen ? { backgroundColor: 'rgba(239,246,255,0.5)' } : {};
  return (
    <>
      <tr onClick={() => total > 0 && onToggle()}
        style={{ cursor: total > 0 ? 'pointer' : 'default', borderBottom: '0.5px solid #f1f5f9', ...HL }}
        className="transition-colors hover:bg-slate-50/60">
        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {label}
        </td>
        <td style={{ padding: '10px 14px' }} />
        <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {total > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#059669' }}>{wins}W</span>
                <span style={{ color: '#94a3b8' }}> / </span>
                <span style={{ fontWeight: 600, color: '#f87171' }}>{losses}L</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 36, textAlign: 'right',
                color: winPct >= 50 ? '#059669' : '#f87171' }}>
                {winPct.toFixed(0)}%
              </span>
              {isOpen ? <ChevronUp size={13} style={{ color: '#94a3b8' }} /> : <ChevronDown size={13} style={{ color: '#94a3b8' }} />}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>No matches</span>
          )}
        </td>
      </tr>
      {total > 0 && (
        <tr style={{ borderBottom: isOpen ? 'none' : '0.5px solid #f1f5f9', ...HL }}>
          <td colSpan={3} style={{ padding: '0 14px 8px' }}>
            <div style={{ height: 6, borderRadius: 99, background: '#f1f5f9', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${winPct}%`, background: '#34d399', transition: 'width 0.5s' }} />
              <div style={{ width: `${100 - winPct}%`, background: '#fca5a5', transition: 'width 0.5s' }} />
            </div>
          </td>
        </tr>
      )}
      {isOpen && children}
    </>
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

// ─── Main Component ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'rank',        label: 'Rank'        },
  { id: 'winloss',     label: 'Win/Loss'    },
  { id: 'performance', label: 'Performance' },
  { id: 'form',        label: 'Form'        },
  { id: 'domestic',    label: 'Domestic'    },
];

// ─── DomesticTab Component ─────────────────────────────────────────────────────
// Drop this function into DynamicOKRDashboard.jsx before the main component export.
// Props:
//   matches     — array from ttfi_domestic_matches
//   playerWttId — selected player's ittf_id as string

const ROUND_ORDER = { 'FINAL': 0, 'SF': 1, 'QF': 2, 'R/16': 3, 'R/32': 4, 'R/64': 5, 'R/128': 6, 'R/256': 7 };

function formatScore(match, playerWttId) {
  if (!match.score_raw) return '—';
  const isP1 = match.wtt_player1_id === playerWttId;
  const sets  = isP1
    ? `${match.p1_sets}–${match.p2_sets}`
    : `${match.p2_sets}–${match.p1_sets}`;
  if (!match.game_scores?.length) return sets;
  const games = match.game_scores.map(([w, l]) =>
    isP1 ? `${w}-${l}` : `${l}-${w}`
  ).join(', ');
  return `${sets}  (${games})`;
}

function DomesticTab({ matches, playerWttId }) {
  const [seasonFilter, setSeasonFilter] = React.useState('all');
  const [eventFilter,  setEventFilter]  = React.useState('all');

  if (!matches || matches.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">
        No domestic match data available for this player.
      </div>
    );
  }

  // Derived filters
  const seasons = ['all', ...new Set(matches.map(m => m.season))];
  const events  = ['all', ...new Set(matches.map(m => m.event_name))];

  const filtered = matches.filter(m =>
    (seasonFilter === 'all' || m.season === seasonFilter) &&
    (eventFilter  === 'all' || m.event_name === eventFilter)
  );

  // Summary stats
  const wins   = filtered.filter(m => m.winner_name === (m.wtt_player1_id === playerWttId ? m.player1_name : m.player2_name));
  const losses = filtered.length - wins.length;
  const winPct = filtered.length > 0 ? Math.round(wins.length * 100 / filtered.length) : 0;

  // Group by tournament (slug + season)
  const tournamentGroups = {};
  for (const m of filtered) {
    const key = `${m.season}__${m.slug}`;
    if (!tournamentGroups[key]) {
      tournamentGroups[key] = {
        season:    m.season,
        slug:      m.slug,
        matches:   [],
        deepest:   null,
      };
    }
    tournamentGroups[key].matches.push(m);
    const rOrder = ROUND_ORDER[m.round] ?? 99;
    if (tournamentGroups[key].deepest === null || rOrder < (ROUND_ORDER[tournamentGroups[key].deepest] ?? 99)) {
      tournamentGroups[key].deepest = m.round;
    }
  }
  const tournaments = Object.values(tournamentGroups)
    .sort((a, b) => b.season.localeCompare(a.season));

  const labelStyle = {
    fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em'
  };

  return (
    <div className="slide">
      {/* Summary bar */}
      <div className="flex items-center gap-6 px-5 py-4 border-b border-slate-100 flex-wrap">
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-800">{filtered.length}</div>
          <div style={labelStyle}>Matches</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-emerald-600">{wins.length}</div>
          <div style={labelStyle}>Wins</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-500">{losses}</div>
          <div style={labelStyle}>Losses</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-800">{winPct}%</div>
          <div style={labelStyle}>Win Rate</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-800">{tournaments.length}</div>
          <div style={labelStyle}>Tournaments</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 px-5 py-3 border-b border-slate-100 flex-wrap">
        <select
          value={seasonFilter}
          onChange={e => setSeasonFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white">
          {seasons.map(s => <option key={s} value={s}>{s === 'all' ? 'All seasons' : s}</option>)}
        </select>
        <select
          value={eventFilter}
          onChange={e => setEventFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white">
          {events.map(e => <option key={e} value={e}>{e === 'all' ? 'All events' : e}</option>)}
        </select>
      </div>

      {/* Tournament cards */}
      <div className="divide-y divide-slate-100">
        {tournaments.map(t => {
          const tWins   = t.matches.filter(m => m.winner_name === (m.wtt_player1_id === playerWttId ? m.player1_name : m.player2_name));
          const tLosses = t.matches.length - tWins.length;
          const tournamentName = t.slug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .replace(/\d{4}$/, '')
            .replace(/Utt /i, '')
            .trim();

          return (
            <details key={`${t.season}__${t.slug}`} className="group">
              <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-slate-50 list-none">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{tournamentName}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{t.season}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Deepest round badge */}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    t.deepest === 'FINAL'   ? 'bg-amber-100 text-amber-700' :
                    t.deepest === 'SF'      ? 'bg-violet-100 text-violet-700' :
                    t.deepest === 'QF'      ? 'bg-sky-100 text-sky-700' :
                    t.deepest === 'R/16'    ? 'bg-emerald-100 text-emerald-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {t.deepest}
                  </span>
                  <span className="text-xs text-slate-500">{tWins.length}W {tLosses}L</span>
                  <ChevronDown size={13} className="text-slate-400 group-open:rotate-180 transition-transform" />
                </div>
              </summary>

              {/* Match rows within tournament */}
              <div className="bg-slate-50 border-t border-slate-100">
                <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                  <colgroup>
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '28%' }} />
                  </colgroup>
                  <tbody>
                    {t.matches
                      .sort((a, b) => (ROUND_ORDER[a.round] ?? 99) - (ROUND_ORDER[b.round] ?? 99))
                      .map((m, i) => {
                        const isP1  = m.wtt_player1_id === playerWttId;
                        const me    = isP1 ? m.player1_name : m.player2_name;
                        const opp   = isP1 ? m.player2_name : m.player1_name;
                        const isWin = m.winner_name === me;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '8px 8px 8px 20px' }}>
                              <span style={{
                                fontSize: 10, fontWeight: 700,
                                padding: '2px 6px', borderRadius: 4,
                                background: isWin ? '#d1fae5' : '#fee2e2',
                                color: isWin ? '#065f46' : '#991b1b',
                              }}>{m.round}</span>
                            </td>
                            <td style={{ padding: '8px 4px', fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              vs {opp}
                            </td>
                            <td style={{ padding: '8px 4px', fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.event_name}
                            </td>
                            <td style={{ padding: '8px 20px 8px 4px', fontSize: 11, color: '#64748b', textAlign: 'right' }}>
                              {formatScore(m, playerWttId)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export default function DynamicOKRDashboard() {
  const [players, setPlayers]               = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerMetrics, setPlayerMetrics]   = useState(null);
  const [playerName, setPlayerName]         = useState('');
  const [playerProfile, setPlayerProfile]   = useState(null);
  const [loading, setLoading]               = useState(true);
  const [fetching, setFetching]             = useState(false);
  const [error, setError]                   = useState(null);
  const [searchTerm, setSearchTerm]         = useState('');
  const [filteredPlayers, setFilteredPlayers] = useState([]);

  // Active tab — Rank is default
  const [activeTab, setActiveTab] = useState('rank');
  const [domesticMatches, setDomesticMatches] = useState([]);
  // Per-tab time windows
  const [rankWindow, setRankWindow] = useState('6M');
  const [winWindow,  setWinWindow]  = useState('6M');
  const [dnaWindow,  setDnaWindow]  = useState('6M');

  // Win/Loss accordion
  const [wlFilter,      setWlFilter]      = useState('rank');
  const [openRankBar,   setOpenRankBar]   = useState(null);
  const [openTierBar,   setOpenTierBar]   = useState(null);
  const [openCompBar,   setOpenCompBar]   = useState(null);
  const [openNationBar, setOpenNationBar] = useState(null);

  // Performance accordion
  const [openDna, setOpenDna] = useState(null);

  // Form
  const [formShowAll,  setFormShowAll]  = useState(false);

  const tabContentRef = useRef(null);

  const switchTab = (id) => {
    setActiveTab(id);
    setTimeout(() => tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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
        if (data?.length > 0) {
          setSelectedPlayer(data[0].player_id);
          setPlayerName(data[0].player_name);
        }
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  // Fetch on player change
  useEffect(() => {
    if (!selectedPlayer) return;
    (async () => {
      setFetching(true); setError(null);
      setOpenRankBar(null); setOpenTierBar(null);
      setOpenCompBar(null); setOpenNationBar(null);
      setOpenDna(null); setFormShowAll(false);
      setPlayerProfile(null);
      try {
        const [
          { data: matches,    error: e1 },
          { data: rankings,   error: e2 },
          { data: events,     error: e3 },
        ] = await Promise.all([
          supabase.from('wtt_matches_singles')
            .select('match_id,comp1_id,comp2_id,result,event_date,event_id,round_phase,game_scores')
            .or(`comp1_id.eq.${selectedPlayer},comp2_id.eq.${selectedPlayer}`)
            .order('event_date', { ascending: false }).limit(500),
          supabase.from('rankings_singles_normalized')
            .select('rank,ranking_date,points').eq('player_id', selectedPlayer)
            .order('ranking_date', { ascending: false }).limit(200),
          supabase.from('wtt_events_graded').select('event_id,event_name,event_tier,tops_grade'),
        ]);
        if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;

        const pid = parseInt(selectedPlayer);
        const oppIds = [...new Set(
          (matches || []).map(m =>
            parseInt(m.comp1_id) === pid ? parseInt(m.comp2_id) : parseInt(m.comp1_id)
          )
        )];

        // Fetch only the opponent players needed — avoids bulk 3000-row fetch
        const { data: allPlayers, error: e4 } = await supabase
          .from('wtt_players')
          .select('ittf_id,player_name,country_code,dob,handedness,grip')
          .in('ittf_id', oppIds);
        if (e4) throw e4;

        // Fetch selected player's own profile
        const { data: profileData } = await supabase
          .from('wtt_players')
          .select('dob,handedness,grip')
          .eq('ittf_id', selectedPlayer)
          .single();
        setPlayerProfile(profileData || null);
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18);
        const { data: oppRanks, error: e5 } = await supabase
          .from('rankings_singles_normalized')
          .select('player_id,rank,ranking_date')
          .in('player_id', oppIds)
          .gte('ranking_date', cutoffDate.toISOString().split('T')[0])
          .order('ranking_date', { ascending: false })
          .limit(50000);
        if (e5) throw e5;

        const oppRankMap = {};
        for (const r of (oppRanks || [])) {
          const key = parseInt(r.player_id);
          if (!oppRankMap[key]) oppRankMap[key] = [];
          oppRankMap[key].push(r);
        }
// Fetch domestic matches
        const { data: domMatches } = await supabase
          .from('ttfi_domestic_matches')
          .select('season,slug,event_name,round,player1_name,player2_name,winner_name,score_raw,p1_sets,p2_sets,game_scores,match_datetime,wtt_player1_id,wtt_player2_id')
          .or(`wtt_player1_id.eq.${selectedPlayer},wtt_player2_id.eq.${selectedPlayer}`)
          .not('round', 'in', '("R/256","R/128")')
          .order('season', { ascending: false });
        setDomesticMatches(domMatches || []);

        setPlayerMetrics(buildMetrics(matches, rankings, events, allPlayers, oppRankMap, selectedPlayer));
            
      } catch (err) { setError(err.message); }
      finally { setFetching(false); }
    })();
  }, [selectedPlayer]);

  function buildMetrics(matches, rankings, events, allPlayers, oppRankMap, playerId) {
    const pid = parseInt(playerId);
    const playerCurrentRank = rankings?.[0]?.rank || 999;
    const matchLedger = (matches || []).map(m => {
      const isComp1 = parseInt(m.comp1_id) === pid;
      const won     = isComp1 ? m.result === 'W' : m.result === 'L';
      const oppId   = parseInt(isComp1 ? m.comp2_id : m.comp1_id);
      const oppP    = allPlayers?.find(p => parseInt(p.ittf_id) === oppId);
      const oppH    = oppRankMap[oppId] || [];
      const matchDate = new Date(m.event_date);
      const opponentRank        = oppH.find(r => new Date(r.ranking_date) <= matchDate)?.rank ?? 999;
      const opponentCurrentRank = oppH[0]?.rank ?? 999;
      const { gamesWon, gamesLost, pointsWon, pointsLost, totalGames } =
        parseScoresForPlayer(m.game_scores, isComp1);
      const pointDiff = totalGames > 0 ? (pointsWon - pointsLost) / totalGames : null;
      return {
        rawDate: matchDate,
        opponent: oppP?.player_name || 'Unknown',
        opponentCountry: oppP?.country_code || null,
        opponentDob: oppP?.dob || null,
        opponentHandedness: oppP?.handedness || null,
        opponentGrip: oppP?.grip || null,
        opponentRank, opponentCurrentRank,
        tournament: events?.find(e => e.event_id === m.event_id)?.event_name || 'Unknown',
        eventTier: events?.find(e => e.event_id === m.event_id)?.tops_grade ?? null,
        round: m.round_phase || 'N/A',
        score: m.game_scores || 'N/A',
        result: won ? 'W' : 'L',
        isComp1,
        isUpset:       won && opponentRank < playerCurrentRank,
        isClutch:      won && gamesLost === gamesWon - 1,
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

  const w6  = playerMetrics?.windows['6M'];
  const win = playerMetrics?.windows[winWindow];
  const dna = playerMetrics?.windows[dnaWindow];
  const rankWindowData = playerMetrics?.windows[rankWindow];

  const verdict = useMemo(() => w6 ? computeVerdict(w6) : null, [w6]);

  const rankChartData = useMemo(() => {
    if (!playerMetrics?.rankingHistory) return { data: [], ticks: [] };
    return buildRankChartData(playerMetrics.rankingHistory, parseInt(rankWindow));
  }, [playerMetrics, rankWindow]);

  const chartRanks = rankChartData.data.map(d => d.rank).filter(Boolean);
  const peakRank   = chartRanks.length ? Math.min(...chartRanks) : null;
  const startRank  = rankWindowData && playerMetrics
    ? playerMetrics.ranking + rankWindowData.rankChange : null;

  const domesticLedger = useMemo(() => {
    if (!domesticMatches?.length) return [];
    const pid = String(selectedPlayer);

    const roundMap = {
      'FINAL': 'Final', 'SF': 'Semi-Final', 'QF': 'Quarter-Final',
      'R/16': 'Round of 16', 'R/32': 'Round of 32',
      'R/64': 'Round of 64', 'R/128': 'Round of 128',
    };

    return domesticMatches
      .filter(m => m.score_raw)
      .map(m => {
        const isP1 = m.wtt_player1_id === pid;
        const me   = isP1 ? m.player1_name : m.player2_name;
        const opp  = isP1 ? m.player2_name : m.player1_name;
        const won  = m.winner_name === me;

        let gamesWon = 0, gamesLost = 0, scoreStr = '';
        if (m.game_scores?.length) {
          const gameParts = m.game_scores.map(([ws, ls]) => {
            const [pScore, oScore] = won ? [ws, ls] : [ls, ws];
            if (pScore > oScore) gamesWon++; else gamesLost++;
            return `${pScore}-${oScore}`;
          });
          scoreStr = gameParts.join(',');
        } else {
          const [pSets, oSets] = won
            ? [m.p1_sets ?? 0, m.p2_sets ?? 0]
            : [m.p2_sets ?? 0, m.p1_sets ?? 0];
          gamesWon = pSets; gamesLost = oSets;
        }

        let rawDate = new Date(0);
        if (m.match_datetime) {
          try {
            const dayMon = m.match_datetime.split(',')[0].trim();
            const baseYear = parseInt(m.season?.split('-')[0] || '2024');
            const monthStr = dayMon.split('-')[1];
            const earlyMonths = ['Jan','Feb','Mar'];
            const year = earlyMonths.includes(monthStr) ? baseYear + 1 : baseYear;
            rawDate = new Date(`${dayMon}-${year}`);
          } catch(e) {}
        }

        const tournament = decodeURIComponent(m.slug)
          .replace(/-+/g, ' ')
          .replace(/utt /gi, '')
          .replace(/\b\w/g, c => c.toUpperCase())
          .trim()
          .substring(0, 45);

        return {
          rawDate,
          result:              won ? 'W' : 'L',
          won,
          opponent:            opp,
          opponentRank:        999,
          opponentCurrentRank: 999,
          opponentCountry:     'IND',
          tournament,
          topsGrade:           6,
          round:               roundMap[m.round] || m.round,
          score:               scoreStr,
          isComp1:             true,
          gamesWon,
          gamesLost,
          isUpset:             false,
          isClutch:            false,
          isComeback:          false,
          opponentDob:         null,
          opponentHandedness:  null,
          opponentGrip:        null,
          isDomestic:          true,
        };
      });
  }, [domesticMatches, selectedPlayer]);

  const recentAll = useMemo(() => {
    const wtt = playerMetrics?.matchLedger || [];
    return [...wtt, ...domesticLedger]
      .sort((a, b) => b.rawDate - a.rawDate)
      .slice(0, 20);
  }, [playerMetrics, domesticLedger]);

  const recentDisplay = formShowAll ? recentAll : recentAll.slice(0, 5);

  const handleSearch = v => {
    setSearchTerm(v);
    setFilteredPlayers(!v.trim() ? players
      : players.filter(p => p.player_name.toLowerCase().includes(v.toLowerCase())));
  };

  const WL_FILTERS = [
    { id: 'rank',       label: 'By opponent rank' },
    { id: 'tier',       label: 'By event tier'    },
    { id: 'competitor', label: 'Top opponents'    },
    { id: 'nation',     label: 'By nation'        },
    { id: 'style',      label: 'By style'         },
    { id: 'grip',       label: 'By grip'          },
  ];

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-2 text-slate-400">
        <Activity size={16} className="animate-pulse" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap');
        .okr * { font-family: 'Sora', sans-serif; }
        .slide { animation: sl 0.15s ease-out; }
        @keyframes sl { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div className="okr min-h-screen bg-slate-50">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

          {/* ── Header ── */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">TOPS · Table Tennis</p>
            <a href="/h2h" className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
              Compare players <ArrowRight size={11} />
            </a>
          </div>

          {/* ── Selector ── */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="text" placeholder="Search player…" value={searchTerm}
                onChange={e => handleSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
            </div>
            <select value={selectedPlayer || ''}
              onChange={e => {
                const id = parseInt(e.target.value);
                const p  = players.find(p => p.player_id === id);
                setSelectedPlayer(id);
                if (p) setPlayerName(p.player_name);
                setActiveTab('rank');
              }}
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

          {selectedPlayer && playerMetrics && w6 && (
            <>
              {/* ═══ VERDICT LINE ═══ */}
              {verdict && (() => {
                const t = TONE[verdict.tone];
                return (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl ${t.bg}`}>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: t.dot }} />
                    <p className={`text-sm font-medium ${t.text}`}>
                      <span className="font-semibold">{playerName}</span>
                      <span className="font-normal"> · World </span>
                      <span className="font-semibold">#{playerMetrics.ranking}</span>
                      <span className="font-normal"> · {verdict.text}</span>
                    </p>
                  </div>
                );
              })()}

              {/* ═══ PLAYER CARD ═══ */}
              <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-800">{playerName}</p>
                      <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
                        {players.find(p => p.player_id === selectedPlayer)?.gender_label}
                        {calcAge(playerProfile?.dob) && ` · Age ${calcAge(playerProfile?.dob)}`}
                        {fmtStyle(playerProfile?.handedness, playerProfile?.grip) && ` · ${fmtStyle(playerProfile?.handedness, playerProfile?.grip)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    {[
                      { label: 'World rank',    value: `#${playerMetrics.ranking}` },
                      { label: 'Win rate (6M)', value: `${w6.winRate.toFixed(1)}%` },
                      { label: 'Matches (6M)',  value: `${w6.matchCount}`           },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">{s.label}</p>
                        <p className="text-xl font-bold text-slate-800">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ═══ HORIZONTAL TABS ═══ */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">

                {/* Tab bar */}
                <div className="flex border-b border-slate-100">
                  {TABS.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => switchTab(tab.id)}
                      className={`flex-1 py-3.5 text-sm font-medium transition-all relative ${
                        activeTab === tab.id
                          ? 'text-slate-900'
                          : 'text-slate-400 hover:text-slate-600'}`}>
                      {tab.label}
                      {activeTab === tab.id && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-800 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div ref={tabContentRef}>

                  {/* ══ RANK TAB ══ */}
                  {activeTab === 'rank' && (
                    <div className="p-5 space-y-4 slide">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 font-medium">Is this player improving?</p>
                        <WindowToggle value={rankWindow} onChange={setRankWindow} />
                      </div>

                      {/* Summary row */}
                      <div className="flex items-center gap-5 flex-wrap">
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">{rankWindow} ago</p>
                          <p className="text-xl font-bold text-slate-700">
                            {startRank && startRank < 999 ? `#${startRank}` : '—'}
                          </p>
                        </div>
                        <ArrowRight size={14} className={
                          rankWindowData?.rankChange > 0 ? 'text-emerald-400'
                          : rankWindowData?.rankChange < 0 ? 'text-red-300' : 'text-slate-200'} />
                        <div className="text-center">
                          <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Today</p>
                          <p className="text-xl font-bold text-slate-800">#{playerMetrics.ranking}</p>
                        </div>
                        {peakRank && (
                          <div className="text-center ml-3">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Period peak</p>
                            <p className="text-xl font-bold text-blue-500">#{peakRank}</p>
                          </div>
                        )}
                        <div className="ml-auto">
                          {(() => {
                            const rc = rankWindowData?.rankChange ?? 0;
                            if (rc > 0) return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700">↑ Improving</span>;
                            if (rc < 0) return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-red-50 text-red-500">↓ Declining</span>;
                            return <span className="text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 text-slate-500">— Stable</span>;
                          })()}
                        </div>
                      </div>

                      {/* Chart */}
                      <div className="bg-slate-50 rounded-xl p-4">
                        {rankChartData.data.length > 1 ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={rankChartData.data} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                              <defs>
                                <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.12} />
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}    />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis
                                dataKey="x"
                                type="number"
                                scale="time"
                                domain={['dataMin', 'dataMax']}
                                ticks={rankChartData.ticks}
                                tickFormatter={ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                reversed
                                domain={['dataMin - 2', 'dataMax + 2']}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={v => `#${Math.round(v)}`}
                                allowDecimals={false}
                              />
                              <Tooltip
                                cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12, padding: '6px 10px' }}
                                labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullDate || ''}
                                formatter={(v) => [`#${v}`, 'Rank']}
                              />
                              {peakRank && (
                                <ReferenceLine y={peakRank} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1.5}
                                  label={{ value: `Peak #${peakRank}`, position: 'insideTopRight', fontSize: 9, fill: '#10b981' }} />
                              )}
                              <Area
                                type="monotone"
                                dataKey="rank"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                fill="url(#rg)"
                                dot={false}
                                activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                                isAnimationActive={false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
                            Not enough data for {rankWindow} window
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ══ WIN/LOSS TAB ══ */}
                  {activeTab === 'winloss' && win && (
                    <div className="p-5 space-y-4 slide">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 font-medium">Where are they winning and losing?</p>
                        <WindowToggle value={winWindow} onChange={v => {
                          setWinWindow(v);
                          setOpenRankBar(null); setOpenTierBar(null);
                          setOpenCompBar(null); setOpenNationBar(null);
                        }} />
                      </div>

                      {/* Filter pills */}
                      <div className="flex gap-2 flex-wrap">
                        {WL_FILTERS.map(f => (
                          <button key={f.id} onClick={() => {
                            setWlFilter(f.id);
                            setOpenRankBar(null); setOpenTierBar(null);
                            setOpenCompBar(null); setOpenNationBar(null);
                          }}
                            className={`text-xs font-medium px-3 py-1 rounded-full border transition-all ${
                              wlFilter === f.id
                                ? 'border-slate-700 bg-slate-800 text-white'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* ONE unified table — summary + bars + match rows all share 28/40/32 */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                          <colgroup>
                            <col style={{ width: '28%' }} />
                            <col style={{ width: '40%' }} />
                            <col style={{ width: '32%' }} />
                          </colgroup>
                          <tbody>
                            {/* Summary row */}
                            <tr style={{ borderBottom: '0.5px solid #e2e8f0', background: '#f8fafc' }}>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Overall</p>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                  <span style={{ color: '#059669' }}>{win.wins}W</span>
                                  <span style={{ color: '#94a3b8' }}> / </span>
                                  <span style={{ color: '#f87171' }}>{win.losses}L</span>
                                  <span style={{ color: '#64748b', marginLeft: 4 }}>· {win.winRate.toFixed(1)}%</span>
                                </p>
                              </td>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top', textAlign: 'center' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Upset yield</p>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                  {win.upsetYield.toFixed(1)}%
                                  <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 4 }}>of wins vs higher-ranked</span>
                                </p>
                              </td>
                              <td style={{ padding: '10px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                                <p style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Avg opp rank beaten</p>
                                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                  {win.avgOppRankBeaten ? `#${win.avgOppRankBeaten}` : '—'}
                                </p>
                              </td>
                            </tr>

                            {/* WL bars + match rows — all in same tbody */}
                            {wlFilter === 'rank' && win.rankBuckets.map(b => (
                              <WLBarRows key={b.label} label={b.label} wins={b.wins} losses={b.losses} winPct={b.winPct}
                                isOpen={openRankBar === b.label}
                                onToggle={() => setOpenRankBar(openRankBar === b.label ? null : b.label)}>
                                {b.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                              </WLBarRows>
                            ))}

                            {wlFilter === 'tier' && (
                              win.tierBuckets.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No tier data in this window.</td></tr>
                                : win.tierBuckets.map(b => (
                                  <WLBarRows key={b.tier} label={b.label} wins={b.wins} losses={b.losses} winPct={b.winPct}
                                    isOpen={openTierBar === b.tier}
                                    onToggle={() => setOpenTierBar(openTierBar === b.tier ? null : b.tier)}>
                                    {b.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                  </WLBarRows>
                                ))
                            )}

                            {wlFilter === 'competitor' && (
                              win.topCompetitors.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No data in this window.</td></tr>
                                : win.topCompetitors.map(c => (
                                  <WLBarRows key={c.name}
                                    label={`${c.name}${c.currentRank < 999 ? ` · #${c.currentRank}` : ''}`}
                                    wins={c.wins} losses={c.losses} winPct={c.winPct}
                                    isOpen={openCompBar === c.name}
                                    onToggle={() => setOpenCompBar(openCompBar === c.name ? null : c.name)}>
                                    {c.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                  </WLBarRows>
                                ))
                            )}

                            {wlFilter === 'nation' && (
                              win.topNations.length === 0
                                ? <tr><td colSpan={3} style={{ padding: 16, fontSize: 13, color: '#94a3b8' }}>No nation data in this window.</td></tr>
                                : win.topNations.map(n => (
                                  <WLBarRows key={n.country} label={n.country.toUpperCase()} wins={n.wins} losses={n.losses} winPct={n.winPct}
                                    isOpen={openNationBar === n.country}
                                    onToggle={() => setOpenNationBar(openNationBar === n.country ? null : n.country)}>
                                    {n.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                  </WLBarRows>
                                ))
                            )}
                            {wlFilter === 'style' && (
                              win.styleGroups.filter(s => s.style !== 'Unknown').map(s => (
                                <WLBarRows key={s.style} label={s.style} wins={s.wins} losses={s.losses} winPct={s.winPct}
                                  isOpen={openNationBar === s.style}
                                  onToggle={() => setOpenNationBar(openNationBar === s.style ? null : s.style)}>
                                  {s.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                </WLBarRows>
                              ))
                            )}
                            {wlFilter === 'grip' && (
                              win.gripGroups.filter(g => g.grip !== 'Unknown').map(g => (
                                <WLBarRows key={g.grip} label={g.grip} wins={g.wins} losses={g.losses} winPct={g.winPct}
                                  isOpen={openNationBar === g.grip}
                                  onToggle={() => setOpenNationBar(openNationBar === g.grip ? null : g.grip)}>
                                  {g.matches.map((m, i) => <MatchRow key={i} match={m} />)}
                                </WLBarRows>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ══ PERFORMANCE TAB ══ */}
                  {activeTab === 'performance' && dna && (
                    <div className="p-5 space-y-4 slide">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-500 font-medium">How do they perform under pressure?</p>
                        <WindowToggle value={dnaWindow} onChange={v => { setDnaWindow(v); setOpenDna(null); }} />
                      </div>

                      <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                        <span className="text-sm text-slate-600">Avg point diff per game</span>
                        <span className={`text-sm font-bold ${
                          dna.avgPtDiff > 0 ? 'text-emerald-600'
                          : dna.avgPtDiff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                          {dna.avgPtDiff >= 0 ? '+' : ''}{dna.avgPtDiff.toFixed(2)}
                        </span>
                        <span className="text-xs text-slate-400">across {dna.matchCount} matches</span>
                      </div>

                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        {[
                          { key: 'clutch',         label: 'Clutch index',         desc: 'Won on the deciding set',       value: `${dna.clutchIndex.toFixed(1)}%`,   pctBase: null,       pctVal: null,                   pctLabel: null,        color: 'text-amber-600',   matches: dna.dnaGroups.clutch },
                          { key: 'straightWins',   label: 'Straight sets wins',   desc: 'Dominated without dropping a game', value: `${dna.straightSetsWins}`,      pctBase: dna.wins,   pctVal: dna.straightSetsWins,   pctLabel: 'of wins',   color: 'text-emerald-600', matches: dna.dnaGroups.straightWins },
                          { key: 'straightLosses', label: 'Straight sets losses', desc: 'Lost without winning a game',   value: `${dna.straightSetsLosses}`,        pctBase: dna.losses, pctVal: dna.straightSetsLosses, pctLabel: 'of losses', color: 'text-red-400',     matches: dna.dnaGroups.straightLosses },
                          { key: 'comebacks',      label: 'Comeback wins',        desc: 'Won after losing game 1',       value: `${dna.comebackWins}`,              pctBase: dna.wins,   pctVal: dna.comebackWins,       pctLabel: 'of wins',   color: 'text-sky-600',     matches: dna.dnaGroups.comebacks },
                        ].map((item, idx, arr) => (
                          <div key={item.key} className={idx < arr.length - 1 ? 'border-b border-slate-100' : ''}>
                            <button
                              onClick={() => setOpenDna(openDna === item.key ? null : item.key)}
                              className={`w-full flex items-center px-4 py-3.5 text-left transition-colors ${
                                openDna === item.key ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-slate-800">{item.label}</span>
                                <span className="text-xs text-slate-400 ml-2">{item.desc}</span>
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0">
                                <span className={`text-base font-bold ${item.color}`}>{item.value}</span>
                                {item.pctBase > 0 && (
                                  <span className="text-xs text-slate-400">
                                    {((item.pctVal / item.pctBase) * 100).toFixed(0)}% {item.pctLabel}
                                  </span>
                                )}
                                {item.matches.length > 0
                                  ? openDna === item.key
                                    ? <ChevronUp size={13} className="text-slate-400" />
                                    : <ChevronDown size={13} className="text-slate-400" />
                                  : <span className="w-[13px]" />}
                              </div>
                            </button>
                            {openDna === item.key && item.matches.length > 0 && (
                              <div className="slide border-t border-slate-100 bg-slate-50/30">
                                <MatchList matches={item.matches} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ══ DOMESTIC TAB ══ */}
                  {activeTab === 'domestic' && (
                    <DomesticTab matches={domesticMatches} playerWttId={String(selectedPlayer)} />
                  )}

                  {/* ══ FORM TAB ══ */}
                  {activeTab === 'form' && (
                    <div className="slide">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                        <p className="text-xs text-slate-500 font-medium">Recent form</p>
                        <span className="text-xs text-slate-400">
  Last {recentDisplay.length} matches
  {domesticLedger.length > 0 && 
    <span className="ml-1 text-slate-300">· incl. {domesticLedger.length} domestic</span>}
</span>
                      </div>

                      {recentAll.length === 0
                        ? <p className="text-sm text-slate-400 px-5 py-4">No matches found.</p>
                        : (
                          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                            <colgroup>
                              <col style={{ width: '28%' }} />
                              <col style={{ width: '40%' }} />
                              <col style={{ width: '32%' }} />
                            </colgroup>
                            <tbody>
                              {recentDisplay.map((m, i) => <MatchRow key={i} match={m} />)}
                            </tbody>
                          </table>
                        )}

                      {recentAll.length > 5 && (
                        <div className="px-5 py-3 border-t border-slate-100">
                          <button
                            onClick={() => setFormShowAll(o => !o)}
                            className="text-sm text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
                            {formShowAll
                              ? <><ChevronUp size={13} /> Show less</>
                              : <><ChevronDown size={13} /> Show {Math.min(12, recentAll.length)} matches</>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* Legend */}
              <p className="text-[10px] text-slate-400 text-center pb-4">
                <span className="text-emerald-500 font-semibold">★</span> Upset win &nbsp;·&nbsp;
                <span className="text-amber-500 font-semibold">⚡</span> Clutch (deciding set) &nbsp;·&nbsp;
                <span className="text-sky-500 font-semibold">↩</span> Comeback
              </p>

            </>
          )}
        </div>
      </div>
    </>
  );
}
