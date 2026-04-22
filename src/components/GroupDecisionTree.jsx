import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STAGE_1A = new Set(['G1', 'G2'])

const POS_COLORS = ['#f59e0b', '#3b82f6', '#94a3b8', '#d1d5db']
const POS_LABELS = ['1st', '2nd', '3rd', '4th']

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

  // pos[teamIdx][rank 0..n-1] = cumulative probability
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

    // Sort indices by wins desc
    const order = [...Array(n).keys()].sort((a, b) => wins[b] - wins[a])

    // Split tied ranks evenly
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

function GroupCard({ groupId, teams, matchupRows, isStage1a }) {
  // Build matchup lookup: "TA_TB" → P(TA wins)
  const matchupMap = {}
  for (const m of matchupRows) {
    matchupMap[`${m.team_a}_${m.team_b}`] = m.p_win
    matchupMap[`${m.team_b}_${m.team_a}`] = 1 - m.p_win
  }

  const finishProbs = computeFinishingProbs(teams, matchupMap)

  // Sort display order by P(1st) descending
  const rankOrder = [...Array(teams.length).keys()].sort(
    (a, b) => finishProbs[b][0] - finishProbs[a][0]
  )

  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: 24,
      border: '1px solid #e2e8f0', marginBottom: 20,
    }}>
      {/* Group header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{
          background: isStage1a ? '#eff6ff' : '#f0fdf4',
          color: isStage1a ? '#1d4ed8' : '#166534',
          borderRadius: 8, padding: '4px 12px', fontWeight: 700, fontSize: 15,
        }}>
          Group {groupId.slice(1)}
        </span>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {isStage1a
            ? 'Stage 1a — All 4 advance to Main Draw (seeding only)'
            : 'Stage 1b — 1st → R32 direct · 2nd → Runner-up pool · 3rd/4th → Eliminated'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>

        {/* Matchup Matrix */}
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
            Head-to-Head Win %
          </div>
          <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 56, padding: '4px 6px' }}></th>
                {teams.map(t => (
                  <th key={t} style={{ padding: '4px 8px', color: '#334155', fontWeight: 700, textAlign: 'center', minWidth: 64, fontSize: 11 }}>
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
                      <td key={colTeam} style={{
                        padding: '6px 10px', textAlign: 'center',
                        background: '#f8fafc', color: '#cbd5e1',
                        borderRadius: 6,
                      }}>—</td>
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
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
            Row team's P(win vs column team)
          </div>
        </div>

        {/* Finishing position probabilities */}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
            Finishing Position Probabilities
          </div>
          {rankOrder.map(ti => {
            const team = teams[ti]
            const probs = finishProbs[ti]
            return (
              <div key={team} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 52, fontWeight: 700, fontSize: 12, color: '#334155', textAlign: 'right', flexShrink: 0 }}>
                  {FLAG_CODES[team] || ''} {team}
                </div>
                {/* Stacked bar */}
                <div style={{
                  flex: 1, height: 18, borderRadius: 9, overflow: 'hidden',
                  display: 'flex', background: '#f1f5f9', minWidth: 80,
                }}>
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
                {/* Inline labels */}
                <div style={{ display: 'flex', gap: 5, fontSize: 11, flexShrink: 0, flexWrap: 'wrap', maxWidth: 160 }}>
                  {probs.map((p, ri) => {
                    const pct = Math.round(p * 100)
                    if (pct < 1) return null
                    return (
                      <span key={ri} style={{ color: POS_COLORS[ri], fontWeight: 600 }}>
                        {POS_LABELS[ri]}&nbsp;{pct}%
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, fontSize: 11, color: '#64748b' }}>
            {POS_COLORS.map((c, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
                {POS_LABELS[i]}
              </span>
            ))}
          </div>

          {/* Advancement path */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            {isStage1a ? (
              <div style={{
                background: '#eff6ff', border: '1px solid #93c5fd',
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#1e40af',
              }}>
                All 4 teams advance. Finishing position determines bracket seeding in the Main Draw.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                  <strong>1st</strong> → Main Draw Round of 32 (direct)
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />
                  <strong>2nd</strong> → Runner-up pool · 6 best advance direct, 8 go to Prelim Round
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 11, alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                  <strong>3rd / 4th</strong> → Eliminated
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function GroupDecisionTree({ gender }) {
  const [matchups, setMatchups] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState('ALL')

  useEffect(() => {
    setSelectedGroup('ALL')
    loadMatchups()
  }, [gender])

  async function loadMatchups() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('wttc_lineup_results')
        .select('team_a, team_b, p_win, group_id, computed_at')
        .eq('gender', gender)
        .order('group_id', { ascending: true })
        .limit(2000)
      if (err) throw err
      setMatchups(data || [])
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
    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
      <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8 }}>No group data yet</div>
      <code style={{ display: 'block', marginTop: 8, background: '#fef3c7', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#92400e' }}>
        python scripts/wttc_simulate.py --gender {gender} --groups
      </code>
    </div>
  )

  // Build group → matchup rows map
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
      {/* Metadata */}
      {computedLabel && (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          🕐 Last computed: {computedLabel}
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

      {/* Group cards */}
      {displayed.map(gid => (
        <GroupCard
          key={gid}
          groupId={gid}
          teams={groupTeams[gid]}
          matchupRows={byGroup[gid]}
          isStage1a={STAGE_1A.has(gid)}
        />
      ))}

      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>
        Green ≥ 65% · Amber 45–65% · Red &lt; 45% · Probabilities via V8 MatchPredictor + exact DP
      </p>
    </div>
  )
}
