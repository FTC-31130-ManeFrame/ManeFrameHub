import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Kanban, Users, LogOut, Home as HomeIcon, Cloud, CloudOff, Menu, X, Clock, TrendingUp, Activity, AlertTriangle, Flag, Crosshair, Moon, Sun, Bell, BellRing, BellOff, Trash2, Plus, CalendarDays, BookOpen, Settings } from 'lucide-react';
import { getPushStatus, enablePush, disablePush, type PushStatus } from '../services/push';
import { api } from '../services/api';
import TeamLogo from './TeamLogo';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { useTeamTime } from '../utils/timeFormat';

interface LayoutProps {
  children: React.ReactNode;
  user: any;
  notificationsCount: number;
  onLogout: () => void;
  isSynced?: boolean;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  stats?: {
    weeklyEffort: number;
    activeCount: number;
    blockedCount: number;
    projectCount: number;
  };
}

const ALERT_TYPES = [
  { value: 'general', label: 'General', color: 'blue' },
  { value: 'urgent', label: 'Urgent', color: 'orange' },
  { value: 'safety', label: 'Safety', color: 'red' },
];

const EXPIRY_OPTIONS = [
  { label: '30 min', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: 'Never', hours: null },
];

const Layout: React.FC<LayoutProps> = ({ children, user, notificationsCount, onLogout, isSynced = false, stats, darkMode, onToggleDarkMode }) => {
  const { settings } = useTeamSettings();
  const { fmtTime } = useTeamTime();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>('default');
  const [pushBusy, setPushBusy] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState<any[]>([]);
  const [alertForm, setAlertForm] = useState({
    message: '',
    type: 'general',
    targetAll: true,
    targetPitDisplay: false,
    expiryHours: null as number | null,
  });
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertError, setAlertError] = useState('');

  const isCoachOrCaptain = user?.roles?.includes('Coach') || user?.roles?.includes('Team Captain');
  const isGuest = user?.roles?.includes('Guest');

  useEffect(() => {
    getPushStatus().then(setPushStatus).catch(() => {});
  }, []);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushStatus === 'subscribed') {
        await disablePush();
        setPushStatus('granted');
      } else {
        await enablePush();
        setPushStatus('subscribed');
      }
    } catch (e: any) {
      alert(e?.message || 'Could not update notifications.');
      setPushStatus(await getPushStatus());
    } finally {
      setPushBusy(false);
    }
  };

  const fetchActiveAlerts = async () => {
    try {
      const alerts = await api.fullscreenAlerts.list(false);
      setActiveAlerts(alerts.filter((a: any) => a.active));
    } catch {}
  };

  const openAlertModal = () => {
    setShowAlertModal(true);
    fetchActiveAlerts();
    setAlertForm({ message: '', type: 'general', targetAll: true, targetPitDisplay: false, expiryHours: null });
    setAlertError('');
  };

  const handleCreateAlert = async () => {
    if (!alertForm.message.trim()) { setAlertError('Message is required'); return; }
    if (!alertForm.targetAll && !alertForm.targetPitDisplay) { setAlertError('Select at least one target'); return; }
    setAlertSaving(true);
    setAlertError('');
    try {
      const expiresAt = alertForm.expiryHours
        ? new Date(Date.now() + alertForm.expiryHours * 60 * 60 * 1000).toISOString()
        : null;
      await api.fullscreenAlerts.create({
        message: alertForm.message.trim(),
        type: alertForm.type,
        targetAll: alertForm.targetAll,
        targetPitDisplay: alertForm.targetPitDisplay,
        createdBy: parseInt(user.id),
        active: true,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setAlertForm({ message: '', type: 'general', targetAll: true, targetPitDisplay: false, expiryHours: null });
      fetchActiveAlerts();
    } catch (e: any) {
      setAlertError(e.message || 'Failed to create alert');
    } finally {
      setAlertSaving(false);
    }
  };

  const handleDeactivateAlert = async (id: number) => {
    try {
      await api.fullscreenAlerts.update(id, parseInt(user.id), { active: false });
      fetchActiveAlerts();
    } catch {}
  };

  const handleDeleteAlert = async (id: number) => {
    try {
      await api.fullscreenAlerts.delete(id, parseInt(user.id));
      fetchActiveAlerts();
    } catch {}
  };

  const alertTypeColor = (type: string) => {
    if (type === 'urgent') return 'border-orange-500';
    if (type === 'safety') return 'border-red-600';
    return 'border-blue-500';
  };

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 overflow-hidden">
      <div 
        className={`md:hidden fixed inset-0 bg-black/60 z-40 transition-opacity ${
          mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside className={`
        fixed md:relative inset-y-0 left-0 z-50
        ${collapsed ? 'w-16' : 'w-56 md:w-52 lg:w-56'}
        bg-slate-950 text-white flex flex-col shadow-2xl
        transform transition-all duration-300 ease-in-out
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Logo header — compact */}
        <div className="px-2 py-2 md:px-3 md:py-3 lg:px-3 lg:py-3 flex items-center justify-between border-b border-white/10 flex-shrink-0">
          <div className={`flex items-center gap-2.5 overflow-hidden transition-all duration-300 ${collapsed ? 'w-0 opacity-0' : 'w-full opacity-100'}`}>
            <div className="flex-shrink-0" style={{ color: settings.themeColor }}>
              <TeamLogo className="w-7 h-7 rounded" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-black text-sm leading-tight tracking-tighter uppercase truncate">{settings.teamName} Hub</h1>
              <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: settings.themeColor }}>Team {settings.teamNumber}</p>
            </div>
          </div>
          
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex-shrink-0"
          >
            <Menu size={16} className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
          </button>

          <button 
            className="md:hidden p-1.5 text-slate-400 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav — no overflow, tightly spaced */}
        <nav className={`flex-1 min-h-0 ${collapsed ? 'px-2 py-2' : 'px-2 py-1.5 md:px-3 md:py-2 lg:px-3 lg:py-2.5'} flex flex-col gap-0.5 md:gap-1 lg:gap-1 overflow-y-auto`}>
          {!isGuest && <NavItem to="/" icon={<HomeIcon size={16} />} label="HOME" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {!isGuest && <NavItem to="/war-room" icon={<LayoutDashboard size={16} />} label="WAR ROOM" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {!isGuest && <NavItem to="/boards" icon={<Kanban size={16} />} label="BOARDS" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {!isGuest && <NavItem to="/time" icon={<Clock size={16} />} label="TIME" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          <NavItem to="/scout" icon={<Crosshair size={16} />} label="EVENTS" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />
          {!isGuest && <NavItem to="/team" icon={<Users size={16} />} label="TEAM" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {!isGuest && <NavItem to="/calendar" icon={<CalendarDays size={16} />} label="CALENDAR" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {!isGuest && <NavItem to="/resources" icon={<BookOpen size={16} />} label="RESOURCES" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />}
          {isCoachOrCaptain && (
            <NavItem to="/control-panel" icon={<Settings size={16} />} label="CONTROL PANEL" collapsed={collapsed} onClick={() => setMobileMenuOpen(false)} />
          )}
          
          {/* Utility buttons — separated but compact */}
          <div className="mt-auto pt-2 border-t border-white/10 flex flex-col gap-0.5">
            <button
              onClick={onToggleDarkMode}
              title={darkMode ? "Light Mode" : "Dark Mode"}
              className={`w-full flex items-center ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'} rounded-xl transition-all font-black text-[10px] tracking-widest text-slate-500 hover:text-white hover:bg-white/5`}
            >
              <div className="flex-shrink-0">{darkMode ? <Sun size={16} /> : <Moon size={16} />}</div>
              {!collapsed && <span>{darkMode ? 'LIGHT MODE' : 'DARK MODE'}</span>}
            </button>

            {!isGuest && pushStatus !== 'unsupported' && (
              <button
                onClick={togglePush}
                disabled={pushBusy || pushStatus === 'denied'}
                title={
                  pushStatus === 'denied'
                    ? 'Notifications are blocked in your browser settings'
                    : pushStatus === 'subscribed'
                    ? 'Turn off device notifications'
                    : 'Get notified on this device'
                }
                className={`w-full flex items-center ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'} rounded-xl transition-all font-black text-[10px] tracking-widest disabled:opacity-40 ${
                  pushStatus === 'subscribed' ? 'text-white hover:bg-white/5' : 'text-slate-500 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex-shrink-0">{pushStatus === 'subscribed' ? <BellRing size={16} /> : pushStatus === 'denied' ? <BellOff size={16} /> : <Bell size={16} />}</div>
                {!collapsed && <span>{pushStatus === 'subscribed' ? 'NOTIFICATIONS ON' : pushStatus === 'denied' ? 'NOTIFS BLOCKED' : 'ENABLE NOTIFS'}</span>}
              </button>
            )}

            {isCoachOrCaptain && (
              <button
                onClick={openAlertModal}
                title="Push Alert"
                className={`w-full flex items-center ${collapsed ? 'justify-center py-2' : 'gap-2.5 px-3 py-2'} rounded-xl transition-all font-black text-[10px] tracking-widest text-teamColor/70 hover:text-white hover:bg-teamColor`}
              >
                <div className="flex-shrink-0"><Bell size={16} /></div>
                {!collapsed && <span>PUSH ALERT</span>}
              </button>
            )}
          </div>
        </nav>

        {/* User / logout — compact */}
        <div className={`${collapsed ? 'px-2 py-2' : 'px-2 py-2 md:px-3 md:py-3 lg:px-3 lg:py-3'} border-t border-white/10 bg-black/40 flex-shrink-0`}>
          <div className={`flex items-center gap-2.5 ${collapsed ? 'mb-2' : 'mb-2.5'} transition-all duration-300`}>
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-xl bg-teamColor flex items-center justify-center font-black text-sm border border-teamColor/30 shadow-inner">
                {user?.name?.[0] || 'U'}
              </div>
              {notificationsCount > 0 && !collapsed && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white text-teamColor rounded-full flex items-center justify-center text-[8px] font-black shadow-lg">
                  {notificationsCount}
                </div>
              )}
            </div>
            <div className={`flex-1 overflow-hidden min-w-0 transition-all duration-300 ${collapsed ? 'w-0 opacity-0' : 'w-full opacity-100'}`}>
              <p className="text-xs font-bold truncate leading-tight">{user?.name}</p>
              <p className="text-[9px] text-teamColor/70 font-black uppercase tracking-wider truncate">{user?.roles?.[0]}</p>
            </div>
          </div>
          <button 
            onClick={() => { onLogout(); setMobileMenuOpen(false); }}
            className={`w-full flex items-center justify-center gap-2 ${collapsed ? 'px-2 py-1.5' : 'px-3 py-1.5'} text-[10px] font-bold text-slate-400 hover:text-white hover:bg-teamColor transition-all border border-white/10 rounded-xl`}
            title={collapsed ? "SIGN OUT" : ""}
          >
            <LogOut size={13} />
            {!collapsed && "SIGN OUT"}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-900">
        <header className="h-14 md:h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 md:px-8 justify-between gap-3">
          <div className="flex items-center gap-3">
            <button 
              className="md:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <div className="flex items-center gap-2">
              <div className="md:hidden text-teamColor">
                <TeamLogo className="w-7 h-7" />
              </div>
              <h2 className="text-sm md:text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">
                <span className="hidden sm:inline">{settings.teamName.toUpperCase()} </span>HUB
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {stats && (
              <div className="hidden md:flex items-center gap-2 text-[10px]">
                <div className="flex items-center gap-1 px-2 py-1 bg-teamColor/5 rounded-lg border border-teamColor/20">
                  <TrendingUp size={12} className="text-teamColor" />
                  <span className="font-black text-teamColor">{stats.weeklyEffort}</span>
                  <span className="text-teamColor/70 font-bold">pts</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 rounded-lg border border-slate-100">
                  <Activity size={12} className="text-slate-600" />
                  <span className="font-black text-slate-800">{stats.activeCount}</span>
                  <span className="text-slate-400 font-bold">active</span>
                </div>
                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${stats.blockedCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
                  <AlertTriangle size={12} className={stats.blockedCount > 0 ? 'text-amber-600' : 'text-slate-400'} />
                  <span className={`font-black ${stats.blockedCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{stats.blockedCount}</span>
                  <span className={`font-bold ${stats.blockedCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>blocked</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 rounded-lg border border-slate-100">
                  <Flag size={12} className="text-slate-600" />
                  <span className="font-black text-slate-800">{stats.projectCount}</span>
                  <span className="text-slate-400 font-bold">projects</span>
                </div>
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded-xl border border-slate-100">
              <div className={`w-2 h-2 rounded-full ${isSynced ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' : 'bg-red-500'}`} />
              {isSynced ? <Cloud size={12} className="text-slate-300" /> : <CloudOff size={12} className="text-red-300" />}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-slate-50/50 dark:bg-slate-900">
          <div className="w-full h-full p-2 md:p-4 lg:p-6 transition-all duration-300">
            {children}
          </div>
        </div>
      </main>

      {showAlertModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border-t-8 border-teamColor max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <Bell size={20} className="text-teamColor" /> Push Alert
                </h2>
                <p className="text-[10px] text-teamColor/70 font-bold uppercase tracking-widest mt-0.5">Send fullscreen notification to team</p>
              </div>
              <button onClick={() => setShowAlertModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Message</label>
                <textarea
                  value={alertForm.message}
                  onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium h-24 resize-none"
                  placeholder="Enter alert message..."
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Type</label>
                <div className="flex gap-2">
                  {ALERT_TYPES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setAlertForm({ ...alertForm, type: t.value })}
                      className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${
                        alertForm.type === t.value
                          ? t.color === 'red' ? 'bg-red-600 text-white' : t.color === 'orange' ? 'bg-orange-500 text-white' : 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Target</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAlertForm({ ...alertForm, targetAll: !alertForm.targetAll })}
                    className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${
                      alertForm.targetAll ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    All Users
                  </button>
                  <button
                    onClick={() => setAlertForm({ ...alertForm, targetPitDisplay: !alertForm.targetPitDisplay })}
                    className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${
                      alertForm.targetPitDisplay ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Pit Display
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Expires</label>
                <div className="flex gap-2">
                  {EXPIRY_OPTIONS.map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => setAlertForm({ ...alertForm, expiryHours: opt.hours })}
                      className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${
                        alertForm.expiryHours === opt.hours ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {alertError && (
                <p className="text-red-600 text-xs font-bold">{alertError}</p>
              )}

              <button
                onClick={handleCreateAlert}
                disabled={alertSaving}
                className="w-full py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 uppercase tracking-widest text-sm transition-all disabled:opacity-50"
              >
                {alertSaving ? 'Sending...' : 'Send Alert'}
              </button>

              {activeAlerts.length > 0 && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Active Alerts</label>
                  <div className="space-y-2">
                    {activeAlerts.map((alert: any) => (
                      <div key={alert.id} className={`flex items-start justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border-l-4 ${alertTypeColor(alert.type)}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2">{alert.message}</p>
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <span className="text-[9px] font-black text-slate-400 uppercase">{alert.type}</span>
                            {alert.targetAll && <span className="text-[9px] font-black text-blue-500 uppercase">All</span>}
                            {alert.targetPitDisplay && <span className="text-[9px] font-black text-violet-500 uppercase">Pit Display</span>}
                            {alert.expiresAt && (
                              <span className="text-[9px] font-black text-orange-500 uppercase">
                                Exp {fmtTime(alert.expiresAt)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleDeactivateAlert(alert.id)}
                            className="px-2 py-1 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-bold hover:bg-slate-300 transition-all"
                            title="Deactivate"
                          >
                            Off
                          </button>
                          <button
                            onClick={() => handleDeleteAlert(alert.id)}
                            className="p-1.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 transition-all"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const NavItem: React.FC<{ to: string; icon: React.ReactNode; label: string; collapsed?: boolean; onClick?: () => void }> = ({ to, icon, label, collapsed, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    title={collapsed ? label : ""}
    className={({ isActive }) =>
      `flex items-center ${collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2'} rounded-xl transition-all font-black text-[10px] tracking-widest ${
        isActive 
          ? 'bg-teamColor text-white shadow-lg shadow-teamColor/20' 
          : 'text-slate-500 hover:text-white hover:bg-white/5'
      }`
    }
  >
    <div className="flex-shrink-0">{icon}</div>
    {!collapsed && <span>{label}</span>}
  </NavLink>
);

export default Layout;
