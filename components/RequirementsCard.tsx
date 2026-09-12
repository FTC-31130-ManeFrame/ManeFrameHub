import React, { useEffect, useState } from 'react';
import { Target, Clock } from 'lucide-react';
import { api } from '../services/api';
import { CategoryBadge } from './hourCategoryStyles';

const fmtHours = (mins: number) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};
const pct = (a: number, b: number) => (b <= 0 ? (a > 0 ? 100 : 0) : Math.min(100, Math.round((a / b) * 100)));

const Bar: React.FC<{ label: string; value: string; percent: number; done?: boolean }> = ({ label, value, percent, done }) => (
  <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-[11px] font-black tabular-nums ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {value}{done ? ' ✓' : ''}
      </span>
    </div>
    <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-teamColor'}`} style={{ width: `${percent}%` }} />
    </div>
  </div>
);

const RequirementsCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [data, setData] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.requirements.mine().then(setData).catch(() => setData(null)).finally(() => setLoaded(true));
  }, []);

  if (!loaded || !data) return null;
  const hourReqs = (data.hours || []).filter((h: any) => (h.phases || []).length > 0);
  if (hourReqs.length === 0) return null; // nothing configured → hide

  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl md:rounded-[28px] border-2 border-slate-100 dark:border-slate-700 p-5 flex flex-col gap-4 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-teamColor/10 text-teamColor rounded-xl flex items-center justify-center"><Target size={18} /></div>
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">My Requirements</h3>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Your season progress</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto kanban-scroll space-y-3.5 -mr-1 pr-1">
        {hourReqs.map((h: any) => {
          // Only show per-bar area badges when phases actually differ — a
          // uniform requirement (the common case) doesn't need the extra noise.
          const mixed = new Set(h.phases.map((p: any) => (p.categories || []).join(','))).size > 1;
          return (
            <div key={h.key} className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Clock size={11} /> {h.label}</div>
              {h.phases.map((ph: any, i: number) => {
                const done = ph.requiredMinutes > 0 && ph.earnedMinutes >= ph.requiredMinutes;
                return (
                  <div key={i} className="space-y-1">
                    <Bar
                      label={h.phases.length > 1 ? ph.label : 'Logged'}
                      value={`${fmtHours(ph.earnedMinutes)} of ${fmtHours(ph.requiredMinutes)}`}
                      percent={pct(ph.earnedMinutes, ph.requiredMinutes)}
                      done={done}
                    />
                    {mixed && (ph.categories || []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {ph.categories.map((c: string) => <CategoryBadge key={c} category={c} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RequirementsCard;
