import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppState, User, Project, Task, Role, Department, TaskStatus, Priority, Notification, Announcement, TimeEntry } from './types';
import Layout from './components/Layout';
import TaskModal from './components/TaskModal';
import Confetti from './components/Confetti';
import ErrorBoundary from './components/ErrorBoundary';
import CoachTutorial from './components/CoachTutorial';
import { api, AUTH_REQUIRED_EVENT } from './services/api';
import { onLiveBoard } from './utils/tasks';
import { Database, Zap, X, Bell, ShieldAlert, AlertTriangle, KeyRound, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import TeamLogo from './components/TeamLogo';
import { TeamSettingsContext, TeamSettingsData, DEFAULT_TEAM_SETTINGS } from './contexts/TeamSettingsContext';

const ControlPanel = lazy(() => import('./components/ControlPanel'));

const Home = lazy(() => import('./components/Home'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const KanbanBoard = lazy(() => import('./components/KanbanBoard'));
const TeamManagement = lazy(() => import('./components/TeamManagement'));
const TimeTracking = lazy(() => import('./components/TimeTracking'));
const Scout = lazy(() => import('./components/Scout'));
const Calendar = lazy(() => import('./components/Calendar'));
const Resources = lazy(() => import('./components/Resources'));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-teamColor border-t-transparent rounded-full animate-spin" />
      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Loading</p>
    </div>
  </div>
);

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    users: [],
    projects: [],
    tasks: [],
    notifications: [],
    announcements: [],
    timeEntries: [],
    currentUser: null
  });

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [guestSession, setGuestSession] = useState<{ eventId: number; eventName: string; pin: string; label: string } | null>(null);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestPin, setGuestPin] = useState('');
  const [guestLoginError, setGuestLoginError] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [activeTaskModal, setActiveTaskModal] = useState<Task | null>(null);
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('piobyte_dark_mode') === 'true');
  const [teamSettings, setTeamSettings] = useState<TeamSettingsData>(DEFAULT_TEAM_SETTINGS);
  const [globalAlerts, setGlobalAlerts] = useState<any[]>([]);
  const [annToast, setAnnToast] = useState<{ text: string; scope: string; dept?: string; authorName?: string } | null>(null);
  const lastShownAnnRef = useRef<string | null>(localStorage.getItem('lastSeenAnnouncementId'));
  const sessionGenerationRef = useRef(0);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<number>>(() => {
    try {
      const stored = sessionStorage.getItem('piobyte_dismissed_alerts');
      return stored ? new Set(JSON.parse(stored)) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  const clearLocalSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    setState(prev => ({ ...prev, currentUser: null }));
    setIsLoggedIn(false);
    setGuestSession(null);
    setLoginLoading(false);
    localStorage.removeItem('frc_hub_active_user');
    localStorage.removeItem('frc_hub_guest');
  }, []);

  useEffect(() => {
    const handleAuthRequired = () => {
      clearLocalSession();
      setLoginError(current => current || 'Your session expired. Please sign in again.');
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, [clearLocalSession]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('piobyte_dark_mode', String(darkMode));
  }, [darkMode]);

  const fetchData = useCallback(async () => {
    const sessionGeneration = sessionGenerationRef.current;
    try {
      const [users, projects, tasks, notifications, announcements, timeEntries, settings] = await Promise.all([
        api.users.getAll(),
        api.projects.getAll(),
        api.tasks.getAll(),
        api.notifications.getAll(),
        api.announcements.getAll(),
        api.timeEntries.getAll(),
        // Polled alongside records (rather than fetched once) so a department
        // rename/deletion made by another Coach — or in another tab — reaches
        // this session within one interval instead of needing a hard reload.
        api.settings.get(),
      ]);
      if (sessionGeneration !== sessionGenerationRef.current) return;
      setTeamSettings(settings);
      setState(prev => ({
        ...prev,
        users: users.map((u: any) => ({ ...u, id: String(u.id) })),
        projects: projects.map((p: any) => ({ ...p, id: String(p.id), createdAt: new Date(p.createdAt).getTime(), scrumMasters: (p.scrumMasters || []).map(String) })),
        tasks: tasks.map((t: any) => ({ 
          ...t, 
          id: String(t.id), 
          projectId: String(t.projectId),
          assignees: (t.assignees || []).map(String),
          contributors: (t.contributors || []).map(String),
          dependencies: (t.dependencies || []).map(String),
          createdAt: new Date(t.createdAt).getTime(),
          completedAt: t.completedAt ? new Date(t.completedAt).getTime() : undefined
        })),
        notifications: notifications.map((n: any) => ({ 
          ...n, 
          id: String(n.id), 
          toUserId: String(n.toUserId), 
          fromUserId: String(n.fromUserId),
          taskId: n.taskId ? String(n.taskId) : undefined,
          timestamp: new Date(n.timestamp).getTime() 
        })),
        announcements: announcements.map((a: any) => ({ 
          ...a, 
          id: String(a.id), 
          authorId: String(a.authorId),
          timestamp: new Date(a.timestamp).getTime() 
        })),
        timeEntries: timeEntries.map((e: any) => ({
          ...e,
          id: String(e.id),
          userId: String(e.userId),
          checkInAt: new Date(e.checkInAt).getTime(),
          checkOutAt: e.checkOutAt ? new Date(e.checkOutAt).getTime() : undefined,
          checkInConfirmedBy: e.checkInConfirmedBy ? String(e.checkInConfirmedBy) : undefined,
          checkInConfirmedAt: e.checkInConfirmedAt ? new Date(e.checkInConfirmedAt).getTime() : undefined,
          checkOutConfirmedBy: e.checkOutConfirmedBy ? String(e.checkOutConfirmedBy) : undefined,
          checkOutConfirmedAt: e.checkOutConfirmedAt ? new Date(e.checkOutConfirmedAt).getTime() : undefined,
          createdAt: new Date(e.createdAt).getTime(),
        })),
      }));
      setIsCloudSynced(true);
    } catch (error: any) {
      if (sessionGeneration !== sessionGenerationRef.current || error?.status === 401) return;
      console.error('Failed to fetch data:', error);
      setIsCloudSynced(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchData();
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchData, 15000);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        fetchData();
        if (!interval) { interval = setInterval(fetchData, 15000); }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData, isLoggedIn]);

  useEffect(() => {
    if (!annToast) return;
    const timer = setTimeout(() => setAnnToast(null), 8000);
    return () => clearTimeout(timer);
  }, [annToast]);

  useEffect(() => {
    if (!isLoggedIn || !state.currentUser || !state.announcements.length) return;
    const sorted = [...state.announcements].sort((a, b) => b.timestamp - a.timestamp);
    const latest = sorted[0];
    if (!latest) return;
    if (lastShownAnnRef.current === null) {
      lastShownAnnRef.current = latest.id;
      localStorage.setItem('lastSeenAnnouncementId', latest.id);
      return;
    }
    if (latest.id === lastShownAnnRef.current) return;
    lastShownAnnRef.current = latest.id;
    if (latest.authorId === state.currentUser.id) return;
    const isGlobal = latest.scope === 'Global';
    const isDeptMatch = state.currentUser.departments.some((d: string) => d === latest.targetDepartment);
    if (!isGlobal && !isDeptMatch) return;
    const author = state.users.find((u: any) => u.id === latest.authorId);
    setAnnToast({
      text: latest.text,
      scope: latest.scope || 'Global',
      dept: latest.targetDepartment,
      authorName: author?.name || 'Team',
    });
    localStorage.setItem('lastSeenAnnouncementId', latest.id);
  }, [state.announcements, state.currentUser, isLoggedIn, state.users]);

  const fetchAlerts = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const alerts = await api.fullscreenAlerts.list(true);
      setGlobalAlerts(alerts.filter((a: any) => a.targetAll));
    } catch {}
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchAlerts();
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchAlerts, 10000);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (interval) { clearInterval(interval); interval = null; }
      } else {
        fetchAlerts();
        if (!interval) { interval = setInterval(fetchAlerts, 10000); }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchAlerts, isLoggedIn]);

  const dismissAlert = (id: number) => {
    setDismissedAlertIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem('piobyte_dismissed_alerts', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  useEffect(() => {
    api.settings.get(true).then((s: TeamSettingsData) => {
      setTeamSettings(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    document.title = `${teamSettings.teamName} Hub`;
  }, [teamSettings.teamName]);

  useEffect(() => {
    const hex = teamSettings.themeColor.replace('#', '');
    document.documentElement.style.setProperty('--team-color', teamSettings.themeColor);
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      document.documentElement.style.setProperty('--team-color-rgb', `${r}, ${g}, ${b}`);
    }
  }, [teamSettings.themeColor]);

  // Restore the session from the httpOnly cookie by asking the server who we
  // are — the server, not localStorage, is the source of truth for auth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.auth.me(true);
        if (cancelled || !me) return;
        if (me.guest) {
          let g: any = null;
          try { g = JSON.parse(localStorage.getItem('frc_hub_guest') || 'null'); } catch {}
          setGuestSession(g || { eventId: me.eventId, eventName: '', pin: '', label: 'Guest' });
          setState(prev => ({
            ...prev,
            currentUser: {
              id: 'guest',
              name: g?.label || 'Guest',
              username: 'guest',
              roles: ['Guest'],
              departments: [],
              guestEventId: me.eventId,
            },
          }));
          setIsLoggedIn(true);
        } else if (me.id != null) {
          const mappedUser = { ...me, id: String(me.id) };
          setState(prev => ({ ...prev, currentUser: mappedUser }));
          setIsLoggedIn(true);
          localStorage.setItem('frc_hub_active_user', mappedUser.id);
        }
      } catch {
        // No valid session — stay on the login screen and drop stale hints.
        localStorage.removeItem('frc_hub_active_user');
        localStorage.removeItem('frc_hub_guest');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSeedDatabase = async () => {
    try {
      await api.seed();
      await fetchData();
      alert("Database seeded successfully! Log in as 'coach_mentor' or 'captain10991' with password 'changeme'.");
    } catch (e) {
      console.error("Seeding failed", e);
      alert("Seeding failed. Please try again.");
    }
  };

  // Notify users who were newly added as assignees on a task (excludes the
  // person making the change). Creating a notification also fires a device push.
  const notifyNewAssignees = async (
    taskId: string | number | null,
    taskTitle: string,
    newAssignees: (string | number)[] = [],
    prevAssignees: (string | number)[] = [],
  ) => {
    const prev = new Set(prevAssignees.map(String));
    const meId = String(state.currentUser?.id ?? '');
    const added = [...new Set(newAssignees.map(String))].filter(id => id && !prev.has(id) && id !== meId);
    await Promise.all(
      added.map(uid =>
        api.notifications.create({
          toUserId: parseInt(uid),
          fromUserId: parseInt(meId || '0'),
          taskId: taskId ? parseInt(String(taskId)) : null,
          message: `You were assigned to task: "${taskTitle}"`,
          read: false,
        }).catch(() => {}),
      ),
    );
  };

  const handleUpdateTask = async (updatedTask: Task) => {
    const existingTask = state.tasks.find(t => t.id === updatedTask.id);
    const isNewlyCompleted = updatedTask.status === TaskStatus.Complete && existingTask?.status !== TaskStatus.Complete;
    
    const taskData: any = { ...updatedTask };
    if (taskData.status === TaskStatus.Complete && !taskData.completedAt) {
      taskData.completedAt = new Date().toISOString();
    } else if (taskData.status !== TaskStatus.Complete) {
      taskData.completedAt = null;
    }
    taskData.projectId = parseInt(taskData.projectId);
    taskData.assignees = taskData.assignees.map(Number);
    taskData.contributors = (taskData.contributors || []).map(Number);
    taskData.dependencies = taskData.dependencies.map(Number);
    await api.tasks.update(parseInt(updatedTask.id), taskData);

    await notifyNewAssignees(updatedTask.id, updatedTask.title, taskData.assignees, existingTask?.assignees || []);

    if (isNewlyCompleted) {
      setShowConfetti(true);
    }

    await fetchData();
  };

  const handleUpdateAnnouncement = async (updatedAnn: Announcement) => {
    const data: any = { ...updatedAnn };
    data.authorId = parseInt(data.authorId);
    await api.announcements.update(parseInt(updatedAnn.id), data);
    await fetchData();
  };

  const handleDeleteAnnouncement = async (annId: string) => {
    await api.announcements.delete(parseInt(annId));
    await fetchData();
  };

  const handleDeleteTask = async (taskId: string) => {
    await api.tasks.delete(parseInt(taskId));
    await fetchData();
  };

  const handleNotify = async (taskId: string, toUserId: string, message: string) => {
    const isBroadcast = taskId.startsWith('broadcast:');
    await api.notifications.create({
      toUserId: parseInt(toUserId),
      fromUserId: parseInt(state.currentUser?.id || '0'),
      taskId: isBroadcast ? null : parseInt(taskId),
      message: isBroadcast ? `[broadcast:${taskId.split(':')[1]}] ${message}` : message,
      read: false
    });
    await fetchData();
  };

  const handleClearNotification = async (id: string) => {
    const notification = state.notifications.find(n => n.id === id);
    if (notification) {
      await api.notifications.update(parseInt(id), { read: true });
      await fetchData();
    }
  };

  const handleAddAnnouncement = async (ann: Announcement) => {
    const data: any = { ...ann };
    data.authorId = parseInt(data.authorId);
    delete data.id;
    await api.announcements.create(data);
    await fetchData();
    setAnnToast({ text: ann.text, scope: ann.scope || 'Global', dept: ann.targetDepartment, authorName: 'You' });
  };

  const handleLogin = async (username: string, password?: string) => {
    if (loginLoading) return;
    setLoginError('');
    setLoginLoading(true);
    try {
      await api.auth.login(username, password || '');
      // Do not enter the authenticated UI until the browser proves it retained
      // the httpOnly cookie by sending it back on a protected request.
      const user = await api.auth.me(true);
      const mappedUser = { ...user, id: String(user.id) };
      sessionGenerationRef.current += 1;
      setState(prev => ({ ...prev, currentUser: mappedUser }));
      setIsLoggedIn(true);
      localStorage.setItem('frc_hub_active_user', mappedUser.id);
    } catch (error: any) {
      setLoginError(
        error?.status === 401 && error?.message === 'Invalid credentials'
          ? 'The username or access key is incorrect.'
          : error?.status === 401
            ? 'Your login was accepted, but the browser did not retain the session. Open Preview in a new tab and try again.'
            : error?.message || 'Unable to sign in. Please try again.'
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGuestLogin = async (pin: string) => {
    setGuestLoginError('');
    setGuestLoading(true);
    try {
      const g = await api.auth.guestLogin(pin.trim());
      setGuestSession(g);
      setState(prev => ({
        ...prev,
        currentUser: {
          id: 'guest',
          name: g.label || 'Guest',
          username: 'guest',
          roles: ['Guest'],
          departments: [],
          guestEventId: g.eventId,
        },
      }));
      localStorage.setItem('frc_hub_guest', JSON.stringify(g));
      setIsLoggedIn(true);
      setTimeout(() => { window.location.hash = '#/scout'; }, 50);
    } catch (err: any) {
      setGuestLoginError(err?.message || 'Invalid or expired PIN. Check with the team that shared it.');
    } finally {
      setGuestLoading(false);
    }
  };

  const handleLogout = () => {
    api.auth.logout().catch(() => {});
    clearLocalSession();
  };

  if (!isLoggedIn) {
    return (
      <TeamSettingsContext.Provider value={{ settings: teamSettings, setSettings: setTeamSettings }}>
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="bg-white dark:bg-slate-900 rounded-[40px] p-16 w-full max-w-xl shadow-2xl animate-in zoom-in duration-500">
          <div className="text-center mb-12">
            <div className="w-32 h-32 mx-auto mb-8 shadow-2xl shadow-teamColor/40 transform rotate-3">
                <TeamLogo className="w-full h-full text-teamColor" />
            </div>
            <h1 className="text-5xl font-black text-slate-900 tracking-tighter uppercase mb-3 leading-tight">{teamSettings.teamName} HUB</h1>
            <p className="text-slate-400 font-black text-sm uppercase tracking-widest">TEAM {teamSettings.teamNumber} ROBOTICS</p>
          </div>

          {state.users.length === 0 && isCloudSynced ? (
            <div className="bg-slate-50 border-2 border-slate-100 p-8 rounded-[32px] text-center space-y-6">
                <div className="w-16 h-16 bg-teamColor/10 text-teamColor rounded-2xl flex items-center justify-center mx-auto">
                    <Database size={32} />
                </div>
                <div>
                    <h2 className="text-xl font-black text-slate-900 uppercase">Database Empty</h2>
                    <p className="text-xs text-slate-500 font-bold uppercase mt-1">Initialize your team to begin</p>
                </div>
                <button 
                    onClick={handleSeedDatabase}
                    className="w-full py-5 bg-slate-900 text-white font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                >
                    <Zap size={16} fill="currentColor" />
                    Seed Initial Team
                </button>
            </div>
          ) : (
            <>
              <form onSubmit={(e) => {
                e.preventDefault();
                const username = (e.currentTarget.elements.namedItem('username') as HTMLInputElement).value;
                const password = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
                handleLogin(username, password);
              }} className="space-y-8">
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-[0.2em] ml-2" style={{ color: '#1e293b' }}>Secure Username</label>
                    <input name="username" autoComplete="username" placeholder="coach_mentor / captain10991" className="w-full p-6 border-2 border-slate-300 rounded-3xl outline-none focus:ring-4 focus:ring-teamColor/10 focus:border-teamColor transition-all font-black uppercase text-sm placeholder:text-slate-400" style={{ backgroundColor: '#ffffff', color: '#0f172a' }} />
                </div>
                <div className="space-y-2">
                    <label className="block text-xs font-black uppercase tracking-[0.2em] ml-2" style={{ color: '#1e293b' }}>Access Key</label>
                    <input type="password" name="password" autoComplete="current-password" placeholder="••••••••" className="w-full p-6 border-2 border-slate-300 rounded-3xl outline-none focus:ring-4 focus:ring-teamColor/10 focus:border-teamColor transition-all font-black text-sm placeholder:text-slate-400" style={{ backgroundColor: '#ffffff', color: '#0f172a' }} />
                </div>
                {loginError && (
                  <div role="alert" aria-live="polite" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                    {loginError}
                  </div>
                )}
                <button type="submit" disabled={loginLoading} className="w-full py-6 bg-teamColor text-white font-black rounded-3xl hover:opacity-90 shadow-2xl shadow-teamColor/20 transition-all transform active:scale-95 text-xl tracking-widest uppercase disabled:cursor-wait disabled:opacity-60 disabled:transform-none">
                    {loginLoading ? (
                      <span className="inline-flex items-center justify-center gap-3"><Loader2 size={22} className="animate-spin" /> Signing In</span>
                    ) : 'Initialize System'}
                </button>
              </form>

              <div className="mt-8">
                <button
                  onClick={() => { setShowGuestForm(g => !g); setGuestLoginError(''); setGuestPin(''); }}
                  className="w-full flex items-center justify-center gap-2 py-3 text-xs font-bold text-slate-500 border border-dashed border-slate-200 rounded-2xl hover:border-slate-300 hover:text-slate-700 transition-colors"
                >
                  <KeyRound size={13} />
                  Guest / Alliance Access
                  {showGuestForm ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {showGuestForm && (
                  <div className="mt-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 animate-in fade-in duration-200">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Enter the 6-digit PIN shared by your alliance partner</p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={guestPin}
                      onChange={e => { setGuestPin(e.target.value.replace(/\D/g, '')); setGuestLoginError(''); }}
                      className="w-full p-4 bg-white border-2 border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-teamColor/20 focus:border-teamColor transition-all font-black text-2xl tracking-[0.4em] text-center text-slate-900 placeholder:text-slate-400"
                    />
                    {guestLoginError && (
                      <p className="text-red-500 text-xs font-bold text-center">{guestLoginError}</p>
                    )}
                    <button
                      onClick={() => handleGuestLogin(guestPin)}
                      disabled={guestPin.length < 6 || guestLoading}
                      className="w-full py-3 bg-slate-800 text-white font-black rounded-2xl hover:bg-black disabled:opacity-50 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
                    >
                      {guestLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                      Enter as Guest
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="mt-12 pt-8 border-t border-slate-100 text-center">
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest italic">
                {isCloudSynced ? 'Authorized Access Only • Cloud Sync Ready' : 'Connecting to Terminal...'}
            </p>
          </div>
        </div>
      </div>
      </TeamSettingsContext.Provider>
    );
  }

  const isGuest = state.currentUser?.roles?.includes('Guest') ?? false;
  const unreadCount = state.notifications.filter(n => n.toUserId === state.currentUser?.id && !n.read).length;
  
  const activeProjects = state.projects.filter(p => !p.archived && p.showInWarRoom !== false);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  // Header counters describe live work only — an archived board's tasks are
  // retired and must not pad the week's effort or the in-progress count.
  const liveTasks = onLiveBoard(state.tasks, state.projects);
  const weeklyEffort = liveTasks.reduce((acc, t) => {
    if (t.status === TaskStatus.Complete && t.completedAt && t.completedAt >= startOfWeek.getTime()) {
      return acc + (t.effort || 0);
    }
    return acc;
  }, 0);
  
  const layoutStats = {
    weeklyEffort,
    activeCount: liveTasks.filter(t => t.status === TaskStatus.InProgress).length,
    blockedCount: liveTasks.filter(t => t.status === TaskStatus.Blocked).length,
    projectCount: activeProjects.length
  };

  return (
    <TeamSettingsContext.Provider value={{ settings: teamSettings, setSettings: setTeamSettings }}>
    <HashRouter>
      <Layout user={state.currentUser} notificationsCount={unreadCount} onLogout={handleLogout} isSynced={isCloudSynced} stats={layoutStats} darkMode={darkMode} onToggleDarkMode={() => setDarkMode(!darkMode)}>
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={isGuest ? <Navigate to="/scout" replace /> :
                <Home 
                  state={state} 
                  onTaskClick={setActiveTaskModal} 
                  onClearNotification={handleClearNotification} 
                  onAddAnnouncement={handleAddAnnouncement}
                  onUpdateAnnouncement={handleUpdateAnnouncement}
                  onDeleteAnnouncement={handleDeleteAnnouncement}
                  onNotify={handleNotify}
                />
              } />
              <Route path="/war-room" element={isGuest ? <Navigate to="/scout" replace /> :
                <Dashboard 
                  state={state} 
                  onUpdateTask={handleUpdateTask} 
                  onDeleteTask={handleDeleteTask} 
                  onNotify={handleNotify}
                />
              } />
              <Route path="/boards" element={isGuest ? <Navigate to="/scout" replace /> :
                <KanbanBoard
                  state={state}
                  onDataChanged={fetchData}
                  onAddTask={async (t) => {
                      const taskData: any = { ...t };
                      if (taskData.status === TaskStatus.Complete) taskData.completedAt = new Date().toISOString();
                      taskData.projectId = parseInt(taskData.projectId);
                      taskData.assignees = taskData.assignees.map(Number);
                      taskData.contributors = (taskData.contributors || []).map(Number);
                      taskData.dependencies = taskData.dependencies.map(Number);
                      delete taskData.id;
                      const created = await api.tasks.create(taskData);
                      await notifyNewAssignees(created?.id ?? null, taskData.title, taskData.assignees, []);
                      await fetchData();
                  }}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                  onNotify={handleNotify}
                  onAddProject={async (proj) => {
                    const data: any = { ...proj };
                    delete data.id;
                    await api.projects.create(data);
                    await fetchData();
                  }}
                  onUpdateProject={async (proj) => {
                    const data: any = { ...proj };
                    data.scrumMasters = proj.scrumMasters.map(Number);
                    await api.projects.update(parseInt(proj.id), data);
                    for (const smId of proj.scrumMasters) {
                      const user = state.users.find(u => u.id === smId);
                      if (user && !user.roles.includes(Role.ScrumMaster)) {
                        await api.users.update(parseInt(smId), { roles: [...user.roles, Role.ScrumMaster] });
                      }
                    }
                    await fetchData();
                  }}
                  onArchiveProject={async (id) => {
                    const project = state.projects.find(p => p.id === id);
                    await api.projects.update(parseInt(id), { archived: !project?.archived });
                    await fetchData();
                  }}
                />
              } />
              <Route path="/time" element={isGuest ? <Navigate to="/scout" replace /> :
                <TimeTracking state={state} onRefresh={fetchData} />
              } />
              <Route path="/scout" element={
                <Scout currentUser={state.currentUser} />
              } />
              {/* Certifications is retired — old bookmarks still point at #/safety and #/certifications. */}
              <Route path="/safety" element={<Navigate to="/" replace />} />
              <Route path="/certifications" element={<Navigate to="/" replace />} />
              <Route path="/team" element={isGuest ? <Navigate to="/scout" replace /> :
                <TeamManagement 
                  state={state}
                  onAddUser={async (u) => {
                    const data: any = { ...u };
                    delete data.id;
                    await api.users.create(data);
                    await fetchData();
                  }}
                  onUpdateUser={async (u) => {
                    await api.users.update(parseInt(u.id), u);
                    await fetchData();
                  }}
                  onDeleteUser={async (id) => {
                    await api.users.delete(parseInt(id));
                    await fetchData();
                  }}
                />
              } />
              <Route path="/calendar" element={isGuest ? <Navigate to="/scout" replace /> : <Calendar currentUser={state.currentUser} />} />
              <Route path="/resources" element={isGuest ? <Navigate to="/scout" replace /> : <Resources currentUser={state.currentUser} users={state.users} />} />
              <Route path="/fundraising" element={<Navigate to="/" replace />} />
              <Route path="/control-panel" element={isGuest ? <Navigate to="/scout" replace /> :
                <ControlPanel
                  currentUserRoles={state.currentUser?.roles || []}
                  currentUserId={state.currentUser?.id || null}
                />
              } />
              <Route path="*" element={<Navigate to={isGuest ? "/scout" : "/"} />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>

        {activeTaskModal && (
          <TaskModal 
            task={activeTaskModal}
            users={state.users}
            allTasks={state.tasks}
            currentUser={state.currentUser}
            onClose={() => setActiveTaskModal(null)}
            onNotify={(to, msg) => handleNotify(activeTaskModal.id, to, msg)}
            onSave={async (updated) => {
              await handleUpdateTask(updated);
              setActiveTaskModal(null);
            }}
            onSaveWithoutClose={async (updated) => {
              await handleUpdateTask(updated);
            }}
            onDelete={async (id) => {
              await handleDeleteTask(id);
              setActiveTaskModal(null);
            }}
          />
        )}
        <Confetti show={showConfetti} onComplete={() => setShowConfetti(false)} />

        {isLoggedIn && state.currentUser && (state.currentUser.roles as string[]).includes('Coach') && (
          <CoachTutorial
            onNavigate={(route) => { window.location.hash = '#' + route; }}
          />
        )}

        {annToast && (
          <div className="fixed bottom-6 right-6 z-[400] animate-in slide-in-from-bottom-4 fade-in duration-300 max-w-sm w-full">
            <div className="bg-slate-950 dark:bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-4 flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: teamSettings.themeColor }}>
                <Bell size={14} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: teamSettings.themeColor }}>
                  {annToast.scope === 'Global' ? 'Global Announcement' : `${annToast.dept} Announcement`}
                </p>
                {annToast.authorName && (
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">{annToast.authorName}</p>
                )}
                <p className="text-xs font-bold text-white leading-snug line-clamp-3">
                  {annToast.text.length > 100 ? `${annToast.text.slice(0, 100)}\u2026` : annToast.text}
                </p>
                <button
                  onClick={() => { window.location.hash = '#/'; setAnnToast(null); }}
                  className="mt-2 text-[9px] font-black uppercase tracking-widest transition-colors hover:opacity-70"
                  style={{ color: teamSettings.themeColor }}
                >
                  View &rarr;
                </button>
              </div>
              <button onClick={() => setAnnToast(null)} className="flex-shrink-0 text-slate-500 hover:text-white transition-colors mt-0.5">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {(() => {
          const now = new Date();
          const undismissed = globalAlerts.filter(a =>
            a.active &&
            !dismissedAlertIds.has(a.id) &&
            (!a.expiresAt || new Date(a.expiresAt) > now)
          );
          if (undismissed.length === 0) return null;
          const alert = undismissed[0];
          const borderColor = alert.type === 'safety' ? 'border-red-600' : alert.type === 'urgent' ? 'border-orange-500' : 'border-blue-500';
          const iconColor = alert.type === 'safety' ? 'text-red-600' : alert.type === 'urgent' ? 'text-orange-500' : 'text-blue-500';
          const bgColor = alert.type === 'safety' ? 'bg-red-50 dark:bg-red-900/20' : alert.type === 'urgent' ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-blue-50 dark:bg-blue-900/20';
          const Icon = alert.type === 'safety' ? ShieldAlert : alert.type === 'urgent' ? AlertTriangle : Bell;
          return (
            <div className="fixed inset-0 z-[500] bg-black/90 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300">
              <div className={`bg-white dark:bg-slate-800 rounded-3xl w-full max-w-lg p-8 text-center shadow-2xl border-t-8 ${borderColor}`}>
                <div className="flex justify-end mb-2">
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className={`w-16 h-16 ${bgColor} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                  <Icon size={32} className={iconColor} />
                </div>
                <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${iconColor}`}>
                  {alert.type === 'safety' ? '⚠ Safety Alert' : alert.type === 'urgent' ? '! Urgent' : 'Team Notification'}
                </p>
                <p className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-snug">{alert.message}</p>
                {undismissed.length > 1 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mt-4">{undismissed.length - 1} more alert{undismissed.length > 2 ? 's' : ''} pending</p>
                )}
                <button
                  onClick={() => dismissAlert(alert.id)}
                  className={`mt-6 px-8 py-3 font-black text-sm uppercase tracking-widest rounded-2xl text-white transition-all ${
                    alert.type === 'safety' ? 'bg-red-600 hover:bg-red-700' : alert.type === 'urgent' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })()}
      </Layout>
    </HashRouter>
    </TeamSettingsContext.Provider>
  );
};

export default App;
