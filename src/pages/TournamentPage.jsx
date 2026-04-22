import { useState } from 'react'
import TournamentSimulator from '../components/TournamentSimulator.jsx'
import GroupDecisionTree from '../components/GroupDecisionTree.jsx'

export default function TournamentPage() {
  const [gender, setGender] = useState('M')
  const [tab, setTab] = useState('odds')

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      padding: '24px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 28 }}>🏆</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                ITTF WTTC 2026 — Tournament Simulator
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b', marginTop: 2 }}>
                London, April 28 – May 10, 2026 &nbsp;·&nbsp; V8 MatchPredictor &nbsp;·&nbsp; Monte Carlo
              </p>
            </div>
          </div>

          {/* Info banner */}
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 10, padding: '10px 16px',
            fontSize: 12, color: '#1d4ed8', display: 'flex', gap: 20, flexWrap: 'wrap',
          }}>
            <span>64 teams per gender</span>
            <span>16 groups · Prelim Round · Main Draw (R32→Final)</span>
            <span>5 rubbers per tie (first to 3)</span>
            <span>Probabilities from 5,000+ simulations</span>
          </div>
        </div>

        {/* Controls: gender + tab in one row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Gender selector */}
          <div style={{ display: 'flex', gap: 6 }}>
            {['M', 'W'].map(g => (
              <button key={g} onClick={() => setGender(g)} style={{
                padding: '7px 22px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: gender === g ? '#0f172a' : '#f1f5f9',
                color: gender === g ? '#fff' : '#64748b',
              }}>
                {g === 'M' ? "Men's" : "Women's"}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 28, background: '#e2e8f0', flexShrink: 0 }} />

          {/* Tab selector */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { key: 'odds', label: '📊 Tournament Odds' },
              { key: 'groups', label: '🔢 Group Breakdown' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '7px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: tab === key ? '#6366f1' : '#f1f5f9',
                color: tab === key ? '#fff' : '#64748b',
              }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {tab === 'odds' && <TournamentSimulator gender={gender} />}
        {tab === 'groups' && <GroupDecisionTree gender={gender} />}

      </div>
    </div>
  )
}
