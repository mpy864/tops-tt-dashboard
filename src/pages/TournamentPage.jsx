import TournamentSimulator from '../components/TournamentSimulator.jsx'

export default function TournamentPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      padding: '24px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
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

        <TournamentSimulator />

      </div>
    </div>
  )
}
