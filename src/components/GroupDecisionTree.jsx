import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STAGE_1A = new Set(['G1', 'G2'])

const POS_COLORS = ['#f59e0b', '#3b82f6', '#94a3b8', '#d1d5db']
const POS_LABELS = ['1st', '2nd', '3rd', '4th']

// Road to Gold stages (cumulative)
const ROAD_STAGES = [
  { key: 'advance', label: 'Advance' },
  { key: 'r32',     label: 'R32' },
  { key: 'r16',     label: 'R16' },
  { key: 'qf',      label: 'QF' },
  { key: 'medal',   label: 'Medal' },
  { key: 'gold',    label: 'Gold' },
]

const FLAG_CODES = {
  IND: '🇮🇳', CHN: '🇨🇳', JPN: '🇯🇵', GER: '🇩🇪', KOR: '🇰🇷',
  FRA: '🇫🇷', SWE: '🇸🇪', TPE: '🇹🇼', ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', ROU: '🇷🇴',
  BRA: '🇧🇷', HUN: '🇭🇺', HKG: '🇭🇰', SGP: '🇸🇬', EGY: '🇪🇬',
  POR: '🇵🇹', CRO: '🇭🇷', AUS: '🇦🇺', USA: '🇺🇸', POL: '🇵🇱',
  SRB: '🇷🇸', DEN: '🇩🇰', AUT: '🇦🇹', ITA: '🇮🇹', ESP: '🇪🇸',
  CZE: '🇨🇿', SVK: '🇸🇰', UKR: '🇺🇦', THA: '🇹🇭', MAS: '🇲🇾',
  QAT: '🇶🇦', PRK: '🇰🇵', KAZ: '🇰🇿', ARG: '🇦🇷', NZL: '🇳🇿',
  TUR: '🇹🇷', CAN: '🇨🇦', BEL: '🇧🇪', CHI: '🇨🇱', GRE: '🇬🇷',
  SLO: '🇸🇮', MDG: '🇲🇬', MEX: '🇲🇽', MGL: '🇲🇳', PUR: '🇵🇷',
  UZB: '🇺🇿', BRN: '🇧🇳', ALG: '🇩🇿', NGR: '🇳🇬', RSA: '🇿🇦',
  NED: '🇳🇱', MAC: '🇲🇴', UGA: '🇺🇬', RWA: '🇷🇼', CRC: '🇨🇷',
  BEN: '🇧🇯', COD: '🇨🇩', LUX: '🇱🇺', MAR: '🇲🇦', TOG: '🇹🇬',
  CIV: '🇨🇮', ANG: '🇦🇴', CMR: '🇨🇲', FIJ: '🇫🇯', KSA: '🇸🇦',
  GUA: '🇬🇹', TUN: '🇹🇳', NAM: '🇳🇦', DOM: '🇩🇴', WAL: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  GHA: '🇬🇭', ETH: '🇪🇹', SUI: '🇨🇭', BRB: '🇧🇧', SRI: '🇱🇰',
  TAH: '🇵🇫', MDA: '🇲🇩', NCL: '🇳🇨', PER: '🇵🇪',
}

// Analytical enumeration of 2^6 = 64 outcomes for a 4-team round robin
function computeFinishingProbs(teams, matchupMap) {
  const n = teams.length
  const pairs = []
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      pairs.push([i, j])

  const pos = Array.from({ length: n }, () => new Array(n).fill(0))
  const total = 1 << pairs.length

  for (let mask = 0; mask < total; mask++) {
    const wins = new Array(n).fill(0)
    let prob = 1

    for (let p = 0; p < pairs.length; p++) {
      const [i, j] = pairs[p]
      const pWin = matchupMap[`${teams[i]}_${teams[j]}`] ?? 0.5
      if ((mask >> p) & 1) { wins[i]++; prob *= pWin }
      else { wins[j]++; prob *= (1 - pWin) }
    }

    const order = [...Array(n).keys()].sort((a, b) => wins[b] - wins[a])
    let start = 0
    while (start < n) {
      let end = start + 1
      while (end < n && wins[order[end]] === wins[order[start]]) end++
      const tieCount = end - start
      for (let k = start; k < end; k++)
        for (let r = start; r < end; r++)
          pos[order[k]][r] += prob / tieCount
      start = end
    }
  }
  return pos
}

