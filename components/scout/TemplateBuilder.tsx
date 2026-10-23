import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Plus, Trash2, RotateCcw, ChevronUp, ChevronDown, Lock, Save, Loader2, Wand2 } from 'lucide-react';
import { api } from '../../services/api';
import {
  keyFromLabel, validateTemplateFields, applyPreset,
  SCOUTING_PRESETS, DEFAULT_TEMPLATES,
  type ScoutKind, type TemplateField, type FieldType,
} from '../../shared/scoutingTemplates';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'counter', label: 'Counter (+/−)' },
  { value: 'rating', label: 'Rating (stars)' },
  { value: 'slider', label: 'Slider' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Single select' },
  { value: 'multiselect', label: 'Multi select (tags)' },
  { value: 'photo', label: 'Photo' },
];

const NUMERIC = new Set<FieldType>(['number', 'counter', 'rating', 'slider']);
const HAS_RANGE = new Set<FieldType>(['counter', 'slider']);

const smallInput =
  'p-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-md outline-none text-xs font-bold dark:text-white';

/**
 * A comma-separated list editor that keeps the raw text while typing. Parsing
 * on every keystroke would strip the trailing comma the moment it's typed,
 * making a second entry impossible to start.
 */
const ListInput: React.FC<{
  value: (string | number)[] | undefined;
  onCommit: (raw: string) => void;
  placeholder: string;
  className?: string;
}> = ({ value, onCommit, placeholder, className }) => {
  const [text, setText] = useState((value || []).join(', '));
  return (
    <input
      value={text}
      onChange={(e) => { setText(e.target.value); onCommit(e.target.value); }}
      placeholder={placeholder}
      className={className}
    />
  );
};

const parseList = (raw: string) => raw.split(',').map(s => s.trim()).filter(Boolean);
const parseNumbers = (raw: string) => parseList(raw).map(Number).filter(n => Number.isFinite(n) && n > 0);
const optionalNumber = (raw: string) => (raw.trim() === '' ? undefined : Number(raw));

interface Props {
  seasonId: number;
  seasonName: string;
  kind: ScoutKind;
  onClose: () => void;
}

