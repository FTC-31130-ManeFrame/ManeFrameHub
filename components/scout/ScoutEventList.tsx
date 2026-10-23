import React from 'react';
import { Plus, X, Trophy, MapPin, Calendar, Check, AlertCircle, Brain, Copy, Download, Layers } from 'lucide-react';

interface ScoutEventListProps {
  events: any[];
  isCoachOrCaptain: boolean;
  eventCounts: Record<number, { pits: number; matches: number }>;
  onCreateEvent: () => void;
  /** Opens the FIRST import picker — the normal way to add a competition. */
  onImportFirst: () => void;
  onEnterEvent: (evt: any) => void;
  onDeleteEvent: (id: number) => void;
  showEventForm: boolean;
  eventForm: any;
  setEventForm: React.Dispatch<React.SetStateAction<any>>;
  onCreateEventSubmit: () => void;
  onCloseEventForm: () => void;
  geminiModal: { open: boolean; text: string; matchLabel: string };
  copiedGemini: boolean;
  onSetGeminiModal: (m: { open: boolean; text: string; matchLabel: string }) => void;
  onSetCopiedGemini: (v: boolean) => void;
  seasons?: any[];
  onManageSeasons?: () => void;
  seasonFilter?: number | 'all';
  onSeasonFilterChange?: (v: number | 'all') => void;
}

