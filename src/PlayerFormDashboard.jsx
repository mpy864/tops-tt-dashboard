import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function PlayerFormDashboard() {
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerForm, setPlayerForm] = useState(null);
  const [playerVsTop, setPlayerVsTop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch list of Indian players on mount
  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const { data, error: err } = await supabase
          .from('mv_player_selector_singles')
          .select('player_id, player_name, gender, rank, gender_label')
          .order('rank', { ascending: true });

        if (err) throw err;
        
        setPlayers(data || []);
        
        // Auto-select Manav if available
        const manav = data?.find(p => p.player_name?.includes('Vikash'));
        if (manav) setSelectedPlayer(manav.player_id);
        else if (data && data.length > 0) setSelectedPlayer(data[0].player_id);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayers();
  }, []);

  // Fetch form data when player is selected
  useEffect(() => {
    if (!selectedPlayer) return;

    const fetchFormData = async () => {
      try {
        setLoading(true);
        
        // Fetch form data
        const { data: form, error: formErr } = await supabase
          .from('mv_player_form_current')
          .select('*')
          .eq('player_id', selectedPlayer)
          .single();

        // Fetch vs top opponents data
        const { data: vsTop, error: topErr } = await supabase
          .from('mv_player_vs_top_opponents')
          .select('*')
          .eq('player_id', selectedPlayer)
          .single();

        if (formErr && formErr.code !== 'PGRST116') throw formErr;
        if (topErr && topErr.code !== 'PGRST116') throw topErr;

        setPlayerForm(form);
        setPlayerVsTop(vsTop);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFormData();
  }, [selectedPlayer]);

  if (loading && !selectedPlayer) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Player Form Analysis</h1>
        <p style={styles.subtitle}>Is the player ready for selection? Can they reach Semifinals?</p>
      </div>

      {/* Player Selector */}
      <div style={styles.selectorSection}>
        <label style={styles.label}>Select Player:</label>
        <select 
          value={selectedPlayer || ''} 
          onChange={(e) => setSelectedPlayer(parseInt(e.target.value))}
          style={styles.select}
        >
          <option value="">Choose a player...</option>
          {players.map(player => (
            <option key={player.player_id} value={player.player_id}>
              {player.player_name} ({player.gender_label}) - Rank #{player.rank}
            </option>
          ))}
        </select>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {selectedPlayer && playerForm && (
        <>
          {/* Quick Recommendation */}
          <div style={styles.recommendationBox}>
            <h2 style={styles.sectionTitle}>Ready for Selection?</h2>
            <div style={styles.recommendation}>
              <RecommendationBadge form={playerForm} vsTop={playerVsTop} />
            </div>
          </div>

          {/* Win Rate Comparison */}
          <div style={styles.metricsGrid}>
            <MetricCard
              title="Win Rate - Last 30 Days"
              value={playerForm.win_rate_30days}
              matches={playerForm.matches_30days}
              format="percentage"
            />
            <MetricCard
              title="Win Rate - Last 60 Days"
              value={playerForm.win_rate_60days}
              matches={playerForm.matches_60days}
              format="percentage"
            />
            <MetricCard
              title="Win Rate - Last 180 Days"
              value={playerForm.win_rate_180days}
              matches={playerForm.matches_180days}
              format="percentage"
            />
            <MetricCard
              title="Ranking Change (6 months)"
              value={playerForm.rank_6m_ago && playerForm.current_rank ? playerForm.rank_6m_ago - playerForm.current_rank : 0}
              current={playerForm.current_rank}
              format="ranking"
            />
          </div>

          {/* Opponent Quality */}
          <div style={styles.infoSection}>
            <h3 style={styles.sectionTitle}>Opponent Quality</h3>
            <div style={styles.infoGrid}>
              <InfoItem 
                label="Avg Opponent Rank (6m)"
                value={playerForm.avg_opponent_rank_6m ? `#${playerForm.avg_opponent_rank_6m}` : 'N/A'}
              />
              <InfoItem 
                label="Current Ranking"
                value={playerForm.current_rank ? `#${playerForm.current_rank}` : 'N/A'}
              />
              <InfoItem 
                label="Last Match"
                value={playerForm.last_match_date ? new Date(playerForm.last_match_date).toLocaleDateString() : 'N/A'}
              />
            </div>
          </div>

          {/* Recent Form Sequence */}
          {playerForm.recent_form_10 && (
            <div style={styles.infoSection}>
              <h3 style={styles.sectionTitle}>Recent Form (Last 10 Matches)</h3>
              <div style={styles.formSequence}>
                {playerForm.recent_form_10.split('').map((result, idx) => (
                  <div
                    key={idx}
                    style={{
                      ...styles.formMatch,
                      backgroundColor: result === 'W' ? '#10b981' : '#ef4444'
                    }}
                    title={`Match ${idx + 1}: ${result === 'W' ? 'Win' : 'Loss'}`}
                  >
                    {result}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Performance vs Top Players */}
          {playerVsTop && (
            <div style={styles.infoSection}>
              <h3 style={styles.sectionTitle}>Performance vs Top Players (Last 6 Months)</h3>
              <div style={styles.infoGrid}>
                <InfoItem 
                  label="vs Top 20"
                  value={playerVsTop.matches_vs_top20 > 0 ? `${playerVsTop.wins_vs_top20}W - ${playerVsTop.matches_vs_top20 - playerVsTop.wins_vs_top20}L` : 'No matches'}
                  subtext={playerVsTop.matches_vs_top20 > 0 ? 
                    `${((playerVsTop.wins_vs_top20 / playerVsTop.matches_vs_top20) * 100).toFixed(0)}% win rate` : 
                    ''
                  }
                />
                <InfoItem 
                  label="vs Top 50"
                  value={playerVsTop.matches_vs_top50 > 0 ? `${playerVsTop.wins_vs_top50}W - ${playerVsTop.matches_vs_top50 - playerVsTop.wins_vs_top50}L` : 'No matches'}
                  subtext={playerVsTop.matches_vs_top50 > 0 ? 
                    `${((playerVsTop.wins_vs_top50 / playerVsTop.matches_vs_top50) * 100).toFixed(0)}% win rate` : 
                    ''
                  }
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Recommendation Badge Component
function RecommendationBadge({ form, vsTop }) {
  let status = 'MONITOR';
  let color = '#f59e0b';
  let message = 'Monitor performance';

  if (form.win_rate_60days >= 0.65 && form.avg_opponent_rank_6m <= 40) {
    status = 'READY';
    color = '#10b981';
    message = '✓ Player is in excellent form';
  } else if (form.win_rate_60days >= 0.55 && form.avg_opponent_rank_6m <= 50) {
    status = 'LIKELY';
    color = '#06b6d4';
    message = '≈ Player showing positive trend';
  }

  if (vsTop && vsTop.matches_vs_top20 > 0) {
    const topWinRate = vsTop.wins_vs_top20 / vsTop.matches_vs_top20;
    if (topWinRate < 0.3) {
      status = 'CAUTION';
      color = '#ef4444';
      message = '⚠ Struggles against top 20 players';
    }
  }

  return (
    <div style={{
      ...styles.badge,
      backgroundColor: color,
      borderLeftColor: color
    }}>
      <div style={styles.badgeStatus}>{status}</div>
      <div style={styles.badgeMessage}>{message}</div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ title, value, matches, current, format }) {
  let displayValue = 'N/A';
  
  if (format === 'percentage' && value) {
    displayValue = `${(value * 100).toFixed(1)}%`;
  } else if (format === 'ranking' && value !== undefined) {
    displayValue = value > 0 ? `↑ ${value}` : value < 0 ? `↓ ${Math.abs(value)}` : 'Stable';
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardValue}>{displayValue}</div>
      {matches !== undefined && (
        <div style={styles.cardSubtext}>{matches} matches</div>
      )}
      {current !== undefined && (
        <div style={styles.cardSubtext}>Current: #{current}</div>
      )}
    </div>
  );
}

// Info Item Component
function InfoItem({ label, value, subtext }) {
  return (
    <div style={styles.infoItem}>
      <div style={styles.infoLabel}>{label}</div>
      <div style={styles.infoValue}>{value}</div>
      {subtext && <div style={styles.infoSubtext}>{subtext}</div>}
    </div>
  );
}

// Styles
const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    backgroundColor: '#f8fafc',
    minHeight: '100vh'
  },

  header: {
    marginBottom: '32px',
    textAlign: 'center'
  },

  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#1e293b',
    margin: '0 0 8px 0'
  },

  subtitle: {
    fontSize: '14px',
    color: '#64748b',
    margin: '0'
  },

  selectorSection: {
    backgroundColor: 'white',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },

  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#334155',
    marginBottom: '8px'
  },

  select: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    backgroundColor: 'white',
    color: '#1e293b',
    cursor: 'pointer'
  },

  loading: {
    textAlign: 'center',
    padding: '48px 24px',
    fontSize: '16px',
    color: '#64748b'
  },

  errorBox: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '12px 16px',
    borderRadius: '6px',
    marginBottom: '16px',
    fontSize: '14px'
  },

  recommendationBox: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '8px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },

  badge: {
    borderLeft: '4px solid',
    padding: '16px',
    backgroundColor: '#f0fdf4',
    borderRadius: '4px'
  },

  badgeStatus: {
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#1e293b',
    letterSpacing: '0.05em',
    marginBottom: '4px'
  },

  badgeMessage: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1e293b'
  },

  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },

  card: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },

  cardTitle: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#64748b',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },

  cardValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: '8px'
  },

  cardSubtext: {
    fontSize: '12px',
    color: '#94a3b8'
  },

  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1e293b',
    margin: '0 0 16px 0'
  },

  infoSection: {
    backgroundColor: 'white',
    padding: '24px',
    borderRadius: '8px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },

  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '24px'
  },

  infoItem: {
    paddingBottom: '16px',
    borderBottom: '1px solid #e2e8f0'
  },

  infoLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#64748b',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },

  infoValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1e293b'
  },

  infoSubtext: {
    fontSize: '12px',
    color: '#94a3b8',
    marginTop: '4px'
  },

  formSequence: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },

  formMatch: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: 'white',
    cursor: 'pointer'
  },

  recommendation: {
    marginTop: '12px'
  }
};