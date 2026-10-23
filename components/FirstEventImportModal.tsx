import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Search, Download, Check, AlertCircle, CalendarDays, Crosshair, Users } from 'lucide-react';
import { api, type FirstEventSummary, type FirstImportResult } from '../services/api';
import { ftcSeasonFor } from '../shared/ftcSeason';

interface Props {
  onClose: () => void;
  /** Called after at least one event imported, so the parent can refresh. */
  onImported?: (results: FirstImportResult[]) => void;
  /** Event codes that already have a scouting event, to mark them in the list. */
  importedCodes?: Set<string>;
}

type Outcome = { ok: true; result: FirstImportResult } | { ok: false; error: string };

const fmtRange = (a: string | null, b: string | null) => {
  if (!a) return 'Date TBA';
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return b && b !== a ? `${f(a)} – ${f(b)}` : f(a);
};

/**
 * Find and import FTC events from FIRST's official API. One import creates the
 * calendar event (attendance), the linked scouting event and the team list —
 * the same server call whether started from Calendar or Scout.
 */
const FirstEventImportModal: React.FC<Props> = ({ onClose, onImported, importedCodes }) => {
  const current = ftcSeasonFor();
  const [season, setSeason] = useState(current);
  const [mode, setMode] = useState<'mine' | 'all'>('mine');
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<FirstEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  // Debounce search so typing doesn't fire a request per keystroke.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.first.searchEvents({ season, mine: mode === 'mine', q: mode === 'all' ? debounced : undefined })
      .then(r => { if (!cancelled) setEvents(r.events); })
      .catch((e: any) => { if (!cancelled) { setEvents([]); setError(e?.message || 'Could not load events from FIRST.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season, mode, debounced]);

  const toggle = (code: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });

  const runImport = async () => {
    setImporting(true);
    const results: FirstImportResult[] = [];
    // One at a time: each import writes several rows and fetches the team list.
    for (const code of selected) {
      try {
        const result = await api.first.importEvent(code, season);
        results.push(result);
        setOutcomes(o => ({ ...o, [code]: { ok: true, result } }));
      } catch (e: any) {
        setOutcomes(o => ({ ...o, [code]: { ok: false, error: e?.message || 'Import failed' } }));
      }
    }
    setImporting(false);
    setSelected(new Set());
    if (results.length) onImported?.(results);
  };

  const done = useMemo(() => Object.keys(outcomes).length > 0 && !importing, [outcomes, importing]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[130] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl border-t-8 border-teamColor">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-start gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter uppercase flex items-center gap-2">
              <Download size={18} className="text-teamColor" /> Import FTC Event
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
              Creates the calendar event, its scouting event and the team list
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 dark:bg-slate-700 text-slate-400 hover:text-red-600 rounded-xl transition-all"><X size={20} /></button>
        </div>

        <div className="p-6 pb-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-700 p-1">
              {(['mine', 'all'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${mode === m ? 'bg-white dark:bg-slate-800 text-teamColor shadow-sm' : 'text-slate-400'}`}>
                  {m === 'mine' ? 'Our events' : 'All events'}
                </button>
              ))}
            </div>
            <select value={season} onChange={e => setSeason(parseInt(e.target.value))}
              className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 outline-none">
              {[current, current - 1].map(y => <option key={y} value={y}>{y}–{String(y + 1).slice(2)} season</option>)}
            </select>
          </div>
          {mode === 'all' && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, code or city…"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor font-bold text-sm dark:text-white" />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto px-6 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : error ? (
            <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><p className="text-sm font-bold">{error}</p>
            </div>
          ) : events.length === 0 ? (
            <p className="text-center py-12 text-sm font-bold text-slate-400">
              {mode === 'mine'
                ? "FIRST doesn't list any events for our team this season yet. Try All events."
                : debounced ? 'No events match that search.' : 'Type to search events.'}
            </p>
          ) : events.map(ev => {
            const outcome = outcomes[ev.code];
            const already = importedCodes?.has(ev.code);
            const checked = selected.has(ev.code);
            return (
              <button key={ev.code} onClick={() => !importing && toggle(ev.code)} disabled={importing}
                className={`w-full text-left p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${checked ? 'border-teamColor bg-teamColor/5' : 'border-slate-100 dark:border-slate-700 hover:border-slate-200'}`}>
                <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${checked ? 'bg-teamColor border-teamColor text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {checked && <Check size={12} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-black text-sm text-slate-900 dark:text-white truncate">{ev.name}</span>
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">
                    {ev.code} · {fmtRange(ev.startDate, ev.endDate)}{ev.location ? ` · ${ev.location}` : ''}
                  </span>
                  {outcome && 'result' in outcome && (
                    <span className="flex flex-wrap gap-x-3 mt-1 text-[10px] font-bold text-green-600 dark:text-green-400">
                      <span className="flex items-center gap-1"><CalendarDays size={10} />{outcome.result.createdCalendarEvent ? 'Calendar event created' : 'Calendar event linked'}</span>
                      <span className="flex items-center gap-1"><Crosshair size={10} />{outcome.result.createdScoutEvent ? 'Scouting event created' : 'Scouting event updated'}</span>
                      <span className="flex items-center gap-1"><Users size={10} />
                        {outcome.result.teamsTotal === 0
                          ? 'No team list from FIRST yet — import again closer to the event'
                          : `${outcome.result.teamsAdded} new of ${outcome.result.teamsTotal} teams`}
                      </span>
                    </span>
                  )}
                  {outcome && 'error' in outcome && <span className="block mt-1 text-[10px] font-bold text-red-500">{outcome.error}</span>}
                </span>
                {already && !outcome && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full flex-shrink-0">Imported</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-6 border-t border-slate-100 dark:border-slate-700 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-slate-400 font-black hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl uppercase tracking-widest text-xs transition-all">
            {done ? 'Done' : 'Cancel'}
          </button>
          <button onClick={runImport} disabled={importing || selected.size === 0}
            className="flex-1 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {importing ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : `Import ${selected.size || ''} Event${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstEventImportModal;
