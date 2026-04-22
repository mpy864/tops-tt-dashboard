import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const RESULT_ORDER = ['Gold', 'Silver', 'Bronze', 'QF', 'R16', 'R32', 'Prelim', 'Stage1b', 'Stage1a']

const MEDAL_RESULTS = ['Gold', 'Silver', 'Bronze']
const MAIN_DRAW_RESULTS = ['Gold', 'Silver', 'Bronze', 'QF', 'R16', 'R32']

const RESULT_COLORS = {
  Gold:    '#f59e0b',
  Silver:  '#94a3b8',
  Bronze:  '#b45309',
  QF:      '#3b82f6',
  R16:     '#22c55e',
  R32:     '#64748b',
  Prelim:  '#f43f5e',
  Stage1b: '#e2e8f0',
  Stage1a: '#e2e8f0',
}

const RESULT_LABELS = {
  Gold:    'Gold',
  Silver:  'Silver',
  Bronze:  'Bronze',
  QF:      'Quarter-Final',
  R16:     'Round of 16',
  R32:     'Round of 32',
  Prelim:  'Prelim Round',
  Stage1b: 'Stage 1b',
  Stage1a: 'Stage 1a',
}

const FLAG_CODES = {
  IND: '🇮🇳', CHN: '🇨🇳', JPN: '🇯🇵', GER: '🇩🇪', KOR: '🇰🇷',
  FRA: '🇫🇷', SWE: '🇸🇪', TPE: '🇹🇼', ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', ROU: '🇷🇴',
  BRA: '🇧🇷', HUN: '🇭🇺', HKG: '🇭🇰', SGP: '🇸🇬', EGY: '🇪🇬',
  POR: '🇵🇹', CRO: '🇭🇷', AUS: '🇦🇺', USA: '🇺🇸', POL: '🇵🇱',
  SRB: '🇷🇸', DEN: '🇩🇰', AUT: '🇦🇹', ITA: '🇮🇹', ESP: '🇪🇸',
  CZE: '🇨🇿', SVK: '🇸🇰', UKR: '🇺🇦', THA: '🇹🇭', MAS: '🇲🇾',
  QAT: '🇶🇦', PRK: '🇰🇵', KAZ: '🇰🇿',
}

function ProbBar({ value, color }) {
  const pct = Math.round(value * 100)
  if (pct === 0) return <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        height: 8, borderRadius: 4,
        background: color || '#3b82f6',
        width: Math.max(4, Math.min(80, pct * 0.8)),
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: '#0f172a' }}>
        {pct < 1 ? '<1%' : `${pct}%`}
      </span>
    </div>
  )
}