// Compute cumulative "reach stage X" probabilities from sim result map
// Each result = where the team was ELIMINATED
function computeRoadProbs(resultMap, finishProbs, teamIdx, isStage1a) {
  const g = resultMap?.Gold   || 0
  const s = resultMap?.Silver || 0
  const b = resultMap?.Bronze || 0
  const qf  = resultMap?.QF  || 0
  const r16 = resultMap?.R16 || 0
  const r32 = resultMap?.R32 || 0

  // P(1st or 2nd) — from analytical group computation
  const pAdvance = isStage1a
    ? 1.0
    : (finishProbs[teamIdx]?.[0] || 0) + (finishProbs[teamIdx]?.[1] || 0)

  return {
    advance: pAdvance,
    r32:     g + s + b + qf + r16 + r32,  // reached R32 bracket
    r16:     g + s + b + qf + r16,
    qf:      g + s + b + qf,
    medal:   g + s + b,                    // Bronze = lost in SF = reached SF → medal
    gold:    g,
  }
}

function stageColor(p) {
  if (p >= 0.6) return { bg: '#dcfce7', fg: '#166534', border: '#86efac' }
  if (p >= 0.35) return { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' }
  if (p >= 0.10) return { bg: '#fef9c3', fg: '#854d0e', border: '#fde68a' }
  if (p >= 0.01) return { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' }
  return { bg: '#f8fafc', fg: '#94a3b8', border: '#e2e8f0' }
}

function pWinBg(p) {
  if (p >= 0.65) return '#dcfce7'
  if (p >= 0.45) return '#fef9c3'
  return '#fee2e2'
}
function pWinFg(p) {
  if (p >= 0.65) return '#166534'
  if (p >= 0.45) return '#854d0e'
  return '#991b1b'
}

function fmt(p) {
  const pct = Math.round(p * 100)
  if (pct === 0) return '<1%'
  return `${pct}%`
}

function GroupCard({ groupId, teams, matchupRows, simData, isStage1a }) {
  const [view, setView] = useState('path') // 'path' | 'matrix' | 'finish'

  // Build matchup lookup: "TA_TB" → P(TA wins)
  const matchupMap = {}
  for (const m of matchupRows) {
    matchupMap[`${m.team_a}_${m.team_b}`] = m.p_win
    matchupMap[`${m.team_b}_${m.team_a}`] = 1 - m.p_win
  }

  const finishProbs = computeFinishingProbs(teams, matchupMap)

  // Sort display order by P(Gold) desc (from sim), fallback to P(1st) from analytical
  const rankOrder = [...Array(teams.length).keys()].sort((a, b) => {
    const ga = simData[teams[a]]?.Gold || 0
    const gb = simData[teams[b]]?.Gold || 0
    if (gb !== ga) return gb - ga
    return (finishProbs[b][0] || 0) - (finishProbs[a][0] || 0)
  })

  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: 24,
      border: '1px solid #e2e8f0', marginBottom: 20,
    }}>
      {/* Group header + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: isStage1a ? '#eff6ff' : '#f0fdf4',
            color: isStage1a ? '#1d4ed8' : '#166534',
            borderRadius: 8, padding: '4px 12px', fontWeight: 700, fontSize: 15,
          }}>
            Group {groupId.slice(1)}
          </span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {isStage1a
              ? 'Stage 1a — All 4 advance to Main Draw'
              : 'Stage 1b — 1st → R32 · 2nd → Runner-up pool · 3rd/4th → Out'}
          </span>
        </div>
        {/* View tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { k: 'path',   l: 'Road to Gold' },
            { k: 'matrix', l: 'H2H Matrix' },
            { k: 'finish', l: 'Group Finish' },
          ].map(({ k, l }) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              border: 'none',
              background: view === k ? '#6366f1' : '#f1f5f9',
              color: view === k ? '#fff' : '#64748b',
              fontWeight: view === k ? 700 : 400,
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── ROAD TO GOLD (decision tree funnel) ── */}
      {view === 'path' && (
        <div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: '6px 4px', fontSize: 12, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', width: 70 }}>Team</th>
                  {ROAD_STAGES.map((st, si) => (
                    <th key={st.key} style={{ textAlign: 'center', padding: '4px 8px', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', minWidth: 72 }}>
                      {si > 0 && <span style={{ color: '#cbd5e1', marginRight: 4 }}>→</span>}
                      {st.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankOrder.map(ti => {
                  const team = teams[ti]
                  const rm = simData[team] || {}
                  const road = computeRoadProbs(rm, finishProbs, ti, isStage1a)

                  return (
                    <tr key={team}>
                      <td style={{ padding: '4px 8px', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                        {FLAG_CODES[team] || ''} {team}
                      </td>
                      {ROAD_STAGES.map(st => {
                        const p = road[st.key]
                        const { bg, fg, border } = stageColor(p)
                        const pct = Math.round(p * 100)
                        return (
                          <td key={st.key} style={{ padding: '4px 6px', textAlign: 'center' }}>
                            <div style={{
                              background: bg, color: fg,
                              border: `1px solid ${border}`,
                              borderRadius: 8, padding: '5px 6px',
                              fontWeight: 700, fontSize: 12,
                              minWidth: 52,
                            }}>
                              {pct >= 1 ? `${pct}%` : pct > 0 ? '<1%' : '—'}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Color legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', fontSize: 11, color: '#64748b' }}>
            {[
              { bg: '#dcfce7', fg: '#166534', label: '≥ 60%' },
              { bg: '#dbeafe', fg: '#1e40af', label: '35–60%' },
              { bg: '#fef9c3', fg: '#854d0e', label: '10–35%' },
              { bg: '#fee2e2', fg: '#991b1b', label: '1–10%' },
              { bg: '#f8fafc', fg: '#94a3b8', label: '< 1%' },
            ].map(({ bg, fg, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 16, height: 14, borderRadius: 3, background: bg, border: `1px solid ${fg}33`, display: 'inline-block' }} />
                {label}
              </span>
            ))}
          </div>

          {/* Advancement rules */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
            {isStage1a ? (
              <div style={{ fontSize: 11, color: '#1e40af', background: '#eff6ff', borderRadius: 8, padding: '8px 12px' }}>
                Stage 1a: All 4 teams advance. Group position determines bracket seeding.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                <span style={{ background: '#f0fdf4', color: '#166534', borderRadius: 6, padding: '4px 10px' }}>1st → R32 direct</span>
                <span style={{ background: '#eff6ff', color: '#1e40af', borderRadius: 6, padding: '4px 10px' }}>2nd → runner-up pool (top 6 direct / bottom 8 play Prelim)</span>
                <span style={{ background: '#fef2f2', color: '#991b1b', borderRadius: 6, padding: '4px 10px' }}>3rd / 4th → eliminated</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── H2H MATCHUP MATRIX ── */}
      {view === 'matrix' && (
        <div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 60, padding: '4px 6px' }}></th>
                  {teams.map(t => (
                    <th key={t} style={{ padding: '4px 10px', color: '#334155', fontWeight: 700, textAlign: 'center', minWidth: 72, fontSize: 11 }}>
                      {FLAG_CODES[t] || ''} {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((rowTeam, ri) => (
                  <tr key={rowTeam}>
                    <td style={{ padding: '4px 6px', fontWeight: 700, color: '#334155', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {FLAG_CODES[rowTeam] || ''} {rowTeam}
                    </td>
                    {teams.map((colTeam, ci) => {
                      if (ri === ci) return (
                        <td key={colTeam} style={{ padding: '6px 10px', textAlign: 'center', background: '#f8fafc', color: '#cbd5e1', borderRadius: 6 }}>—</td>
                      )
                      const p = matchupMap[`${rowTeam}_${colTeam}`] ?? 0.5
                      const pct = Math.round(p * 100)
                      return (
                        <td key={colTeam} style={{
                          padding: '6px 10px', textAlign: 'center',
                          background: pWinBg(p), color: pWinFg(p),
                          fontWeight: 700, borderRadius: 6,
                        }}>
                          {pct}%
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>
            Row team's P(win vs column team) · Green ≥ 65% · Amber 45–65% · Red &lt; 45%
          </div>
        </div>
      )}

      {/* ── GROUP FINISHING POSITION PROBABILITIES ── */}
      {view === 'finish' && (
        <div>
          {rankOrder.map(ti => {
            const team = teams[ti]
            const probs = finishProbs[ti]
            return (
              <div key={team} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 56, fontWeight: 700, fontSize: 12, color: '#334155', textAlign: 'right', flexShrink: 0 }}>
                  {FLAG_CODES[team] || ''} {team}
                </div>
                <div style={{ flex: 1, height: 20, borderRadius: 10, overflow: 'hidden', display: 'flex', background: '#f1f5f9', minWidth: 80 }}>
                  {probs.map((p, ri) => {
                    const pct = p * 100
                    if (pct < 0.5) return null
                    return (
                      <div key={ri}
                        title={`${POS_LABELS[ri]}: ${Math.round(pct)}%`}
                        style={{ width: `${pct}%`, background: POS_COLORS[ri] }}
                      />
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, flexShrink: 0, flexWrap: 'wrap', maxWidth: 180 }}>
                  {probs.map((p, ri) => {
                    const pct = Math.round(p * 100)
                    if (pct < 1) return null
                    return (
                      <span key={ri} style={{ color: POS_COLORS[ri], fontWeight: 600 }}>
                        {POS_LABELS[ri]} {pct}%
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 11, color: '#64748b' }}>
            {POS_COLORS.map((c, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
                {POS_LABELS[i]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function GroupDecisionTree({ gender }) {
  const [matchups, setMatchups] = useState(null)
  const [simResults, setSimResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState('ALL')

  useEffect(() => {
    setSelectedGroup('ALL')
    loadData()
  }, [gender])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [matchupRes, simRes] = await Promise.all([
        supabase
          .from('wttc_lineup_results')
          .select('team_a, team_b, p_win, group_id, computed_at')
          .eq('gender', gender)
          .order('group_id', { ascending: true })
          .limit(2000),
        supabase
          .from('wttc_sim_results')
          .select('team, result, probability, computed_at')
          .eq('gender', gender)
          .order('computed_at', { ascending: false })
          .limit(2000),
      ])

      if (matchupRes.error) throw matchupRes.error
      if (simRes.error) throw simRes.error

      setMatchups(matchupRes.data || [])

      // Build simData[team][result] = probability from latest batch
      const simRows = simRes.data || []
      const latestSim = simRows[0]?.computed_at
      const cutoff = latestSim ? new Date(latestSim).getTime() - 60_000 : 0
      const latestSimRows = simRows.filter(r => new Date(r.computed_at).getTime() >= cutoff)
      const byTeam = {}
      for (const r of latestSimRows) {
        if (!byTeam[r.team]) byTeam[r.team] = {}
        byTeam[r.team][r.result] = r.probability
      }
      setSimResults(byTeam)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading group data…</div>
  )
  if (error) return (
    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 16, color: '#dc2626', fontSize: 13 }}>
      {error}
    </div>
  )
  if (!matchups || matchups.length === 0) return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 32, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 8 }}>No group data yet</div>
      <code style={{ display: 'block', marginTop: 8, background: '#f1f5f9', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#475569' }}>
        python scripts/wttc_simulate.py --gender {gender} --groups
      </code>
    </div>
  )

  // Group matchups by group_id
  const byGroup = {}
  for (const m of matchups) {
    if (!byGroup[m.group_id]) byGroup[m.group_id] = []
    byGroup[m.group_id].push(m)
  }

  // Extract ordered team list per group
  const groupTeams = {}
  for (const [gid, rows] of Object.entries(byGroup)) {
    const seen = new Set()
    const teams = []
    for (const m of rows) {
      if (!seen.has(m.team_a)) { seen.add(m.team_a); teams.push(m.team_a) }
      if (!seen.has(m.team_b)) { seen.add(m.team_b); teams.push(m.team_b) }
    }
    groupTeams[gid] = teams
  }

  const groupIds = Object.keys(byGroup).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  const displayed = selectedGroup === 'ALL' ? groupIds : groupIds.filter(g => g === selectedGroup)

  const lastComputed = matchups[0]?.computed_at
  const computedLabel = lastComputed
    ? new Date(lastComputed).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div>
      {computedLabel && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
          Last computed: {computedLabel}
        </div>
      )}

      {/* Group selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {['ALL', ...groupIds].map(g => (
          <button key={g} onClick={() => setSelectedGroup(g)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
            border: 'none',
            background: selectedGroup === g ? '#0f172a' : '#f1f5f9',
            color: selectedGroup === g ? '#fff' : '#475569',
            fontWeight: selectedGroup === g ? 700 : 400,
          }}>
            {g === 'ALL' ? 'All Groups' : `G${g.slice(1)}`}
          </button>
        ))}
      </div>

      {displayed.map(gid => (
        <GroupCard
          key={gid}
          groupId={gid}
          teams={groupTeams[gid]}
          matchupRows={byGroup[gid]}
          simData={simResults || {}}
          isStage1a={STAGE_1A.has(gid)}
        />
      ))}

    </div>
  )
}
