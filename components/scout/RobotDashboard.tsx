import React from 'react';
import { ArrowLeft, Trophy, Calendar, Copy, Check, Download, Brain, Trash2 } from 'lucide-react';
import { computeAggregates, fieldValue, type TemplateField } from '../../shared/scoutingTemplates';
import { ftcSeasonFor } from '../../shared/ftcSeason';

const val = fieldValue;

/** Booleans read better as Yes/No than true/false in record rows. */
const show = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : v ?? '—');

interface RobotDashboardProps {
  selectedRobot: any;
  activeEvent: any;
  robotMatches: any[];
  matchTemplate?: any;
  pitTemplate?: any;
  crossEventMatches: any[];
  /** This team's events this season, from FIRST. */
  seasonEvents: any[];
  seasonEventsLoading: boolean;
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
  crossEventMatches, seasonEvents, seasonEventsLoading,
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
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">{selectedRobot.teamName || 'Unknown Team'}</p>
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

      {(
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

      {seasonEventsLoading ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-6 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-teamColor border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Loading this team's season from FIRST...</p>
        </div>
      ) : seasonEvents.length > 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
          <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Trophy size={14} /> Season Events (FIRST)
          </h3>
          <div className="space-y-2">
            {[...seasonEvents]
              .sort((a: any, b: any) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
              .map((event: any) => {
                const isCurrentEvent = activeEvent?.eventCode && activeEvent.eventCode === event.code;
                return (
                  <div key={event.code} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${isCurrentEvent ? 'border-teamColor bg-teamColor/5' : 'border-slate-100 dark:border-slate-700'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{event.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{event.startDate || 'Date TBA'}{event.location ? ` · ${event.location}` : ''}</p>
                    </div>
                    {isCurrentEvent && <span className="px-2 py-0.5 bg-teamColor text-white text-[8px] font-black uppercase rounded-full flex-shrink-0">Current</span>}
                  </div>
                );
              })}
          </div>
          {activeEvent?.startDate && (
            <a href={`https://ftc-events.firstinspires.org/${ftcSeasonFor(activeEvent.startDate)}/team/${selectedRobot.teamNumber}`} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[9px] font-black text-teamColor hover:opacity-75 uppercase tracking-widest">
              View on FIRST →
            </a>
          )}
        </div>
      ) : null}

      {robotMatches.length > 0 && (() => {
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

      {(() => {
        const otherMatches = crossEventMatches.filter((m: any) => m.eventId !== activeEvent?.id);
        if (otherMatches.length === 0) return null;
        const grouped = new Map<string, any[]>();
        for (const m of otherMatches) {
          const key = m.eventName || `Event ${m.eventId}`;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(m);
        }
        const fields = (matchTemplate?.fields || []) as TemplateField[];
        return (
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-indigo-100 dark:border-indigo-900/40 p-6 md:p-8">
            <h3 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Calendar size={14} />
              Previous Event Data ({otherMatches.length} matches from {grouped.size} event{grouped.size !== 1 ? 's' : ''})
            </h3>
            <div className="space-y-5">
              {Array.from(grouped.entries()).map(([eventName, matches]) => {
                // Only stats this template defines and this event actually recorded —
                // an older event may have been scouted with a different template.
                const stats = computeAggregates(matches, fields).filter(a => a.n > 0);
                const summary = stats.filter(a => a.showInSummary);
                return (
                  <div key={eventName} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-800 dark:text-slate-100">{eventName}</p>
                      <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 text-right">
                        {matches.length} matches{summary.length > 0 && ' • '}
                        {summary.map(a => `${a.prefix ? `${a.prefix} ` : ''}${a.label}: ${a.display}`).join(' · ')}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {[...matches].sort((a: any, b: any) => a.matchNumber - b.matchNumber).map((m: any) => (
                        <div key={m.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${m.alliance === 'Red' ? 'border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-900/10' : 'border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10'}`}>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase flex-shrink-0 ${m.alliance === 'Red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>M{m.matchNumber}</span>
                          <span className="flex-1 text-[10px] font-bold text-slate-600 dark:text-slate-400 truncate">
                            {summary.map(a => `${a.label}: ${show(val(m, a.key))}`).join(' · ') || '—'}
                          </span>
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
