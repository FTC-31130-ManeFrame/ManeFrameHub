import React, { useState } from 'react';
import { X, Camera } from 'lucide-react';
import { Counter, StarRating, RatingSlider, TagInput } from './shared';
import type { TemplateField } from '../../shared/scoutingTemplates';

interface Props {
  show: boolean;
  title: string;
  subtitle?: string;
  fields: TemplateField[];
  form: Record<string, any>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onClose: () => void;
  onSave: () => void;
  editing?: boolean;
  saveLabel?: string;
  compressImage?: (file: File) => Promise<string>;
  // For select fields with dynamicOptions === 'pitAutoRoutines'.
  pitScouts?: any[];
}

/**
 * Renders a scouting form from a template's field list. Used for custom
 * (non-built-in) templates so teams can collect whatever a season needs.
 * Missing values are treated as unanswered; identity fields render like any
 * other field but are validated by the caller.
 */
const DynamicScoutForm: React.FC<Props> = ({
  show, title, subtitle, fields, form, setForm, onClose, onSave, editing,
  saveLabel, compressImage, pitScouts = [],
}) => {
  const [customAuto, setCustomAuto] = useState('');
  if (!show) return null;

  // Functional update so rapid successive edits (e.g. counter quick-adds) compose
  // instead of racing on a stale snapshot.
  const set = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  const bump = (key: string, delta: number) => setForm(prev => ({ ...prev, [key]: (prev[key] || 0) + delta }));

  const visible = fields.filter(f => !f.archived);
  // Group by section, preserving field order.
  const sections: { name: string; fields: TemplateField[] }[] = [];
  for (const f of visible) {
    const name = f.section || '';
    let s = sections.find(x => x.name === name);
    if (!s) { s = { name, fields: [] }; sections.push(s); }
    s.fields.push(f);
  }

  // Required fields are enforced here, not just starred. A counter at 0 and an
  // unanswered Yes/No are both legitimate answers, so only blanks count.
  const isAnswered = (f: TemplateField): boolean => {
    const v = form[f.key];
    if (f.type === 'boolean' || f.type === 'counter') return true;
    if (Array.isArray(v)) return v.length > 0;
    if (f.type === 'rating') return (v || 0) > 0;
    return v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
  };
  // Team number is the record's key, so it's always required.
  const missing = visible.filter(f => (f.required || f.key === 'teamNumber') && !isAnswered(f));

  const pitAutoOptions = (teamNumber: number): string[] => {
    const scouted = pitScouts.find((p: any) => p.teamNumber === teamNumber);
    return Array.from(new Set([
      ...((scouted?.data?.autoOptions) || scouted?.autoOptions || []),
      ...(scouted?.data?.autonomousRoutine && scouted.data.autonomousRoutine !== 'None' ? [scouted.data.autonomousRoutine] : []),
    ])).filter(Boolean) as string[];
  };

  const renderField = (f: TemplateField) => {
    const val = form[f.key];
    const label = <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{f.label}{f.required && ' *'}</span>;

    switch (f.type) {
      case 'number':
        return (
          <div className="space-y-1" key={f.key}>
            {label}
            <input type="number" value={val ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? undefined : parseFloat(e.target.value))}
              placeholder={f.placeholder}
              className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor font-black text-lg dark:text-white" />
          </div>
        );
      case 'text':
        return (
          <div className="space-y-1" key={f.key}>
            {label}
            <input value={val ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder}
              className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor font-bold text-sm dark:text-white" />
          </div>
        );
      case 'textarea':
        return (
          <div className="space-y-1" key={f.key}>
            {label}
            <textarea value={val ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder}
              className="w-full h-20 p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor font-medium text-sm resize-none dark:text-white" />
          </div>
        );
      case 'boolean':
        return (
          <div className="space-y-1" key={f.key}>
            {label}
            <button type="button" onClick={() => setForm(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
              className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm transition-all ${val ? 'bg-green-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              {val ? 'Yes' : 'No'}
            </button>
          </div>
        );
      case 'select': {
        if (f.dynamicOptions === 'pitAutoRoutines') {
          const opts = pitAutoOptions(form.teamNumber);
          const isCustom = val === '__custom__' || (val && !opts.includes(val) && val !== '');
          return (
            <div className="space-y-2" key={f.key}>
              {label}
              <select value={isCustom ? '__custom__' : (val || '')} onChange={(e) => { if (e.target.value === '__custom__') { set(f.key, '__custom__'); setCustomAuto(''); } else set(f.key, e.target.value); }}
                className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor font-bold text-sm dark:text-white">
                <option value="">— None / Not recorded —</option>
                {opts.length > 0 && <optgroup label="From robot scouting">{opts.map(o => <option key={o} value={o}>{o}</option>)}</optgroup>}
                <option value="__custom__">Other / Custom…</option>
              </select>
              {isCustom && (
                <input value={val === '__custom__' ? customAuto : val} onChange={(e) => { setCustomAuto(e.target.value); set(f.key, e.target.value); }}
                  placeholder="Describe the routine…" autoFocus
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-teamColor/30 rounded-[24px] outline-none focus:border-teamColor font-bold text-sm dark:text-white" />
              )}
            </div>
          );
        }
        return (
          <div className="space-y-1" key={f.key}>
            {label}
            <div className="flex flex-wrap gap-2">
              {(f.options || []).map(opt => {
                // Alliance colors are worth keeping — scouts pick them at a glance.
                const selected =
                  opt === 'Red' ? 'border-red-600 bg-red-600 text-white'
                  : opt === 'Blue' ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-teamColor bg-teamColor/10 text-teamColor';
                return (
                  <button key={opt} type="button" onClick={() => set(f.key, opt)}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${val === opt ? selected : 'border-slate-100 dark:border-slate-600 text-slate-400'}`}>
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        );
      }
      case 'multiselect':
        return (
          <TagInput key={f.key} tags={val || []} onChange={(v) => set(f.key, v)} label={f.label} placeholder={f.placeholder} />
        );
      case 'rating':
        return <StarRating key={f.key} value={val || 0} onChange={(v) => set(f.key, v)} max={f.max || 5} label={f.label} />;
      case 'slider':
        return <RatingSlider key={f.key} value={val || f.min || 1} onChange={(v) => set(f.key, v)} label={f.label} min={f.min ?? 1} max={f.max ?? 10} />;
      case 'counter':
        return (
          <div className="space-y-2" key={f.key}>
            <Counter label={f.label} value={val || 0} onChange={(v) => set(f.key, v)} min={f.min ?? 0} max={f.max ?? 999} />
            {f.quickAdd && f.quickAdd.length > 0 && (
              <div className="flex justify-center gap-2">
                {f.quickAdd.map(n => (
                  <button key={n} type="button" onClick={() => bump(f.key, n)}
                    className="px-3 py-1 rounded-lg font-black text-xs bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 hover:bg-teamColor hover:text-white transition-all">+{n}</button>
                ))}
              </div>
            )}
          </div>
        );
      case 'photo':
        return (
          <div className="space-y-2" key={f.key}>
            {label}
            {val && (
              <div className="relative w-full h-40 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700">
                <img src={val} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => set(f.key, '')} className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg"><X size={14} /></button>
              </div>
            )}
            <label className="flex items-center justify-center gap-2 py-3 bg-slate-50 dark:bg-slate-700 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl cursor-pointer hover:border-teamColor">
              <Camera size={16} className="text-slate-400" />
              <span className="text-xs font-black text-slate-400 uppercase tracking-widest">{val ? 'Change Photo' : 'Take / Upload Photo'}</span>
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={async (e) => { const file = e.target.files?.[0]; if (file && compressImage) { try { set(f.key, await compressImage(file)); } catch (err) { console.error(err); } } }} />
            </label>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-2xl max-h-[90vh] overflow-auto p-6 md:p-10 shadow-2xl border-t-8 border-teamColor">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">{title}</h2>
            {subtitle && <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 dark:bg-slate-700 text-slate-400 hover:text-red-600 rounded-xl transition-all"><X size={20} /></button>
        </div>

        <div className="space-y-6">
          {sections.map((s, i) => (
            <div key={i} className="space-y-4">
              {s.name && <p className="text-[10px] font-black text-teamColor uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 pb-1">{s.name}</p>}
              {s.fields.map(renderField)}
            </div>
          ))}

          {missing.length > 0 && (
            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
              Still needed: {missing.map(f => f.label).join(', ')}
            </p>
          )}
          <button onClick={onSave} disabled={missing.length > 0}
            className="w-full py-4 bg-teamColor text-white font-black rounded-xl uppercase tracking-widest text-xs hover:opacity-90 shadow-lg transition-all disabled:opacity-50">
            {saveLabel || (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DynamicScoutForm;
