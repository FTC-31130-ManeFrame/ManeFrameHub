import React, { useEffect, useState } from 'react';
import { Target, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { api } from '../services/api';
import { HOUR_CATEGORIES, styleFor } from './hourCategoryStyles';

interface Props { currentUserId: string | null; }

// Requirements previously named one `source`. They now hold a list of categories
// so a single requirement (e.g. "Total Hours") can count several kinds of time.
// Legacy `source` values are translated here and on the server.
const categoriesOf = (h: any): string[] => {
  if (Array.isArray(h.categories)) return h.categories;
  if (typeof h.source === 'string') {
    if (h.source.startsWith('clock:')) return [h.source.slice('clock:'.length)];
    if (h.source === 'competition_checkins') return ['competition'];
  }
  return [];
};

// A phase may override the requirement's default areas. Absence of
// `ph.categories` means "inherit" — mirrors phaseCategories() server-side.
const phaseCategoriesOf = (h: any, ph: any): string[] =>
  Array.isArray(ph?.categories) ? ph.categories : categoriesOf(h);

const minToHours = (m: number) => (m ? +(m / 60).toFixed(2) : 0);
const hoursToMin = (h: number) => Math.round((h || 0) * 60);

// Shared area-pill row, used for both a requirement's default areas and a
// phase's overridden ones.
const CategoryPills: React.FC<{
  value: string[];
  onToggle: (c: string) => void;
  onToggleAll: () => void;
  size?: 'md' | 'sm';
}> = ({ value, onToggle, onToggleAll, size = 'md' }) => {
  const pad = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {HOUR_CATEGORIES.map((c) => {
        const selected = value.includes(c);
        const s = styleFor(c);
        return (
          <button
            key={c}
            onClick={() => onToggle(c)}
            className={`inline-flex items-center gap-1 ${pad} rounded-lg text-[10px] font-black uppercase tracking-wide transition-all ${
              selected ? `${s.bg} ${s.text} ring-2 ring-offset-1 ring-teamColor dark:ring-offset-slate-700` : 'bg-white dark:bg-slate-700 text-slate-400 border-2 border-slate-100 dark:border-slate-600'
            }`}
          >
            {s.icon} {s.label}
          </button>
        );
      })}
      <button onClick={onToggleAll} className="text-[10px] font-black text-slate-500 hover:text-teamColor uppercase tracking-widest ml-1">
        {value.length === HOUR_CATEGORIES.length ? 'Clear all' : 'Select all'}
      </button>
    </div>
  );
};

