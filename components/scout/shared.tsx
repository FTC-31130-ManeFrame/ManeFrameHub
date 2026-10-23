import React, { useState } from 'react';
import { Star, X } from 'lucide-react';

export const Counter: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  color?: string;
}> = ({ label, value, onChange, min = 0, max = 999, color = 'slate' }) => (
  <div className="flex flex-col items-center gap-2">
    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest text-center">{label}</span>
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl font-black text-lg bg-${color}-100 dark:bg-${color}-900/30 text-${color}-700 dark:text-${color}-300 hover:bg-${color}-200 transition-all active:scale-95`}
      >−</button>
      <span className="w-10 md:w-12 text-center font-black text-lg text-slate-900 dark:text-white">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-xl font-black text-lg bg-${color}-100 dark:bg-${color}-900/30 text-${color}-700 dark:text-${color}-300 hover:bg-${color}-200 transition-all active:scale-95`}
      >+</button>
    </div>
  </div>
);

export const StarRating: React.FC<{
  value: number;
  onChange: (v: number) => void;
  max?: number;
  label: string;
}> = ({ value, onChange, max = 5, label }) => (
  <div className="flex flex-col gap-1">
    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</span>
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i + 1)}
          className="p-0.5 transition-all active:scale-90"
        >
          <Star size={20} className={i < value ? 'text-yellow-500 fill-yellow-500' : 'text-slate-200 dark:text-slate-700'} />
        </button>
      ))}
    </div>
  </div>
);

export const RatingSlider: React.FC<{
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
}> = ({ value, onChange, label, min = 1, max = 10 }) => (
  <div className="flex flex-col gap-2">
    <div className="flex justify-between items-center">
      <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</span>
      <span className="text-sm font-black text-teamColor">{value}/{max}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value))}
      className="w-full"
      style={{ accentColor: 'var(--team-color)' }}
    />
  </div>
);

export const TagInput: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
  label: string;
  placeholder?: string;
}> = ({ tags, onChange, label, placeholder }) => {
  const [input, setInput] = useState('');
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput('');
    }
  };
  return (
    <div className="space-y-2">
      <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</span>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag, i) => (
          <span key={i} className="flex items-center gap-1 px-3 py-1 bg-teamColor/10 text-teamColor rounded-full text-xs font-bold">
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} className="hover:opacity-70">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Type and press Enter'}
        className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white dark:placeholder:text-slate-400 dark:text-slate-500"
      />
    </div>
  );
};
