import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronDown, ChevronUp } from 'lucide-react';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function DynamicOKRDashboard() {
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [playerMetrics, setPlayerMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredPlayers, setFilteredPlayers] = useState([]);
  const [activeTab, setActiveTab] = useState('snapshot');
  const [expandedTournament, setExpandedTournament] = useState(null);

  // Load players
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
        if (data?.length > 0) setSelectedPlayer(data[0].player_id);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  // Calculate metrics when player selected
  useEffect(() => {
    if (!selectedPlayer) return;

    const calculateMetrics = async () => {
      setFetching(true);
      try {
        const { data: matches, error: matchErr } = await supabase
          .from('wtt_matches_singles')
          .select('match_id, comp1_id, comp2_id, result, event_date, event_id, round_phase, game_scores')
          .or(`comp1_id.eq.${selectedPlayer},comp2_id.eq.${selectedPlayer}`)
          .order('event_date', { ascending: false })
          .limit(500);

        if (matchErr) throw matchErr;

        const { data: rankings, error: rankErr } = await supabase
          .from('rankings_singles_normalized')
          .select('rank, ranking_date, points')
          .eq('player_id', selectedPlayer)
          .order('ranking_date', { ascending: false })
          .limit(100);

        if (rankErr) throw rankErr;

        const { data: events } = await supabase
          .from('wtt_events')
          .select('event_id, event_name, event_tier');

        const { data: allPlayers } = await supabase
          .from('wtt_players')
          .select('ittf_id, player_name');

        const metrics = calculateAllMetrics(matches, rankings, events, allPlayers);
        setPlayerMetrics(metrics);
      } catch (err) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };

    calculateMetrics();
  }, [selectedPlayer]);

  const calculateAllMetrics = (matches, rankings, events, allPlayers) => {
    const now = new Date();

    const playerWon = (match) => {
      if (match.comp1_id === selectedPlayer) return match.result === 'W';
      return match.result === 'L';
    };

    const getOpponent = (match) => {
      const opponentId = match.comp1_id === selectedPlayer ? match.comp2_id : match.comp1_id;
      return allPlayers.find(p => p.ittf_id === opponentId);
    };

    const getOpponentRankAtDate = (match) => {
      const rankHistory = rankings.filter(r => new Date(r.ranking_date) <= new Date(match.event_date));
      return rankHistory.length > 0 ? rankHistory[0].rank : 999;
    };

    const get6moMatches = () => matches.filter(m => {
      const d = new Date(m.event_date);
      return (now - d) <= 6 * 30 * 24 * 60 * 60 * 1000;
    });

    const get12moMatches = () => matches.filter(m => {
      const d = new Date(m.event_date);
      return (now - d) <= 12 * 30 * 24 * 60 * 60 * 1000;
    });

    const get18moMatches = () => matches.filter(m => {
      const d = new Date(m.event_date);
      return (now - d) <= 18 * 30 * 24 * 60 * 60 * 1000;
    });

    const calcWinRate = (matchList) => {
      if (matchList.length === 0) return 0;
      return (matchList.filter(m => playerWon(m)).length / matchList.length) * 100;
    };

    const calcUpsetYield = (matchList, playerRank) => {
      const wins = matchList.filter(m => playerWon(m));
      if (wins.length === 0) return 0;
      const upsets = wins.filter(m => getOpponentRankAtDate(m) < playerRank).length;
      return (upsets / wins.length) * 100;
    };

    const calcClutchIndex = (matchList) => {
      const wins = matchList.filter(m => playerWon(m));
      if (wins.length === 0) return 0;
      const clutchWins = wins.filter(m => {
        const gameScores = m.game_scores || '';
        return !gameScores.includes('0-3') && !gameScores.includes('3-0');
      }).length;
      return (clutchWins / wins.length) * 100;
    };

    const calcAvgPointDiff = (matchList) => {
      if (matchList.length === 0) return 0;
      const totalDiff = matchList.reduce((sum, m) => sum + (playerWon(m) ? 3 : -3), 0);
      return totalDiff / matchList.length;
    };

    const matchLedger = matches.map(m => ({
      date: new Date(m.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
      opponent: getOpponent(m)?.player_name || 'Unknown',
      opponentRank: getOpponentRankAtDate(m),
      tournament: events.find(e => e.event_id === m.event_id)?.event_name || 'Unknown',
      round: m.round_phase || 'N/A',
      score: m.game_scores || 'N/A',
      result: playerWon(m) ? 'W' : 'L',
      isUpset: playerWon(m) && getOpponentRankAtDate(m) < rankings[0]?.rank,
      isClutch: playerWon(m) && m.game_scores && !m.game_scores.includes('3-0') && !m.game_scores.includes('0-3'),
    }));

    const m6 = get6moMatches();
    const m12 = get12moMatches();
    const m18 = get18moMatches();
    const playerCurrentRank = rankings[0]?.rank || 999;

    const rankingGraphData = rankings
      .reverse()
      .map(r => ({
        date: new Date(r.ranking_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        rank: r.rank,
      }))
      .slice(-24);

    return {
      ranking: playerCurrentRank,
      rankingChange6mo: rankings[0]?.rank && rankings.find(r => {
        const d = new Date(r.ranking_date);
        return (now - d) > 6 * 30 * 24 * 60 * 60 * 1000;
      })?.rank ? rankings.find(r => {
        const d = new Date(r.ranking_date);
        return (now - d) > 6 * 30 * 24 * 60 * 60 * 1000;
      }).rank - rankings[0].rank : 0,
      winRate6mo: calcWinRate(m6),
      winRate12mo: calcWinRate(m12),
      winRate18mo: calcWinRate(m18),
      upsetYield6mo: calcUpsetYield(m6, playerCurrentRank),
      upsetYield12mo: calcUpsetYield(m12, playerCurrentRank),
      upsetYield18mo: calcUpsetYield(m18, playerCurrentRank),
      clutchIndex6mo: calcClutchIndex(m6),
      clutchIndex12mo: calcClutchIndex(m12),
      clutchIndex18mo: calcClutchIndex(m18),
      avgPtDiff6mo: calcAvgPointDiff(m6),
      avgPtDiff12mo: calcAvgPointDiff(m12),
      avgPtDiff18mo: calcAvgPointDiff(m18),
      matchCount6mo: m6.length,
      matchCount12mo: m12.length,
      matchCount18mo: m18.length,
      rankingGraphData,
      matchLedger: matchLedger.slice(0, 50),
    };
  };

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
    return <div className="p-6 text-gray-600">Loading players...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900">Player Intelligence Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">OKR Framework • Performance Metrics • Real-time Analysis</p>
        </div>

        {/* Search & Select */}
        <div className="mb-6 space-y-3">
          <input
            type="text"
            placeholder="Search player name..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <select
            value={selectedPlayer || ''}
            onChange={(e) => setSelectedPlayer(parseInt(e.target.value))}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <option value="">Select a player...</option>
            {filteredPlayers.map(p => (
              <option key={p.player_id} value={p.player_id}>
                {p.player_name} ({p.gender_label}) - Rank #{p.rank}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-6">{error}</div>}
        {fetching && <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm mb-6">Calculating metrics...</div>}

        {selectedPlayer && playerMetrics && (
          <>
            {/* Snapshot Tier */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-white p-5 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase">World Ranking</p>
                <p className="text-3xl font-semibold text-gray-900">#{playerMetrics.ranking}</p>
                <p className="text-xs text-gray-500 mt-2">{playerMetrics.rankingChange6mo > 0 ? '↓' : '↑'} {Math.abs(playerMetrics.rankingChange6mo)} (6mo)</p>
              </div>

              <div className="bg-white p-5 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase">Upset Yield</p>
                <p className="text-3xl font-semibold text-gray-900">{playerMetrics.upsetYield6mo.toFixed(1)}%</p>
                <p className="text-xs text-gray-500 mt-2">Wins vs higher-ranked</p>
              </div>

              <div className="bg-white p-5 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase">Clutch Index</p>
                <p className="text-3xl font-semibold text-gray-900">{playerMetrics.clutchIndex6mo.toFixed(1)}%</p>
                <p className="text-xs text-gray-500 mt-2">Wins in close matches</p>
              </div>

              <div className="bg-white p-5 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 font-medium mb-1 uppercase">Avg Point Diff</p>
                <p className="text-3xl font-semibold text-gray-900">{playerMetrics.avgPtDiff6mo.toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-2">Points per match</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="flex border-b border-gray-200">
                {['snapshot', 'form', 'ranking', 'matches'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab
                        ? 'border-gray-900 text-gray-900'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {activeTab === 'form' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Win Rate Trend</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <MetricItem label="6 Months" value={`${playerMetrics.winRate6mo.toFixed(1)}%`} detail={`${playerMetrics.matchCount6mo} matches`} />
                        <MetricItem label="12 Months" value={`${playerMetrics.winRate12mo.toFixed(1)}%`} detail={`${playerMetrics.matchCount12mo} matches`} />
                        <MetricItem label="18 Months" value={`${playerMetrics.winRate18mo.toFixed(1)}%`} detail={`${playerMetrics.matchCount18mo} matches`} />
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Upset Yield Trend</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <MetricItem label="6 Months" value={`${playerMetrics.upsetYield6mo.toFixed(1)}%`} detail="% of wins" />
                        <MetricItem label="12 Months" value={`${playerMetrics.upsetYield12mo.toFixed(1)}%`} detail="% of wins" />
                        <MetricItem label="18 Months" value={`${playerMetrics.upsetYield18mo.toFixed(1)}%`} detail="% of wins" />
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Clutch Index Trend</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <MetricItem label="6 Months" value={`${playerMetrics.clutchIndex6mo.toFixed(1)}%`} detail="close wins" />
                        <MetricItem label="12 Months" value={`${playerMetrics.clutchIndex12mo.toFixed(1)}%`} detail="close wins" />
                        <MetricItem label="18 Months" value={`${playerMetrics.clutchIndex18mo.toFixed(1)}%`} detail="close wins" />
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'ranking' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Ranking Position (Last 24 Weeks)</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={playerMetrics.rankingGraphData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6b7280' }} />
                            <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} reversed />
                            <Tooltip contentStyle={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }} />
                            <Line type="monotone" dataKey="rank" stroke="#4b5563" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'matches' && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Match Ledger (Last 50)</h3>
                    {Object.entries(
                      playerMetrics.matchLedger.reduce((acc, m) => {
                        if (!acc[m.tournament]) acc[m.tournament] = [];
                        acc[m.tournament].push(m);
                        return acc;
                      }, {})
                    ).map(([tournament, matches]) => (
                      <div key={tournament} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedTournament(expandedTournament === tournament ? null : tournament)}
                          className="w-full px-4 py-3 bg-gray-50 flex justify-between items-center hover:bg-gray-100 transition-colors"
                        >
                          <span className="text-sm font-medium text-gray-900">{tournament} ({matches.length})</span>
                          {expandedTournament === tournament ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>

                        {expandedTournament === tournament && (
                          <div className="divide-y border-t border-gray-200">
                            <div className="px-4 py-2 bg-gray-50 grid grid-cols-6 gap-4 text-xs text-gray-500 font-medium">
                              <div>Date</div>
                              <div>Opponent</div>
                              <div>Rank</div>
                              <div>Score</div>
                              <div>Round</div>
                              <div>Result</div>
                            </div>
                            {matches.map((m, i) => (
                              <div key={i} className="px-4 py-2.5 grid grid-cols-6 gap-4 text-sm text-gray-700 hover:bg-gray-50">
                                <div>{m.date}</div>
                                <div>{m.opponent}</div>
                                <div>#{m.opponentRank}</div>
                                <div className="font-mono">{m.score}</div>
                                <div>{m.round}</div>
                                <div>
                                  <span className={`px-2 py-1 rounded text-xs font-medium ${m.result === 'W' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                    {m.result}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MetricItem({ label, value, detail }) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{detail}</p>
    </div>
  );
}
