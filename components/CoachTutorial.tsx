import React, { useState, useEffect } from 'react';
import {
  X, ArrowRight, ArrowLeft, Zap, LayoutDashboard, Clock,
  Users, Megaphone, Crosshair, BookOpen
} from 'lucide-react';

const STORAGE_KEY = 'piobyte_coach_tutorial_v1';

interface TutorialStep {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  route?: string;
  routeLabel?: string;
}

const STEPS: TutorialStep[] = [
  {
    icon: <Zap size={28} className="text-teamColor" fill="currentColor" />,
    label: 'Welcome',
    title: "Coach view — full access unlocked",
    body:
      "As a Coach you have access to every feature in ManeFrame Hub. This quick tour covers the tools you'll rely on most. Dismiss any step with the X, or skip the whole tour — you can replay it anytime from the Help button in the sidebar.",
  },
  {
    icon: <LayoutDashboard size={28} className="text-blue-500" />,
    label: 'War Room',
    title: "War Room — live project pulse",
    body:
      "The War Room shows every active project's task matrix in one scrollable view. Blocked tasks are flagged with a pulsing red ring and listed separately so nothing slips. Use it during stand-ups to track the whole team at a glance.",
    route: '/war-room',
    routeLabel: 'Open War Room',
  },
  {
    icon: <Clock size={28} className="text-amber-500" />,
    label: 'Time Tracking',
    title: "Approve student time entries",
    body:
      "Students check in and out from Time Tracking. Pending approvals are highlighted in amber — tap Approve or Reject on each one. You can also bulk-add class time for a whole session and export the full audit log at any time.",
    route: '/time',
    routeLabel: 'Open Time Tracking',
  },
  {
    icon: <Users size={28} className="text-green-500" />,
    label: 'Team',
    title: "Build and manage your roster",
    body:
      "Add new members, assign roles (Coach, Captain, Dept Head, Member, Trainer, Class Member), set departments, mute users, and reset passwords — all from Team Management. Users are sorted by department for easy scanning.",
    route: '/team',
    routeLabel: 'Open Team',
  },
  {
    icon: <Megaphone size={28} className="text-violet-500" />,
    label: 'Announcements',
    title: "Broadcast to the whole team",
    body:
      "Post a Global or Department-scoped announcement from the Home feed. Every affected member sees a real-time toast notification slide up on their screen. Perfect for competition-day callouts, shop reminders, or safety notices.",
    route: '/',
    routeLabel: 'Go to Home',
  },
  {
    icon: <Crosshair size={28} className="text-teamColor" />,
    label: 'Scout',
    title: "FTC scouting + TOA / Nexus live feeds",
    body:
      "The Scout module tracks pit specs, match scouting, and pulls live rankings from The Orange Alliance and Nexus. Use Pit Display for a 4K-optimized live view at competitions — it shows upcoming matches, pit maps, and team rankings side by side.",
    route: '/scout',
    routeLabel: 'Open Scout',
  },
  {
    icon: <BookOpen size={28} className="text-slate-500" />,
    label: 'Resources & Calendar',
    title: "Shared links and team schedule",
    body:
      "Resources is a curated, searchable hub of FTC links (vendors, software, training docs) — any member can add links, coaches can pin the most important ones. Calendar keeps shop sessions, competitions, meetings, and outreach in one place, with TOA import for competition dates.",
  },
];

interface CoachTutorialProps {
  onNavigate: (route: string) => void;
}

const CoachTutorial: React.FC<CoachTutorialProps> = ({ onNavigate }) => {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== 'done') {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'done');
    setVisible(false);
  };

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      dismiss();
    }
  };

  const goBack = () => {
    if (step > 0) setStep(s => s - 1);
  };

  const handleNavigate = (route: string) => {
    onNavigate(route);
    dismiss();
  };

  if (!visible) return null;

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">

        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex gap-1.5 items-center">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? 'w-6 bg-teamColor'
                    : i < step
                    ? 'w-3 bg-teamColor/40'
                    : 'w-3 bg-slate-200 dark:bg-slate-700'
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
            title="Dismiss tutorial"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-8 py-4 text-center">
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-5">
            {current.icon}
          </div>
          <p className="text-[10px] font-black text-teamColor uppercase tracking-widest mb-2">
            {current.label} &middot; Step {step + 1} of {STEPS.length}
          </p>
          <h2 className="text-xl font-black text-slate-900 dark:text-slate-100 leading-tight mb-3">
            {current.title}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {current.body}
          </p>
        </div>

        <div className="px-6 pb-6 flex items-center gap-2 pt-2">
          {isFirst ? (
            <button
              onClick={dismiss}
              className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              Skip all
            </button>
          ) : (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 px-4 py-2.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <ArrowLeft size={13} /> Back
            </button>
          )}

          <div className="flex-1" />

          {current.route && (
            <button
              onClick={() => handleNavigate(current.route!)}
              className="px-4 py-2.5 text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest hover:underline transition-colors"
            >
              {current.routeLabel || 'Go there'} →
            </button>
          )}

          <button
            onClick={goNext}
            className="flex items-center gap-2 px-6 py-2.5 bg-teamColor hover:opacity-90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-teamColor/20 active:scale-95"
          >
            {isLast ? 'All done!' : 'Got it'}
            {!isLast && <ArrowRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CoachTutorial;
