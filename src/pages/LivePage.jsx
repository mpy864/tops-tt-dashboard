import LiveProbability from '../components/LiveProbability.jsx'

export default function LivePage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      padding: '24px 16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <span style={{
            background: '#ef4444',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            padding: '3px 8px',
            borderRadius: 4,
          }}>● LIVE</span>
          <h1 style={{
            color: '#0f172a',
            fontSize: 20,
            fontWeight: 700,
            margin: 0,
          }}>
            Match Probability
          </h1>
        </div>

        <LiveProbability />

      </div>
    </div>
  )
}
