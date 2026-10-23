import React from 'react';
import { ArrowLeft, Trophy, Calendar, Copy, Check, Download, Brain, Trash2 } from 'lucide-react';
import { computeAggregates, fieldValue, type TemplateField } from '../../shared/scoutingTemplates';

const val = fieldValue;

/** Booleans read better as Yes/No than true/false in record rows. */
const show = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : v ?? '—');

interface RobotDashboardProps {
  selectedRobot: any;
  activeEvent: any;
  robotMatches: any[];
  matchTemplate?: any;
  pitTemplate?: any;
  isCustomMatch?: boolean;
  isCustomPit?: boolean;
  crossEventMatches: any[];
  tbaYearEvents: any[];
  tbaYearStatuses: Record<string, any>;
  tbaYearLoading: boolean;
  geminiModal: { open: boolean; text: string; matchLabel: string };
  copiedGemini: boolean;
  onBack: () => void;
  onEditPit: (robot: any) => void;
  onDeletePit: (id: number) => void;
  onGenerateAIReport: () => void;
  onSetGeminiModal: (m: { open: boolean; text: string; matchLabel: string }) => void;
  onSetCopiedGemini: (v: boolean) => void;
  isGuest?: boolean;
}

const RobotDashboard: React.FC<RobotDashboardProps> = ({
  selectedRobot, activeEvent, robotMatches, matchTemplate, pitTemplate,
  isCustomMatch = false, isCustomPit = false, crossEventMatches,
  tbaYearEvents, tbaYearStatuses, tbaYearLoading,
  geminiModal, copiedGemini, onBack, onEditPit, onDeletePit,
  onGenerateAIReport, onSetGeminiModal, onSetCopiedGemini, isGuest = false,
}) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">
          <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
        </button>
        <div className="flex-1">
          <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Team {selectedRobot.teamNumber}</h2>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{selectedRobot.teamName || 'Unknown Team'} • {selectedRobot.robotName || 'Unnamed Robot'}</p>
        </div>
        <button onClick={onGenerateAIReport}
          className="px-4 py-2.5 bg-purple-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 shadow-lg shadow-purple-600/20 transition-all flex items-center gap-2 flex-shrink-0">
          <Copy size={14} /> Copy for AI
        </button>
        {selectedRobot.photoUrl && (
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 flex-shrink-0">
            <img src={selectedRobot.photoUrl} alt={`Team ${selectedRobot.teamNumber}`} className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {isCustomPit && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Robot Data ({pitTemplate?.name || 'custom'})</h3>
            {!isGuest && (
              <div className="flex gap-2">
                <button onClick={() => onEditPit(selectedRobot)} className="px-4 py-2 bg-teamColor text-white font-black rounded-lg uppercase tracking-widest text-[10px] hover:opacity-90">Edit</button>
                <button onClick={() => onDeletePit(selectedRobot.id)} className="px-3 py-2 bg-slate-100 dark:bg-slate-700 text-red-600 font-black rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 size={14} /></button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {((pitTemplate?.fields || []) as TemplateField[]).filter(f => !f.archived && f.key !== 'teamNumber').map(f => {
              const v = val(selectedRobot, f.key);
              if (f.type === 'photo') return v ? (
                <div key={f.key} className="sm:col-span-2 h-40 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700"><img src={v} alt="" className="w-full h-full object-cover" /></div>
              ) : null;
              return (
                <div key={f.key} className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{f.label}</p>
                  {Array.isArray(v) ? (
                    <div className="flex flex-wrap gap-1.5 mt-1">{v.length ? v.map((x: string, i: number) => <span key={i} className="px-2 py-0.5 bg-teamColor/10 text-teamColor rounded-full text-[10px] font-bold">{x}</span>) : <span className="text-sm text-slate-400">—</span>}</div>
                  ) : (
                    <p className="text-sm font-black text-slate-900 dark:text-white mt-1 whitespace-pre-wrap">{f.type === 'boolean' ? (v ? 'Yes' : 'No') : (v ?? '—')}{f.max && typeof v === 'number' ? `/${f.max}` : ''}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isCustomPit && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8 space-y-6">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Robot Specs</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Drivetrain</p>
              <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.drivetrain || '—'}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Weight</p>
              <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.weight ? `${selectedRobot.weight} lbs` : '—'}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Speed</p>
              <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.speed ? `${selectedRobot.speed} ft/s` : '—'}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Height</p>
              <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.height ? `${selectedRobot.height}"` : '—'}</p>
            </div>
            {selectedRobot.shooterType && (
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Shooter</p>
                <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.shooterType}</p>
              </div>
            )}
            {selectedRobot.fuelCapacity > 0 && (
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Fuel Capacity</p>
                <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.fuelCapacity} cells</p>
              </div>
            )}
            {selectedRobot.traversalAbility && (
              <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4 col-span-2">
                <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Field Traversal</p>
                <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{selectedRobot.traversalAbility}</p>
              </div>
            )}
          </div>
          {selectedRobot.autoOptions?.length > 0 && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <p className="text-[9px] font-black text-green-600 uppercase tracking-widest mb-2">Auto Routines Available</p>
              <div className="flex flex-wrap gap-2">
                {selectedRobot.autoOptions.map((a: string, i: number) => (
                  <span key={i} className="px-3 py-1.5 bg-green-100 text-green-800 rounded-full text-xs font-bold">{a}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8 space-y-6">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Ratings</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Offense</span>
              <span className="text-lg font-black text-teamColor">{selectedRobot.offenseRating}/10</span>
            </div>
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Defense</span>
              <span className="text-lg font-black text-blue-600">{selectedRobot.defenseRating}/10</span>
            </div>
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Overall</span>
              <span className="text-lg font-black text-green-600">{selectedRobot.overallRating}/10</span>
            </div>
          </div>
          {!isGuest && (
            <div className="flex gap-2">
              <button onClick={() => onEditPit(selectedRobot)} className="flex-1 py-3 bg-teamColor text-white font-black rounded-xl uppercase tracking-widest text-xs hover:opacity-90 transition-all">
                Edit
              </button>
              <button onClick={() => onDeletePit(selectedRobot.id)} className="px-4 py-3 bg-slate-100 dark:bg-slate-700 text-red-600 font-black rounded-xl hover:bg-red-50 dark:hover:bg-red-900/30 transition-all">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {!isCustomPit && (selectedRobot.capabilities?.length > 0 || selectedRobot.deficiencies?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {selectedRobot.capabilities?.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Capabilities</h3>
              <div className="flex flex-wrap gap-2">
                {selectedRobot.capabilities.map((c: string, i: number) => (
                  <span key={i} className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">{c}</span>
                ))}
              </div>
            </div>
          )}
          {selectedRobot.deficiencies?.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Deficiencies</h3>
              <div className="flex flex-wrap gap-2">
                {selectedRobot.deficiencies.map((d: string, i: number) => (
                  <span key={i} className="px-3 py-1.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-full text-xs font-bold">{d}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!isCustomPit && selectedRobot.notes && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Notes</h3>
          <p className="text-sm text-slate-700 dark:text-slate-300 font-medium whitespace-pre-wrap">{selectedRobot.notes}</p>
        </div>
      )}

      {tbaYearLoading ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-6 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-teamColor border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Loading TBA season data...</p>
        </div>
      ) : tbaYearEvents.length > 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Trophy size={12} className="text-yellow-500" />
            {new Date().getFullYear()} Season Events (via TBA)
          </h3>
          <div className="space-y-3">
            {tbaYearEvents
              .filter((e: any) => e.event_type_string !== 'Offseason')
              .sort((a: any, b: any) => (a.start_date || '').localeCompare(b.start_date || ''))
              .map((event: any) => {
                const status = tbaYearStatuses[`frc${selectedRobot.teamNumber}`] || tbaYearStatuses[event.key];
                const overallStatus = status?.overall_status_str?.replace(/<[^>]*>/g, '') || null;
                const rank = status?.qual?.ranking?.rank;
                const numTeams = status?.qual?.num_teams;
                const record = status?.qual?.ranking?.record;
                const isCurrentEvent = activeEvent?.tbaEventKey === event.key;
                return (
                  <div key={event.key} className={`p-4 rounded-xl border-2 ${isCurrentEvent ? 'border-teamColor/30 dark:border-teamColor/20 bg-teamColor/5 dark:bg-teamColor/5' : 'border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/30'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">{event.name}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold mt-0.5">
                          {event.city && `${event.city}, ${event.state_prov} • `}
                          {event.start_date && new Date(event.start_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          {event.end_date !== event.start_date && ` – ${new Date(event.end_date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                        </p>
                        {overallStatus && <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 mt-1">{overallStatus}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {isCurrentEvent && <span className="px-2 py-0.5 bg-teamColor text-white text-[8px] font-black uppercase rounded-full">Current</span>}
                        {rank && <span className="text-xs font-black text-slate-700 dark:text-slate-300">#{rank}{numTeams ? ` / ${numTeams}` : ''}</span>}
                        {record && <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{record.wins}-{record.losses}-{record.ties}</span>}
                      </div>
                    </div>
                    <a href={`https://www.thebluealliance.com/team/${selectedRobot.teamNumber}/${event.key.substring(0, 4)}`} target="_blank" rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-[9px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest">
                      View on TBA →
                    </a>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      {robotMatches.length > 0 && isCustomMatch && (() => {
        const aggs = computeAggregates(robotMatches, (matchTemplate?.fields || []) as TemplateField[]);
        const summary = aggs.filter(a => a.showInSummary);
        const rest = aggs.filter(a => !a.showInSummary);
        const tile = (a: ReturnType<typeof computeAggregates>[number], highlight: boolean) => (
          <div key={a.key} className={`rounded-xl p-4 text-center ${highlight ? 'bg-teamColor/10' : 'bg-slate-50 dark:bg-slate-700'}`}>
            <p className={`text-2xl font-black ${highlight ? 'text-teamColor' : 'text-slate-900 dark:text-white'}`}>{a.display}</p>
            <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">{a.prefix ? `${a.prefix} ` : ''}{a.label}</p>
            <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">n={a.n}</p>
          </div>
        );
        return (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6">Performance Analysis ({robotMatches.length} matches · {matchTemplate?.name || 'custom template'})</h3>
              {aggs.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No aggregatable fields flagged on this template. Mark numeric fields with an aggregate in the Template Builder.</p>
              ) : (
                <>
                  {summary.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">{summary.map(a => tile(a, true))}</div>}
                  {rest.length > 0 && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-4">{rest.map(a => tile(a, false))}</div>}
                </>
              )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Match History</h3>
              <div className="space-y-2">
                {[...robotMatches].sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0)).map(m => (
                  <div key={`${m.matchType}:${m.matchNumber}:${m.id}`} className={`p-3 rounded-xl border-2 ${m.alliance === 'Red' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20' : 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20'}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${m.alliance === 'Red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>Match {m.matchNumber}</span>
                      <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-600 dark:text-slate-400">
                        {summary.map(a => <span key={a.key}>{a.label}: <b className="text-slate-800 dark:text-slate-200">{show(val(m, a.key))}</b></span>)}
                      </div>
                      {m._scoutCount > 1 && <span className="px-2 py-0.5 bg-slate-200 text-slate-500 rounded-lg text-[8px] font-black">AVG of {m._scoutCount}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {robotMatches.length > 0 && !isCustomMatch && (() => {
        const totalAutoFuel = robotMatches.reduce((s, m) => s + (m.autoFuelTotal || 0), 0);
        const totalTeleopFuel = robotMatches.reduce((s, m) => s + (m.teleopFuelTotal || 0), 0);
        const avgAutoFuel = (totalAutoFuel / robotMatches.length).toFixed(1);
        const avgTeleopFuel = (totalTeleopFuel / robotMatches.length).toFixed(1);
        const avgTotalFuel = ((totalAutoFuel + totalTeleopFuel) / robotMatches.length).toFixed(1);
        const avgAccuracy = robotMatches.filter(m => m.coralScored > 0).length > 0
          ? (robotMatches.reduce((s, m) => s + Math.min(m.coralScored || 0, 5), 0) / robotMatches.filter(m => m.coralScored > 0).length).toFixed(1)
          : '—';
        const climbMatches = robotMatches.filter(m => m.endClimbLevel > 0).length;
        const climbRate = ((climbMatches / robotMatches.length) * 100).toFixed(0);
        const maxClimbLevel = Math.max(...robotMatches.map(m => m.endClimbLevel || 0));
        const avgDriving = robotMatches.filter(m => m.drivingSkillRating > 0).length > 0
          ? (robotMatches.reduce((s, m) => s + (m.drivingSkillRating || 0), 0) / robotMatches.filter(m => m.drivingSkillRating > 0).length).toFixed(1)
          : '—';
        const avgCV = robotMatches.filter(m => m.coreValuesRating > 0).length > 0
          ? (robotMatches.reduce((s, m) => s + (m.coreValuesRating || 0), 0) / robotMatches.filter(m => m.coreValuesRating > 0).length).toFixed(1)
          : '—';
        const totalPenalties = robotMatches.reduce((s, m) => s + (m.penalties || 0), 0);
        const avgPenalties = (totalPenalties / robotMatches.length).toFixed(1);
        const bestMatch = robotMatches.reduce((best, m) => {
          const mTotal = (m.autoFuelTotal || 0) + (m.teleopFuelTotal || 0);
          const bTotal = (best.autoFuelTotal || 0) + (best.teleopFuelTotal || 0);
          return mTotal > bTotal ? m : best;
        }, robotMatches[0]);

        return (
          <>
            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6">Performance Analysis ({robotMatches.length} matches)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-green-600">{avgAutoFuel}</p>
                  <p className="text-[9px] font-black text-green-400 uppercase tracking-widest mt-1">Avg Auto Fuel</p>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-blue-600">{avgTeleopFuel}</p>
                  <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mt-1">Avg Teleop Fuel</p>
                </div>
                <div className="bg-teamColor/5 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-teamColor">{avgTotalFuel}</p>
                  <p className="text-[9px] font-black text-teamColor/70 uppercase tracking-widest mt-1">Avg Total Fuel</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-orange-600">{avgAccuracy}<span className="text-sm">/5</span></p>
                  <p className="text-[9px] font-black text-orange-400 uppercase tracking-widest mt-1">Avg Accuracy</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-4">
                <div className="bg-purple-50 dark:bg-purple-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-purple-600">{climbRate}%</p>
                  <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest mt-1">Climb Rate</p>
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-indigo-600">L{maxClimbLevel}</p>
                  <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-1">Max Climb</p>
                </div>
                <div className="bg-teal-50 dark:bg-teal-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-teal-600">{avgDriving}<span className="text-sm">/5</span></p>
                  <p className="text-[9px] font-black text-teal-400 uppercase tracking-widest mt-1">Avg Driving</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-black text-amber-600">{avgPenalties}</p>
                  <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mt-1">Avg Penalties</p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Best Match</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white mt-1">
                    {bestMatch.matchType && bestMatch.matchType !== 'qualification' ? `${bestMatch.matchType === 'elimination' ? 'Elim' : 'Practice'} ` : ''}Match {bestMatch.matchNumber} — {(bestMatch.autoFuelTotal || 0) + (bestMatch.teleopFuelTotal || 0)} total fuel
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">FIRST Core Values</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{avgCV}/5 avg rating</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-700 rounded-xl p-4">
                  <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Fuel (All Matches)</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white mt-1">{totalAutoFuel + totalTeleopFuel} ({totalAutoFuel} auto + {totalTeleopFuel} teleop)</p>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Match History</h3>
              <div className="space-y-3">
                {robotMatches.sort((a, b) => {
                  if (a.matchType !== b.matchType) {
                    const order: Record<string, number> = { practice: 0, qualification: 1, elimination: 2 };
                    return (order[a.matchType] ?? 1) - (order[b.matchType] ?? 1);
                  }
                  return a.matchNumber - b.matchNumber;
                }).map(m => (
                  <div key={`${m.matchType}:${m.matchNumber}:${m.id}`} className={`p-4 rounded-xl border-2 ${m.alliance === 'Red' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20' : 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase ${m.alliance === 'Red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
                          Match {m.matchNumber}
                        </span>
                        {m.matchType && m.matchType !== 'qualification' && (
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                            m.matchType === 'practice' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' : 'bg-purple-100 text-purple-700'
                          }`}>{m.matchType}</span>
                        )}
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                          {(m.autoFuelTotal || 0) + (m.teleopFuelTotal || 0)} fuel
                          {m.coralScored > 0 && <span className="text-yellow-500 ml-1">{'★'.repeat(Math.min(m.coralScored || 0, 5))}</span>}
                        </span>
                        {m._scoutCount > 1 && (
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-500 rounded-lg text-[8px] font-black">AVG of {m._scoutCount}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {m.endClimbLevel > 0 && (
                          <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-[9px] font-black">Climb L{m.endClimbLevel}</span>
                        )}
                        <span className="text-base font-black text-slate-900 dark:text-white">{(m.autoFuelTotal || 0) + (m.teleopFuelTotal || 0)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {(() => {
        const otherMatches = crossEventMatches.filter((m: any) => m.eventId !== activeEvent?.id);
        if (otherMatches.length === 0) return null;
        const grouped = new Map<string, any[]>();
        for (const m of otherMatches) {
          const key = m.eventName || `Event ${m.eventId}`;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(m);
        }
        return (
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-indigo-100 p-6 md:p-8">
            <h3 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Calendar size={14} />
              Previous Event Data ({otherMatches.length} matches from {grouped.size} event{grouped.size !== 1 ? 's' : ''})
            </h3>
            <div className="space-y-5">
              {Array.from(grouped.entries()).map(([eventName, matches]) => {
                const avg = (field: string) => (matches.reduce((s: number, m: any) => s + (m[field] || 0), 0) / matches.length).toFixed(1);
                return (
                  <div key={eventName} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black text-slate-800">{eventName}</p>
                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500">{matches.length} matches • Avg Fuel: {avg('autoFuelTotal')} auto / {avg('teleopFuelTotal')} teleop</p>
                    </div>
                    <div className="space-y-1.5">
                      {matches.sort((a: any, b: any) => a.matchNumber - b.matchNumber).map((m: any) => (
                        <div key={m.id} className={`flex items-center justify-between p-3 rounded-xl border ${m.alliance === 'Red' ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10' : 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10'}`}>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${m.alliance === 'Red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>M{m.matchNumber}</span>
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Auto: {m.autoFuelTotal || 0} | Teleop: {m.teleopFuelTotal || 0}</span>
                            {m.drivingSkillRating > 0 && <span className="text-yellow-500 text-xs">{'★'.repeat(m.drivingSkillRating)}</span>}
                          </div>
                          <span className="text-sm font-black text-slate-900 dark:text-white">{(m.autoFuelTotal || 0) + (m.teleopFuelTotal || 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {geminiModal.open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-blue-600 rounded-xl flex items-center justify-center">
                  <Brain size={20} className="text-white" />
                </div>
                <div>
                  <p className="font-black text-slate-900 dark:text-white text-sm">{geminiModal.matchLabel.startsWith('Team') ? 'Team Scouting Report' : 'AI Match Analysis'}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">{geminiModal.matchLabel}</p>
                </div>
              </div>
              <button onClick={() => onSetGeminiModal({ open: false, text: '', matchLabel: '' })} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 dark:bg-slate-700 rounded-xl transition-all">
                <span className="text-slate-400 dark:text-slate-500 text-lg">✕</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl p-4">
                <pre className="text-xs text-slate-700 dark:text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{geminiModal.text}</pre>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-700 space-y-3">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold text-center">Copy this prompt and paste it into Google Gemini or ChatGPT for analysis</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(geminiModal.text).then(() => {
                      onSetCopiedGemini(true);
                      setTimeout(() => onSetCopiedGemini(false), 2000);
                    });
                  }}
                  className={`flex-1 py-3 font-black rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${
                    copiedGemini ? 'bg-green-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'
                  }`}
                >
                  {copiedGemini ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy to Clipboard</>}
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([geminiModal.text], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${geminiModal.matchLabel.replace(/\s+/g, '_')}_scout_report.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-3 bg-slate-100 text-slate-700 dark:text-slate-300 font-black rounded-xl hover:bg-slate-200 transition-all"
                >
                  <Download size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RobotDashboard;