const ScoutEventList: React.FC<ScoutEventListProps> = ({
  events, isCoachOrCaptain, eventCounts,
  onCreateEvent, onImportFirst, onEnterEvent, onDeleteEvent, showEventForm,
  eventForm, setEventForm,
  onCreateEventSubmit, onCloseEventForm, geminiModal, copiedGemini,
  onSetGeminiModal, onSetCopiedGemini,
  seasons = [], onManageSeasons, seasonFilter = 'all', onSeasonFilterChange,
}) => {
  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Scout</h2>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Tournament event scouting</p>
        </div>
        <div className="flex items-center gap-2">
          {seasons.length > 0 && onSeasonFilterChange && (
            <select value={String(seasonFilter)} onChange={(e) => onSeasonFilterChange(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
              className="px-4 py-3 rounded-xl border-2 border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 font-black text-[10px] uppercase tracking-widest text-slate-600 dark:text-slate-300 outline-none focus:border-teamColor">
              <option value="all">All Seasons</option>
              {seasons.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' ★' : ''}</option>)}
            </select>
          )}
          {isCoachOrCaptain && (
            <>
            {onManageSeasons && (
              <button onClick={onManageSeasons}
                className="flex items-center justify-center gap-2 px-5 py-3 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black rounded-xl hover:border-teamColor hover:text-teamColor transition-all uppercase text-[10px] tracking-widest">
                <Layers size={16} /> Seasons
              </button>
            )}
            <button onClick={onCreateEvent} title="For scrimmages and events not in FIRST's system"
              className="flex items-center justify-center gap-2 px-5 py-3 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-black rounded-xl hover:border-teamColor hover:text-teamColor transition-all uppercase text-[10px] tracking-widest">
              <Plus size={16} /> Manual
            </button>
            <button onClick={onImportFirst}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase text-[10px] tracking-widest">
              <Download size={16} /> Import FTC Event
            </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {events.map(evt => (
          <div key={evt.id} onClick={() => onEnterEvent(evt)}
            className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8 hover:border-teamColor/30 transition-all cursor-pointer group">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-teamColor/10 text-teamColor rounded-2xl flex items-center justify-center group-hover:bg-teamColor group-hover:text-white transition-all">
                <Trophy size={22} />
              </div>
              {isCoachOrCaptain && (
                <button onClick={(e) => { e.stopPropagation(); onDeleteEvent(evt.id); }}
                  className="p-2 text-slate-300 hover:text-red-600 transition-all opacity-0 group-hover:opacity-100">
                  <span className="text-base font-black">✕</span>
                </button>
              )}
            </div>
            <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">{evt.name}</h3>
            {evt.location && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-bold mb-1">
                <MapPin size={12} /> {evt.location}
              </div>
            )}
            {evt.startDate && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-bold mb-3">
                <Calendar size={12} /> {evt.startDate}{evt.endDate && ` — ${evt.endDate}`}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {evt.eventCode && (
                <span className="px-2 py-1 bg-teamColor/10 text-teamColor rounded-lg text-[9px] font-black">{evt.eventCode}</span>
              )}
              <span className="px-2 py-1 bg-slate-50 text-slate-500 rounded-lg text-[9px] font-black border border-slate-100 dark:border-slate-700">
                {eventCounts[evt.id]?.pits || 0} robots
              </span>
              <span className="px-2 py-1 bg-slate-50 text-slate-500 rounded-lg text-[9px] font-black border border-slate-100 dark:border-slate-700">
                {eventCounts[evt.id]?.matches || 0} matches
              </span>
            </div>
          </div>
        ))}
      </div>

      {events.length === 0 && (
        <div className="py-20 text-center">
          <Trophy size={56} className="text-slate-200 mx-auto mb-4" />
          <p className="text-xl font-black text-slate-300 uppercase tracking-tight">No Events Yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
            {isCoachOrCaptain ? 'Import an FTC event from FIRST to start scouting' : 'Ask a Coach or Captain to import an event'}
          </p>
        </div>
      )}

      {showEventForm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 md:p-12 shadow-2xl border-t-8 border-teamColor">
            <div className="flex justify-between items-start mb-6 md:mb-10">
              <div>
                <h2 className="text-xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">New Event</h2>
                <p className="text-[10px] md:text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">Create a tournament event</p>
              </div>
              <button onClick={onCloseEventForm} className="p-2 md:p-3 bg-slate-50 dark:bg-slate-700 text-slate-400 dark:text-slate-500 hover:text-red-600 rounded-xl transition-all">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4 md:space-y-6">
              <div className="space-y-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Event Name *</label>
                <input autoFocus value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                  placeholder="e.g. Arizona North Regional"
                  className="w-full p-4 md:p-6 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-black text-base md:text-lg uppercase tracking-tight" />
              </div>
              <div className="space-y-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Location</label>
                <input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                  placeholder="e.g. Phoenix, AZ"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-sm" />
              </div>
              {seasons.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Season</label>
                  <select value={eventForm.seasonId ?? ''} onChange={(e) => setEventForm({ ...eventForm, seasonId: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white">
                    {seasons.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>
                    ))}
                  </select>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium ml-2">Scouting fields & analytics are scoped to this season's templates</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Start Date</label>
                  <input type="date" value={eventForm.startDate} onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-sm" />
                </div>
                <div className="space-y-2">
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">End Date</label>
                  <input type="date" value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-sm" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">FIRST Event Code <span className="normal-case font-normal text-slate-400">(optional)</span></label>
                <input value={eventForm.eventCode || ''} onChange={(e) => setEventForm({ ...eventForm, eventCode: e.target.value.toUpperCase() })}
                  placeholder="e.g. USCAFFFAQ"
                  className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-sm uppercase dark:text-white" />
                <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium ml-2">For events already in FIRST's system, use Import FTC Event instead — it also creates the calendar event and team list.</p>
              </div>
              <button onClick={onCreateEventSubmit} disabled={!eventForm.name.trim()}
                className="w-full py-4 md:py-6 bg-teamColor text-white font-black rounded-xl md:rounded-[32px] hover:opacity-90 shadow-2xl shadow-teamColor/20 transition-all uppercase tracking-widest text-xs md:text-sm flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50">
                <Trophy size={16} /> Create Event
              </button>
            </div>
          </div>
        </div>
      )}

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
                <X size={20} className="text-slate-400 dark:text-slate-500" />
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

export default ScoutEventList;
