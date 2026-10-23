import React from 'react';
import { X, Calendar, AlertCircle, Zap, Brain } from 'lucide-react';
import { useTeamSettings } from '../../contexts/TeamSettingsContext';
import { computeAggregates, type TemplateField } from '../../shared/scoutingTemplates';

interface PitDisplayProps {
  pitSubTab: 'live' | 'rankings';
  setPitSubTab: (t: 'live' | 'rankings') => void;
  pitDisplayAlerts: any[];
  dismissedPitAlertIds: Set<number>;
  onDismissPitAlert: (id: number) => void;
  /** Re-fetch the schedule, results and rankings from FIRST. */
  onRefreshEventData: () => void;
  /** The event's match template — drives the stats shown per robot. */
  matchTemplate?: { fields: TemplateField[] };
  tbaMatches: any[];
  tbaLoading: boolean;
  tbaRecord: { wins: number; losses: number; ties: number } | null;
  tbaRankings: Map<number, { rank: number; rp: number; record: string }>;
  pitScouts: any[];
  matchScoutsData: any[];
  activeEvent: any;
  isCoachOrCaptain: boolean;
  onOpenRobotByNumber: (num: number) => void;
  onSetSelectedRobot: (r: any) => void;
  onGenerateGeminiReport: (m: any) => void;
}