const RequirementsSettings: React.FC<Props> = ({ currentUserId }) => {
  const [req, setReq] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings.get().then((s) => {
      setReq(s.requirements || { hours: [] });
    }).catch(() => { setReq({ hours: [] }); });
  }, []);

  if (!req) return <div className="flex justify-center py-8 text-slate-400"><Loader2 className="animate-spin" size={22} /></div>;

  const patch = (fn: (r: any) => void) => { const next = JSON.parse(JSON.stringify(req)); fn(next); setReq(next); setSaved(false); };

  const save = async () => {
    setError(''); setSaving(true);
    try {
      await api.settings.update({ requesterId: currentUserId ? parseInt(currentUserId) : 0, requirements: req });
      setSaved(true);
    } catch (e: any) { setError(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-teamColor/10 text-teamColor rounded-xl flex items-center justify-center"><Target size={20} /></div>
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Requirements</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">What students must meet this season</p>
        </div>
      </div>

      {/* Hour requirements */}
      <div className="space-y-3">
        {(req.hours || []).map((h: any, hi: number) => (
          <div key={hi} className="bg-slate-50 dark:bg-slate-700/40 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={h.enabled} onChange={(e) => patch((r) => { r.hours[hi].enabled = e.target.checked; })} className="w-4 h-4" style={{ accentColor: 'var(--team-color)' }} />
              <input value={h.label} onChange={(e) => patch((r) => { r.hours[hi].label = e.target.value; })} className="flex-1 p-2 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg text-sm font-black outline-none focus:border-teamColor dark:text-white" />
              <button onClick={() => patch((r) => { r.hours.splice(hi, 1); })} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
            </div>
            {h.enabled && (() => {
              const labels = (h.phases || []).map((p: any) => (p.label || '').trim().toLowerCase());
              const dupPhaseLabels = new Set(labels.filter((l: string, i: number) => l && labels.indexOf(l) !== i));
              return (
                <div className="pl-7 space-y-3">
                  <div className="space-y-2">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Default areas</p>
                    <CategoryPills
                      value={categoriesOf(h)}
                      onToggle={(c) => patch((r) => {
                        const current = categoriesOf(r.hours[hi]);
                        r.hours[hi].categories = current.includes(c) ? current.filter((x: string) => x !== c) : [...current, c];
                        delete r.hours[hi].source;
                      })}
                      onToggleAll={() => patch((r) => {
                        const all = categoriesOf(r.hours[hi]).length === HOUR_CATEGORIES.length;
                        r.hours[hi].categories = all ? [] : [...HOUR_CATEGORIES];
                        delete r.hours[hi].source;
                      })}
                    />
                    {categoriesOf(h).length === 0 && (
                      <p className="text-[10px] font-bold text-orange-500">Pick at least one category — this requirement counts nothing right now.</p>
                    )}
                  </div>

                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Phases</p>
                  {(h.phases || []).map((ph: any, pi: number) => {
                    const overridden = Array.isArray(ph.categories);
                    const resolved = phaseCategoriesOf(h, ph);
                    const isDup = dupPhaseLabels.has((ph.label || '').trim().toLowerCase());
                    return (
                      <div key={pi} className="bg-white dark:bg-slate-800/40 border-2 border-slate-100 dark:border-slate-600 rounded-xl p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <input value={ph.label} onChange={(e) => patch((r) => { r.hours[hi].phases[pi].label = e.target.value; })} placeholder="Phase" className="flex-1 p-2 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg text-xs font-bold outline-none focus:border-teamColor dark:text-white" />
                          <button onClick={() => patch((r) => { r.hours[hi].phases.splice(pi, 1); })} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
                        </div>
                        {isDup && (
                          <p className="text-[10px] font-bold text-amber-600">Another phase has this name. Per-student hour overrides are keyed by phase name, so the two would share one override — give them different names.</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <input type="date" value={ph.start || ''} onChange={(e) => patch((r) => { r.hours[hi].phases[pi].start = e.target.value || null; })} className="p-2 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg text-xs font-bold outline-none focus:border-teamColor dark:text-white" />
                          <input type="date" value={ph.end || ''} onChange={(e) => patch((r) => { r.hours[hi].phases[pi].end = e.target.value || null; })} className="p-2 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg text-xs font-bold outline-none focus:border-teamColor dark:text-white" />
                          <span className="text-xs font-bold text-slate-500">req</span>
                          <input type="number" min="0" step="0.5" value={minToHours(ph.requiredMinutes)} onChange={(e) => patch((r) => { r.hours[hi].phases[pi].requiredMinutes = hoursToMin(parseFloat(e.target.value)); })} className="w-16 p-2 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg text-xs font-bold outline-none focus:border-teamColor dark:text-white" />
                          <span className="text-xs font-bold text-slate-500">h</span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={overridden}
                            onChange={(e) => patch((r) => {
                              const p = r.hours[hi].phases[pi];
                              // Seed from the inherited set so switching the
                              // toggle on never silently changes what counts.
                              if (e.target.checked) p.categories = [...categoriesOf(r.hours[hi])];
                              else delete p.categories; // absent, NOT [] — absent means inherit
                            })}
                            className="w-3.5 h-3.5"
                            style={{ accentColor: 'var(--team-color)' }}
                          />
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Different areas for this phase</span>
                        </label>
                        {overridden ? (
                          <>
                            <CategoryPills
                              size="sm"
                              value={ph.categories}
                              onToggle={(c) => patch((r) => {
                                const cur: string[] = r.hours[hi].phases[pi].categories || [];
                                r.hours[hi].phases[pi].categories = cur.includes(c) ? cur.filter((x: string) => x !== c) : [...cur, c];
                              })}
                              onToggleAll={() => patch((r) => {
                                const p = r.hours[hi].phases[pi];
                                p.categories = (p.categories || []).length === HOUR_CATEGORIES.length ? [] : [...HOUR_CATEGORIES];
                              })}
                            />
                            {ph.categories.length === 0 && (
                              <p className="text-[10px] font-bold text-orange-500">This phase counts nothing — pick at least one area.</p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] font-bold text-slate-400">
                            Counts {resolved.length ? resolved.map((c) => styleFor(c).label).join(', ') : 'nothing yet'} — same as the requirement.
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={() => patch((r) => { r.hours[hi].phases.push({ label: 'Phase', start: null, end: null, requiredMinutes: 0 }); })} className="text-[10px] font-black text-teamColor uppercase tracking-widest flex items-center gap-1"><Plus size={12} /> Add phase</button>
                </div>
              );
            })()}
          </div>
        ))}
        <button onClick={() => patch((r) => { r.hours = r.hours || []; r.hours.push({ key: `custom_${Date.now()}`, label: 'New Requirement', enabled: true, categories: [...HOUR_CATEGORIES], phases: [{ label: 'Season', start: null, end: null, requiredMinutes: 0 }] }); })} className="text-xs font-black text-slate-500 hover:text-teamColor uppercase tracking-widest flex items-center gap-1.5"><Plus size={14} /> Add hour requirement</button>
      </div>

      {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
      <button onClick={save} disabled={saving} className="w-full py-3.5 bg-teamColor text-white font-black rounded-2xl hover:opacity-90 disabled:opacity-50 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2">
        {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null} {saved ? 'Saved' : 'Save Requirements'}
      </button>
    </div>
  );
};

export default RequirementsSettings;
