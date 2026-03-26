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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const { data, error: err } = await supabase
          .from('mv_player_selector_singles')
          .select('player_id, player_name, gender, rank, gender_label')
          .order('rank', { ascending: true });

        if (err) throw err;
        setPlayers(data || []);
        if (data && data.length > 0) setSelectedPlayer(data[0].player_id);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  useEffect(() => {
    if (!selectedPlayer) return;

    const fetchFormData = async () => {
      try {
        const { data: form, error: formErr } = await supabase
          .from('mv_player_form_current')
          .select('*')
          .eq('player_id', selectedPlayer)
          .single();

        if (formErr && formErr.code !== 'PGRST116') throw formErr;
        setPlayerForm(form);
      } catch (err) {
        setError(err.message);
      }
    };
    fetchFormData();
  }, [selectedPlayer]);

  if (loading) return <div style={{ padding: '20px' }}>Loading players...</div>;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      <h1>Player Form Analysis</h1>
      <p>Is the player ready for selection?</p>

      <select 
        value={selectedPlayer || ''} 
        onChange={(e) => setSelectedPlayer(parseInt(e.target.value))}
        style={{ padding: '10px', fontSize: '14px', width: '100%', marginBottom: '20px' }}
      >
        <option value="">Choose a player...</option>
        {players.map(p => (
          <option key={p.player_id} value={p.player_id}>
            {p.player_name} ({p.gender_label}) - Rank #{p.rank}
          </option>
        ))}
      </select>

      {error && <div style={{ color: 'red', marginBottom: '20px' }}>Error: {error}</div>}

      {selectedPlayer && playerForm && (
        <div style={{ backgroundColor: '#f0f0f0', padding: '20px', borderRadius: '8px' }}>
          <h2>{playerForm.player_name}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
            <div>
              <p><strong>Win Rate (30 days):</strong> {playerForm.win_rate_30days ? (playerForm.win_rate_30days * 100).toFixed(1) : 'N/A'}%</p>
              <p><strong>Matches (30 days):</strong> {playerForm.matches_30days}</p>
            </div>
            <div>
              <p><strong>Win Rate (60 days):</strong> {playerForm.win_rate_60days ? (playerForm.win_rate_60days * 100).toFixed(1) : 'N/A'}%</p>
              <p><strong>Matches (60 days):</strong> {playerForm.matches_60days}</p>
            </div>
            <div>
              <p><strong>Current Rank:</strong> #{playerForm.current_rank}</p>
              <p><strong>Last Match:</strong> {playerForm.last_match_date ? new Date(playerForm.last_match_date).toLocaleDateString() : 'N/A'}</p>
            </div>
            <div>
              <p><strong>Avg Opponent Rank (6m):</strong> #{playerForm.avg_opponent_rank_6m || 'N/A'}</p>
              <p><strong>Recent Form:</strong> {playerForm.recent_form_10 || 'N/A'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