const PitDisplay: React.FC<PitDisplayProps> = ({
  pitSubTab, setPitSubTab, pitDisplayAlerts, dismissedPitAlertIds, onDismissPitAlert,
  onRefreshEventData, matchTemplate,
  tbaMatches, tbaLoading, tbaRecord, tbaRankings, pitScouts, matchScoutsData,
  activeEvent, isCoachOrCaptain,
  onOpenRobotByNumber, onSetSelectedRobot, onGenerateGeminiReport,
}) => {
  const { settings } = useTeamSettings();
  const teamNumber = settings.teamNumber;
  const myTeamKey = `ftc${teamNumber}`;
  return (
    <div className="space-y-6 md:space-y-8">

      <div className="flex bg-slate-100 dark:bg-slate-700/50 p-1 rounded-xl w-fit">
        {(['live', 'rankings'] as const).map(sub => (
          <button key={sub} onClick={() => setPitSubTab(sub)}
            className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              pitSubTab === sub
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}>
            {sub === 'live' ? '⚡ Live' : '🏆 Rankings'}
          </button>
        ))}
      </div>

      {(() => {
        const now = new Date();
        const undismissed = pitDisplayAlerts.filter(a =>
          !dismissedPitAlertIds.has(a.id) &&
          (!a.expiresAt || new Date(a.expiresAt) > now)
        );
        if (undismissed.length === 0) return null;
        const a = undismissed[0];
        const isSafety = a.type === 'safety';
        const pitBorderColor = isSafety ? 'border-red-600' : 'border-orange-500';
        const pitIconColor = isSafety ? 'text-red-600' : 'text-orange-500';
        const pitBgCard = isSafety ? 'bg-red-600/15' : 'bg-orange-500/15';
        const pitBtnColor = isSafety ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600';
        const pitLabel = isSafety ? 'Safety Alert' : a.type === 'urgent' ? 'Urgent Alert' : 'Pit Display Alert';
        const pitIcon = isSafety ? '⚠' : '!';
        return (
          <div className="fixed inset-0 z-[400] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6">
            <div className={`bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg p-8 text-center shadow-2xl border-t-8 ${pitBorderColor} ring-4 ring-offset-2 ring-offset-black ${isSafety ? 'ring-red-600/40' : 'ring-orange-500/40'}`}>
              <div className="flex justify-end mb-2">
                <button onClick={() => onDismissPitAlert(a.id)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">
                  <span className="text-lg font-black">✕</span>
                </button>
              </div>
              <div className={`w-16 h-16 ${pitBgCard} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                <span className={`text-3xl font-black ${pitIconColor}`}>{pitIcon}</span>
              </div>
              <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${pitIconColor}`}>{pitLabel}</p>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-snug">{a.message}</p>
              {undismissed.length > 1 && (
                <p className="text-xs text-slate-400 font-bold mt-3">{undismissed.length - 1} more alert{undismissed.length > 2 ? 's' : ''} pending</p>
              )}
              <button onClick={() => onDismissPitAlert(a.id)}
                className={`mt-6 px-8 py-3 font-black text-sm uppercase tracking-widest rounded-2xl text-white transition-all ${pitBtnColor}`}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })()}

      {pitSubTab === 'live' && (
        <div className="grid grid-cols-1 gap-6 2xl:gap-8">

          <div className="space-y-4">
            {activeEvent?.eventCode && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg md:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Event Schedule</h3>
                  <button onClick={onRefreshEventData} className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all">
                    Refresh
                  </button>
                </div>

                {tbaLoading ? (
                  <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">Loading schedule...</div>
                ) : (() => {
                  const teamMatches = tbaMatches
                    .filter((m: any) =>
                      m.alliances?.red?.team_keys?.includes(myTeamKey) ||
                      m.alliances?.blue?.team_keys?.includes(myTeamKey)
                    )
                    .sort((a: any, b: any) => {
                      if (a.predicted_time && b.predicted_time) return a.predicted_time - b.predicted_time;
                      if (a.time && b.time) return a.time - b.time;
                      return (a.match_number || 0) - (b.match_number || 0);
                    });

                  const isPlayed = (m: any) => {
                    if (m.actual_time) return true;
                    const redScore = m.alliances?.red?.score;
                    const blueScore = m.alliances?.blue?.score;
                    return redScore !== null && redScore !== undefined && redScore >= 0 &&
                           blueScore !== null && blueScore !== undefined && blueScore >= 0;
                  };
                  const playedMatches = teamMatches.filter(isPlayed);
                  const upcomingMatches = teamMatches.filter((m: any) => !isPlayed(m));

                  const getMatchLabel = (m: any) => {
                    const compLevel = m.comp_level || 'qm';
                    const num = m.match_number || 0;
                    const set = m.set_number || 0;
                    if (compLevel === 'qm') return `Qual ${num}`;
                    if (compLevel === 'qf') return `QF ${set}-${num}`;
                    if (compLevel === 'sf') return `SF ${set}-${num}`;
                    if (compLevel === 'f') return `Final ${num}`;
                    return `Match ${num}`;
                  };

                  const getOurAlliance = (m: any) => {
                    if (m.alliances?.red?.team_keys?.includes(myTeamKey)) return 'red';
                    return 'blue';
                  };

                  const renderTeamLink = (teamKey: string) => {
                    const num = parseInt(teamKey.replace('ftc', ''));
                    const hasScouted = pitScouts.some((ps: any) => ps.teamNumber === num);
                    return (
                      <span key={teamKey} onClick={(e) => { e.stopPropagation(); if (hasScouted) onOpenRobotByNumber(num); }}
                        className={`${hasScouted ? 'text-teamColor underline cursor-pointer hover:opacity-70' : 'text-slate-700 dark:text-slate-300'} font-black`}>
                        {num}
                      </span>
                    );
                  };

                  return (
                    <div className="space-y-6">
                      {upcomingMatches.length > 0 && (
                        <div>
                          <h4 className="text-xs font-black text-teamColor uppercase tracking-widest mb-3 flex items-center gap-2">
                            <span className="w-2 h-2 bg-teamColor rounded-full animate-pulse" />
                            Up Next
                          </h4>
                          <div className="space-y-2">
                            {upcomingMatches.slice(0, 10).map((m: any) => {
                              const ourAlliance = getOurAlliance(m);
                              const partnerKeys = (m.alliances?.[ourAlliance]?.team_keys || []).filter((t: string) => t !== myTeamKey);
                              const opponentKeys = (m.alliances?.[ourAlliance === 'red' ? 'blue' : 'red']?.team_keys || []);
                              const time = m.predicted_time || m.time;
                              return (
                                <div key={m.key} className={`p-4 rounded-xl border-2 ${ourAlliance === 'red' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20' : 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20'}`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase ${ourAlliance === 'red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                                        {getMatchLabel(m)}
                                      </span>
                                      <div>
                                        <p className="text-sm text-slate-900 dark:text-white flex items-center gap-1">
                                          <span className="text-slate-400 dark:text-slate-500 text-xs">w/</span>
                                          {partnerKeys.length > 0 ? partnerKeys.map((t: string, i: number) => (
                                            <span key={t}>{i > 0 && <span className="text-slate-300">, </span>}{renderTeamLink(t)}</span>
                                          )) : '—'}
                                        </p>
                                        <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                          <span className="text-slate-400 dark:text-slate-500">vs</span>
                                          {opponentKeys.length > 0 ? opponentKeys.map((t: string, i: number) => (
                                            <span key={t}>{i > 0 && <span className="text-slate-300">, </span>}{renderTeamLink(t)}</span>
                                          )) : '—'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {time && (
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                          {new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                        </span>
                                      )}
                                      <button onClick={() => onGenerateGeminiReport(m)} title="Generate AI match analysis"
                                        className="flex items-center gap-1 px-2.5 py-1.5 bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-lg text-[9px] font-black hover:from-violet-700 hover:to-blue-700 transition-all active:scale-95">
                                        <Brain size={11} /> AI
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {playedMatches.length > 0 && (
                        <div>
                          <h4 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Completed Matches</h4>
                          <div className="space-y-2">
                            {playedMatches.map((m: any) => {
                              const ourAlliance = getOurAlliance(m);
                              const didWin = m.winning_alliance === ourAlliance;
                              const didTie = m.winning_alliance === '';
                              const ourScore = m.alliances?.[ourAlliance]?.score ?? '—';
                              const theirScore = m.alliances?.[ourAlliance === 'red' ? 'blue' : 'red']?.score ?? '—';
                              return (
                                <div key={m.key} className={`p-4 rounded-xl border-2 ${
                                  didWin ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20' : didTie ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-900/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/30'
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase ${ourAlliance === 'red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                                        {getMatchLabel(m)}
                                      </span>
                                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                                        didWin ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : didTie ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                      }`}>
                                        {didWin ? 'WIN' : didTie ? 'TIE' : 'LOSS'}
                                      </span>
                                    </div>
                                    <span className="text-lg font-black text-slate-900 dark:text-white">{ourScore} – {theirScore}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {teamMatches.length === 0 && (
                        <div className="py-12 text-center">
                          <Calendar size={40} className="text-slate-200 mx-auto mb-3" />
                          <p className="text-sm font-black text-slate-300 uppercase tracking-tight">No schedule available yet</p>
                          <p className="text-xs text-slate-400 mt-1">The match schedule appears once FIRST posts it</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {!activeEvent?.eventCode && (
              <div className="bg-yellow-50 dark:bg-yellow-900/30 rounded-2xl md:rounded-[32px] border-2 border-yellow-200 dark:border-yellow-700 p-6 md:p-8 text-center">
                <Calendar size={32} className="text-yellow-500 mx-auto mb-3" />
                <p className="text-sm font-black text-yellow-800 uppercase tracking-tight">No FIRST Event Code</p>
                <p className="text-xs text-yellow-600 mt-1">Open Event Settings and add the event's FIRST code to see the live schedule and win/loss record</p>
              </div>
            )}
          </div>
        </div>
      )}

      {pitSubTab === 'rankings' && (
        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h3 className="text-lg md:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                <span>Event Rankings</span>
                {activeEvent?.eventCode && (
                  <span className="text-[9px] font-black text-teamColor uppercase tracking-widest bg-teamColor/10 px-3 py-1.5 rounded-lg">FIRST Live</span>
                )}
              </h3>
              {tbaRecord && (
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Team {teamNumber}</span>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-black text-xs rounded-lg">{tbaRecord.wins}W</span>
                    <span className="px-2.5 py-1 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-black text-xs rounded-lg">{tbaRecord.losses}L</span>
                    {tbaRecord.ties > 0 && (
                      <span className="px-2.5 py-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 font-black text-xs rounded-lg">{tbaRecord.ties}T</span>
                    )}
                  </div>
                </div>
              )}
            </div>
            {tbaRankings.size === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-black text-slate-300 uppercase tracking-tight">No rankings yet</p>
                <p className="text-xs text-slate-400 mt-1">Rankings will appear once qualifying matches have begun</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-700">
                      <th className="pb-3 text-left text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest w-16">Rank</th>
                      <th className="pb-3 text-left text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Team</th>
                      <th className="pb-3 text-right text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest w-16">RP</th>
                      <th className="pb-3 text-right text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest w-24">Record</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                    {Array.from(tbaRankings.entries())
                      .sort((a, b) => a[1].rank - b[1].rank)
                      .map(([teamNum, r]) => {
                        const isOurTeam = teamNum === teamNumber;
                        return (
                          <tr key={teamNum} className={`transition-colors ${isOurTeam ? 'bg-teamColor/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                            <td className="py-2.5 pr-4">
                              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-black ${
                                r.rank === 1 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' :
                                r.rank === 2 ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300' :
                                r.rank === 3 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300' :
                                'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                              }`}>{r.rank}</span>
                            </td>
                            <td className="py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={`font-black ${isOurTeam ? 'text-teamColor' : 'text-slate-900 dark:text-white'}`}>Team {teamNum}</span>
                                {isOurTeam && <span className="px-2 py-0.5 bg-teamColor text-white text-[9px] font-black rounded uppercase tracking-widest">Us</span>}
                              </div>
                            </td>
                            <td className="py-2.5 text-right">
                              <span className={`text-xs font-black tabular-nums ${isOurTeam ? 'text-teamColor' : 'text-slate-700 dark:text-slate-300'}`}>{r.rp.toFixed(2)}</span>
                            </td>
                            <td className="py-2.5 text-right">
                              <span className="text-xs font-bold text-slate-600 dark:text-slate-400 tabular-nums">{r.record}</span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {pitScouts.length > 0 && (() => {
            const hasRankings = tbaRankings.size > 0;
            const fields = (matchTemplate?.fields || []) as TemplateField[];
            const statsByTeam = new Map(pitScouts.map((ps: any) => [
              ps.teamNumber,
              computeAggregates(matchScoutsData.filter((m: any) => m.teamNumber === ps.teamNumber), fields).filter(a => a.n > 0),
            ]));
            // Without official rankings, order by the template's Rank metric.
            const rankValue = (team: number) => statsByTeam.get(team)?.find(a => a.rankMetric)?.value ?? -1;
            const sorted = [...pitScouts].sort((a: any, b: any) => {
              if (hasRankings) {
                const aRank = tbaRankings.get(a.teamNumber);
                const bRank = tbaRankings.get(b.teamNumber);
                if (aRank && bRank) return aRank.rank - bRank.rank;
                if (aRank) return -1;
                if (bRank) return 1;
              }
              return rankValue(b.teamNumber) - rankValue(a.teamNumber);
            });
            return (
              <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg md:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {hasRankings ? 'Event Rankings' : 'Scouted Robot Leaderboard'}
                  </h3>
                  {hasRankings && (
                    <span className="text-[9px] font-black text-teamColor uppercase tracking-widest bg-teamColor/10 px-3 py-1.5 rounded-lg">FIRST Ranking Points</span>
                  )}
                </div>
                <div className="space-y-3">
                  {sorted.map((ps: any, idx: number) => {
                    const ranking = tbaRankings.get(ps.teamNumber);
                    const summary = (statsByTeam.get(ps.teamNumber) || []).filter(a => a.showInSummary).slice(0, 3);
                    return (
                      <div key={ps.id} onClick={() => onSetSelectedRobot(ps)}
                        className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 cursor-pointer hover:border-teamColor/40 hover:bg-teamColor/5 transition-all">
                        <span className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl font-black text-lg ${
                          idx === 0 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' :
                          idx === 1 ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300' :
                          idx === 2 ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' :
                          'bg-slate-100 text-slate-400'
                        }`}>
                          {ranking ? `#${ranking.rank}` : idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-base md:text-lg font-black text-slate-900 dark:text-white truncate">
                            Team {ps.teamNumber} {ps.teamName ? `— ${ps.teamName}` : ''}
                          </p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold truncate">
                            {ranking ? `${ranking.record} • ${ranking.rp.toFixed(2)} RP` : (ps.data?.drivetrain || ps.drivetrain || 'Not yet ranked')}
                          </p>
                        </div>
                        <div className="flex gap-2 md:gap-3 flex-shrink-0">
                          {summary.length > 0 ? summary.map(a => (
                            <div key={a.key} className="px-2.5 py-1.5 bg-teamColor/10 text-center rounded-lg max-w-[6rem]">
                              <p className="text-sm font-black text-teamColor">{a.display}</p>
                              <p className="text-[8px] font-black text-slate-400 uppercase truncate" title={a.label}>{a.label}</p>
                            </div>
                          )) : (
                            <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 rounded-lg text-[9px] font-black">No match data</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default PitDisplay;