const TemplateBuilder: React.FC<Props> = ({ seasonId, seasonName, kind, onClose }) => {
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [savedFields, setSavedFields] = useState<TemplateField[]>([]); // last persisted, for append-only checks
  const [fields, setFields] = useState<TemplateField[]>([]);
  // Keys of fields added in this session. Their placeholder key is replaced
  // with one derived from the label at save time — never while typing, because
  // each row is identified by its key and changing it remounts the row,
  // dropping focus after the first keystroke.
  const [draftKeys, setDraftKeys] = useState<Set<string>>(new Set());
  const draftCounter = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [formKey, setFormKey] = useState(0); // remounts list inputs after a preset swap

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const tpl = await api.seasons.getTemplate(seasonId, kind);
        if (cancelled) return;
        if (tpl && tpl.id) {
          setTemplateId(tpl.id);
          setName(tpl.name || '');
          setSavedFields(tpl.fields || []);
          setFields(tpl.fields || []);
        } else {
          // A season with no template yet starts from the current game's preset.
          setTemplateId(null);
          setName(`${seasonName} ${DEFAULT_TEMPLATES[kind].name}`);
          setSavedFields([]);
          setFields(DEFAULT_TEMPLATES[kind].fields.map(f => ({ ...f })));
        }
      } catch {
        if (!cancelled) setError('Failed to load template');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [seasonId, kind]);

  const active = fields.filter(f => !f.archived);
  const archived = fields.filter(f => f.archived);
  const savedKeys = useMemo(() => new Set(savedFields.map(f => f.key)), [savedFields]);
  const isSaved = (key: string) => savedKeys.has(key);

  const patch = (key: string, p: Partial<TemplateField>) =>
    setFields(fs => fs.map(f => (f.key === key ? { ...f, ...p } : f)));

  const addField = () => {
    const key = `draft_${++draftCounter.current}`;
    setDraftKeys(s => new Set(s).add(key));
    setFields(fs => [...fs, { key, label: 'New Field', type: 'number', aggregate: 'none' }]);
  };

  const archiveField = (key: string) =>
    setFields(fs => fs.map(f => (f.key === key ? { ...f, archived: true, archivedAt: Date.now() } : f)));
  const restoreField = (key: string) =>
    setFields(fs => fs.map(f => (f.key === key ? { ...f, archived: false, archivedAt: undefined } : f)));
  // Saved keys are permanent and must be archived; anything unsaved can go.
  const deleteUnsaved = (key: string) => setFields(fs => fs.filter(f => f.key !== key));

  const move = (key: string, dir: -1 | 1) => {
    setFields(fs => {
      const i = fs.findIndex(f => f.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= fs.length) return fs;
      const copy = [...fs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const loadPreset = (presetId: string) => {
    const preset = SCOUTING_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    if (templateId && !window.confirm(
      `Switch this ${kind} template to "${preset.label}"? Fields it doesn't use are archived, not deleted — existing scouting data is kept.`,
    )) return;
    setFields(applyPreset(savedFields, preset.fields[kind]));
    setName(`${seasonName} — ${preset.label} (${kind})`);
    setDraftKeys(new Set());
    setFormKey(k => k + 1);
    setError(null);
  };

  /** Give draft fields their permanent, label-derived keys. */
  const finalizeKeys = (fs: TemplateField[]): TemplateField[] => {
    const taken = new Set(fs.filter(f => !draftKeys.has(f.key)).map(f => f.key));
    return fs.map(f => {
      if (!draftKeys.has(f.key)) return f;
      const key = keyFromLabel(f.label || 'field', taken);
      taken.add(key);
      return { ...f, key };
    });
  };

  const save = async () => {
    setError(null);
    const final = finalizeKeys(fields);
    const check = validateTemplateFields(kind, final, templateId ? savedFields : undefined);
    if (!check.ok) { setError(check.error || 'Invalid template'); return; }
    setSaving(true);
    try {
      if (templateId) {
        await api.seasons.updateTemplate(templateId, { name, fields: final });
      } else {
        await api.seasons.createTemplate(seasonId, { kind, name, fields: final });
      }
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (f: TemplateField) => {
    const saved = isSaved(f.key);
    return (
      <div key={f.key} className={`rounded-xl border-2 p-3 space-y-2 ${f.archived ? 'border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 opacity-70' : 'border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-700/40'}`}>
        <div className="flex items-center gap-2">
          {!f.archived && (
            <div className="flex flex-col">
              <button onClick={() => move(f.key, -1)} className="text-slate-300 hover:text-teamColor" title="Move up"><ChevronUp size={14} /></button>
              <button onClick={() => move(f.key, 1)} className="text-slate-300 hover:text-teamColor" title="Move down"><ChevronDown size={14} /></button>
            </div>
          )}
          <input
            value={f.label}
            onChange={(e) => patch(f.key, { label: e.target.value })}
            disabled={f.archived}
            className="flex-1 p-2 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg outline-none focus:border-teamColor font-bold text-sm dark:text-white"
          />
          <select
            value={f.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              // An aggregate only makes sense for some types; don't carry a stale one over.
              const aggregate = NUMERIC.has(type) ? (f.aggregate === 'rate' ? 'none' : f.aggregate) : type === 'boolean' ? 'none' : undefined;
              patch(f.key, { type, aggregate });
            }}
            disabled={saved || f.identity}
            title={saved ? 'Type is locked once saved' : ''}
            className="w-32 p-2 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-lg outline-none focus:border-teamColor font-bold text-xs dark:text-white disabled:opacity-60"
          >
            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {f.identity ? (
            <span className="p-2 text-slate-300" title="Identity field — locked"><Lock size={14} /></span>
          ) : f.archived ? (
            <button onClick={() => restoreField(f.key)} className="p-2 text-slate-400 hover:text-green-600" title="Restore"><RotateCcw size={14} /></button>
          ) : saved ? (
            <button onClick={() => archiveField(f.key)} className="p-2 text-slate-400 hover:text-amber-600" title="Archive (keeps old data)"><Trash2 size={14} /></button>
          ) : (
            <button onClick={() => deleteUnsaved(f.key)} className="p-2 text-slate-400 hover:text-red-600" title="Remove"><X size={14} /></button>
          )}
        </div>

        {!f.archived && !f.identity && (
          <div className="flex flex-wrap items-center gap-2 pl-1">
            <input
              value={f.section || ''}
              onChange={(e) => patch(f.key, { section: e.target.value })}
              placeholder="Section"
              className={`w-28 ${smallInput}`}
            />
            {(f.type === 'select' || f.type === 'multiselect') && !f.dynamicOptions && (
              <ListInput
                value={f.options}
                onCommit={(raw) => patch(f.key, { options: parseList(raw) })}
                placeholder="Options (comma-separated)"
                className={`flex-1 min-w-[10rem] ${smallInput} font-medium`}
              />
            )}
            {HAS_RANGE.has(f.type) && (
              <>
                <input type="number" value={f.min ?? ''} onChange={(e) => patch(f.key, { min: optionalNumber(e.target.value) })}
                  placeholder="Min" title="Minimum" className={`w-16 ${smallInput}`} />
                <input type="number" value={f.max ?? ''} onChange={(e) => patch(f.key, { max: optionalNumber(e.target.value) })}
                  placeholder="Max" title="Maximum" className={`w-16 ${smallInput}`} />
              </>
            )}
            {f.type === 'rating' && (
              <input type="number" min={1} max={10} value={f.max ?? ''} onChange={(e) => patch(f.key, { max: optionalNumber(e.target.value) })}
                placeholder="Stars" title="Number of stars (default 5)" className={`w-16 ${smallInput}`} />
            )}
            {f.type === 'counter' && (
              <ListInput
                value={f.quickAdd}
                onCommit={(raw) => patch(f.key, { quickAdd: parseNumbers(raw) })}
                placeholder="Quick-add e.g. 5, 10"
                className={`w-32 ${smallInput}`}
              />
            )}
            {(NUMERIC.has(f.type) || f.type === 'boolean') && (
              <>
                <select
                  value={f.aggregate || 'none'}
                  onChange={(e) => patch(f.key, { aggregate: e.target.value as TemplateField['aggregate'] })}
                  className={smallInput}
                >
                  <option value="none">No stat</option>
                  {f.type === 'boolean' ? (
                    <option value="rate">% of matches</option>
                  ) : (
                    <>
                      <option value="avg">Average</option>
                      <option value="sum">Total</option>
                      <option value="max">Best</option>
                    </>
                  )}
                </select>
                <label className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400" title="Show on the robot's summary card">
                  <input type="checkbox" checked={!!f.showInSummary} onChange={(e) => patch(f.key, { showInSummary: e.target.checked })} /> Summary
                </label>
                {NUMERIC.has(f.type) && (
                  <label className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400" title="Default metric when ranking robots">
                    <input type="checkbox" checked={!!f.rankMetric} onChange={(e) => patch(f.key, { rankMetric: e.target.checked })} /> Rank
                  </label>
                )}
              </>
            )}
            <label className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
              <input type="checkbox" checked={!!f.required} onChange={(e) => patch(f.key, { required: e.target.checked })} /> Required
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[120] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] w-full max-w-3xl max-h-[92vh] overflow-auto shadow-2xl border-t-8 border-teamColor">
        <div className="sticky top-0 bg-white dark:bg-slate-800 p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center gap-3 z-10">
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">
              {kind === 'pit' ? 'Pit' : 'Match'} Template
            </h2>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-0.5">{seasonName}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <Wand2 size={13} />
              <select
                value=""
                onChange={(e) => { if (e.target.value) loadPreset(e.target.value); }}
                disabled={loading}
                className="p-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-600 rounded-md outline-none text-[10px] font-black uppercase dark:text-white"
              >
                <option value="">Start from preset…</option>
                {SCOUTING_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <button onClick={onClose} className="p-2 bg-slate-50 dark:bg-slate-700 text-slate-400 hover:text-red-600 rounded-xl transition-all"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-3" key={formKey}>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : (
            <>
              {active.map(renderRow)}
              <button onClick={addField} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 dark:border-slate-600 rounded-xl text-slate-400 hover:border-teamColor hover:text-teamColor font-black text-xs uppercase tracking-widest transition-all">
                <Plus size={16} /> Add Field
              </button>

              {archived.length > 0 && (
                <div className="pt-2">
                  <button onClick={() => setShowArchived(v => !v)} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    {showArchived ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Archived fields ({archived.length})
                  </button>
                  {showArchived && <div className="space-y-2 mt-2">{archived.map(renderRow)}</div>}
                </div>
              )}

              {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-slate-800 p-6 border-t border-slate-100 dark:border-slate-700 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-slate-400 font-black hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl uppercase tracking-widest text-xs transition-all">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="flex-1 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Template
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateBuilder;