function TeamDetailPanel({ team, probs, onClose }) {
  if (!probs) return null
  const flag = FLAG_CODES[team] || ''
  const pMedal = MEDAL_RESULTS.reduce((s, r) => s + (probs[r] || 0), 0)
  const pMD = MAIN_DRAW_RESULTS.reduce((s, r) => s + (probs[r] || 0), 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32,
        minWidth: 340, maxWidth: 460, boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {flag} {team}
          </h2>
          <button onClick={onClose} style={{
            border: 'none', background: '#f1f5f9', borderRadius: 8,
            padding: '4px 10px', cursor: 'pointer', fontSize: 16, color: '#64748b',
          }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Medal', value: pMedal, color: '#f59e0b' },
            { label: 'Main Draw', value: pMD, color: '#3b82f6' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              flex: 1, background: '#f8fafc', borderRadius: 10, padding: '12px 8px',
              textAlign: 'center', border: `2px solid ${color}22`,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{Math.round(value * 100)}%</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
        {RESULT_ORDER.map(res => {
          const p = probs[res] || 0
          if (p === 0) return null
          return (
            <div key={res} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: '1px solid #f1f5f9',
            }}>
              <span style={{ fontSize: 13, color: '#334155', minWidth: 100 }}>
                {RESULT_LABELS[res] || res}
              </span>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <ProbBar value={p} color={RESULT_COLORS[res]} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TeamTable({ data, gender }) {
  const [selected, setSelected] = useState(null)
  const [sortBy, setSortBy] = useState('Gold')
  const [search, setSearch] = useState('')

  const TIEBREAK = ['Gold', 'Silver', 'Bronze', 'QF', 'R16', 'R32']
  const sorted = [...data].sort((a, b) => {
    for (const col of [sortBy, ...TIEBREAK.filter(c => c !== sortBy)]) {
      const diff = (b.probs[col] || 0) - (a.probs[col] || 0)
      if (diff !== 0) return diff
    }
    return 0
  })
  const filtered = sorted.filter(d => d.team.toLowerCase().includes(search.toLowerCase()))

  const sortCols = ['Gold', 'Silver', 'Bronze', 'QF', 'R16']

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter team…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
            fontSize: 13, outline: 'none', minWidth: 140,
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sortCols.map(col => (
            <button key={col} onClick={() => setSortBy(col)} style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
              border: 'none',
              background: sortBy === col ? '#0f172a' : '#f1f5f9',
              color:      sortBy === col ? '#fff'    : '#475569',
              fontWeight: sortBy === col ? 700 : 400,
            }}>
              {RESULT_LABELS[col] || col}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={th}>#</th>
              <th style={{ ...th, textAlign: 'left' }}>Team</th>
              {sortCols.map(col => (
                <th key={col} style={{ ...th, cursor: 'pointer', color: sortBy === col ? '#6366f1' : '#64748b' }}
                    onClick={() => setSortBy(col)}>
                  {col}
                </th>
              ))}
              <th style={th}>Main Draw</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d, i) => {
              const { team, probs } = d
              const flag = FLAG_CODES[team] || ''
              const pMD = MAIN_DRAW_RESULTS.reduce((s, r) => s + (probs[r] || 0), 0)
              return (
                <tr key={team}
                    onClick={() => setSelected(team)}
                    style={{
                      cursor: 'pointer',
                      background: i % 2 === 0 ? '#fff' : '#fafbfc',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}
                >
                  <td style={{ ...td, color: '#94a3b8', width: 36 }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <span style={{ marginRight: 6 }}>{flag}</span>{team}
                  </td>
                  {sortCols.map(col => (
                    <td key={col} style={td}>
                      <ProbBar value={probs[col] || 0} color={RESULT_COLORS[col]} />
                    </td>
                  ))}
                  <td style={td}>
                    <ProbBar value={pMD} color="#3b82f6" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <TeamDetailPanel
          team={selected}
          probs={filtered.find(d => d.team === selected)?.probs}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

const th = {
  padding: '10px 12px',
  textAlign: 'center',
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  borderBottom: '2px solid #e2e8f0',
  whiteSpace: 'nowrap',
}

const td = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle',
}

export default function TournamentSimulator({ gender = 'M' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadData(gender)
  }, [gender])

  async function loadData(g) {
    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: err } = await supabase
        .from('wttc_sim_results')
        .select('team, result, probability, runs, computed_at, model_version')
        .eq('gender', g)
        .order('computed_at', { ascending: false })
        .limit(2000)

      if (err) throw err
      if (!rows || rows.length === 0) {
        setData([])
        setMeta(null)
        setLoading(false)
        return
      }

      const latest = rows[0].computed_at
      const cutoff = new Date(latest).getTime() - 60_000
      const latestRows = rows.filter(r => new Date(r.computed_at).getTime() >= cutoff)

      const byTeam = {}
      for (const row of latestRows) {
        if (!byTeam[row.team]) byTeam[row.team] = {}
        byTeam[row.team][row.result] = row.probability
      }

      const teamData = Object.entries(byTeam).map(([team, probs]) => ({ team, probs }))
      setData(teamData)
      setMeta({
        runs:          latestRows[0]?.runs,
        computed_at:   latest,
        model_version: latestRows[0]?.model_version,
      })
    } catch (e) {
      setError(e.message || 'Failed to load simulation data')
    } finally {
      setLoading(false)
    }
  }

  const noData = !loading && data !== null && data.length === 0

  return (
    <div>
      {meta && (
        <div style={{
          display: 'flex', gap: 16, flexWrap: 'wrap',
          marginBottom: 20, fontSize: 12, color: '#64748b',
        }}>
          <span>{meta.runs?.toLocaleString()} simulations</span>
          <span>V{meta.model_version} model</span>
          <span>{new Date(meta.computed_at).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}</span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 10, padding: 16, color: '#dc2626', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {noData && (
        <div style={{
          background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: 12, padding: 32, textAlign: 'center',
        }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 8 }}>
            No simulation data yet
          </div>
          <code style={{
            display: 'block', marginTop: 12, background: '#f1f5f9',
            borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#475569',
          }}>
            python scripts/wttc_simulate.py --gender {gender} --runs 5000 --push
          </code>
        </div>
      )}

      {!loading && data && data.length > 0 && (
        <TeamTable data={data} gender={gender} />
      )}
    </div>
  )
}
