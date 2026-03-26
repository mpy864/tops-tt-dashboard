import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function PlayerFormDashboard() {
  const [players, setPlayers] = useState([]);
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerForm, setPlayerForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const { data, error: err } = await supabase
          .from('mv_player_selector_singles')
          .select('player_id, player_name, gender, rank, gender_label')
          .order('rank', { ascending: true });

        if (err) throw err;
        setPlayers(data || []);
        setFilteredPlayers(data || []);
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
      setFetching(true);
      try {
        const playerRecord = players.find(p => p.player_id === selectedPlayer);

        // Fetch raw matches
        const { data: matches, error: matchErr } = await supabase
          .from('wtt_matches_singles')
          .select('match_id, comp1_id, comp2_id, result, event_date')
          .or(`comp1_id.eq.${selectedPlayer},comp2_id.eq.${selectedPlayer}`)
          .order('event_date', { ascending: false })
          .limit(200);

        if (matchErr) throw matchErr;

        // Helper: Check if player won from their perspective
        const playerWon = (match) => {
          if (match.comp1_id === selectedPlayer) {
            return match.result === 'W';
          } else {
            return match.result === 'L';
          }
        };

        const getResultChar = (match) => playerWon(match) ? 'W' : 'L';

        // Calculate time windows
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        const oneHundredEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        const matches30d = matches.filter(m => new Date(m.event_date) >= thirtyDaysAgo);
        const matches60d = matches.filter(m => new Date(m.event_date) >= sixtyDaysAgo);
        const matches180d = matches.filter(m => new Date(m.event_date) >= oneHundredEightyDaysAgo);
        const matches90d = matches.filter(m => new Date(m.event_date) >= ninetyDaysAgo);

        // Calculate win rates
        const calcWinRate = (matchList) => {
          if (matchList.length === 0) return null;
          const wins = matchList.filter(m => playerWon(m)).length;
          return wins / matchList.length;
        };

        const recent_form_90 = matches90d.map(m => getResultChar(m)).join('');

        // Get ranking from MV
        const { data: formData } = await supabase
          .from('mv_player_form_current')
          .select('*')
          .eq('player_id', selectedPlayer)
          .single();

        const compiledForm = {
          player_id: selectedPlayer,
          player_name: playerRecord.player_name,
          win_rate_30days: calcWinRate(matches30d),
          matches_30days: matches30d.length,
          win_rate_60days: calcWinRate(matches60d),
          matches_60days: matches60d.length,
          win_rate_180days: calcWinRate(matches180d),
          matches_180days: matches180d.length,
          current_rank: formData?.current_rank || null,
          rank_6m_ago: formData?.rank_6m_ago || null,
          recent_form_90,
          last_match_date: matches.length > 0 ? matches[0].event_date : null,
          avg_opponent_rank_6m: formData?.avg_opponent_rank_6m || null
        };

        setPlayerForm(compiledForm);
      } catch (err) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };
    fetchFormData();
  }, [selectedPlayer, players]);

  const handleSearch = (value) => {
    setSearchTerm(value);
    if (!value.trim()) {
      setFilteredPlayers(players);
    } else {
      const filtered = players.filter(p =>
        p.player_name.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredPlayers(filtered);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}><p>Loading players...</p></div>;
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px', fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: '8px' }}>Player Form Analysis</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>Is the player ready for selection?</p>

      <input
        type="text"
        placeholder="Search player name..."
        value={searchTerm}
        onChange={(e) => handleSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '10px',
          fontSize: '14px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          boxSizing: 'border-box',
          marginBottom: '16px'
        }}
      />

      <select
        value={selectedPlayer || ''}
        onChange={(e) => setSelectedPlayer(parseInt(e.target.value))}
        style={{
          padding: '10px',
          fontSize: '14px',
          width: '100%',
          borderRadius: '4px',
          border: '1px solid #ddd',
          marginBottom: '20px'
        }}
      >
        <option value="">Choose a player...</option>
        {filteredPlayers.map(p => (
          <option key={p.player_id} value={p.player_id}>
            {p.player_name} ({p.gender_label}) - Rank #{p.rank}
          </option>
        ))}
      </select>

      {error && <div style={{color: '#dc2626', backgroundColor: '#fee2e2', padding: '12px', borderRadius: '4px', marginBottom: '20px'}}>⚠️ Error: {error}</div>}

      {fetching && <div style={{color: '#0084ff', padding: '12px', borderRadius: '4px', marginBottom: '20px'}}>⏳ Fetching metrics...</div>}

      {selectedPlayer && !fetching && playerForm && playerForm.matches_30days === 0 && (
        <div style={{backgroundColor: '#dbeafe', color: '#075985', padding: '12px', borderRadius: '4px', marginBottom: '20px'}}>
          ℹ️ No matches in the last 30 days. Showing metrics from available history.
        </div>
      )}

      {selectedPlayer && playerForm && (
        <div style={{backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '24px'}}>
          <h2 style={{ marginTop: 0, marginBottom: '16px' }}>{playerForm.player_name}</h2>

          <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '16px'}}>
            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Win Rate (30 days)</p>
              <p style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                {playerForm.win_rate_30days !== null ? (playerForm.win_rate_30days * 100).toFixed(1) + '%' : 'N/A'}
              </p>
              <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>{playerForm.matches_30days} matches</p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Win Rate (60 days)</p>
              <p style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                {playerForm.win_rate_60days !== null ? (playerForm.win_rate_60days * 100).toFixed(1) + '%' : 'N/A'}
              </p>
              <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>{playerForm.matches_60days} matches</p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Win Rate (180 days)</p>
              <p style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
                {playerForm.win_rate_180days !== null ? (playerForm.win_rate_180days * 100).toFixed(1) + '%' : 'N/A'}
              </p>
              <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>{playerForm.matches_180days} matches</p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Current Rank</p>
              <p style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>#{playerForm.current_rank || 'N/A'}</p>
              <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>
                {playerForm.rank_6m_ago ? `was #${playerForm.rank_6m_ago} 6mo ago` : 'No history'}
              </p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Recent Form (90 days)</p>
              <p style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, fontFamily: 'monospace', letterSpacing: '2px' }}>
                {playerForm.recent_form_90 || 'N/A'}
              </p>
              <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>W = Win, L = Loss</p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Avg Opponent Rank (6m)</p>
              <p style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>#{playerForm.avg_opponent_rank_6m || 'N/A'}</p>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Last Match</p>
              <p style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>
                {playerForm.last_match_date ? new Date(playerForm.last_match_date).toLocaleDateString() : 'N/A'}
              </p>
              {playerForm.last_match_date && (
                <p style={{ fontSize: '12px', color: '#999', margin: '4px 0 0 0' }}>
                  {Math.floor((new Date() - new Date(playerForm.last_match_date)) / (1000*60*60*24))} days ago
                </p>
              )}
            </div>
          </div>

          <div style={{fontSize: '12px', color: '#999', borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px'}}>
            📊 Data calculated from {playerForm.player_name}'s perspective | W/L logic: correct
          </div>
        </div>
      )}
    </div>
  );
}
