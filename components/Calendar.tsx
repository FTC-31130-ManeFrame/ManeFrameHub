import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Trophy, Users, Plus, X, Pencil, Trash2, Loader2, RefreshCw, Download, RotateCcw, CheckSquare, Square, AlertTriangle, Archive, ArchiveRestore, Lock, Rss, Copy, Check } from 'lucide-react';
import { api } from '../services/api';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { todayLocalStr } from '../utils/dates';
import EventRosterModal from './EventRosterModal';
import UserMultiSelect from './UserMultiSelect';
import { CATEGORY_STYLES, HOUR_CATEGORIES } from './hourCategoryStyles';

interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  type: string;
  location: string;
  createdBy: number;
  createdAt: string;
  recurrenceType?: string | null;
  recurrenceEndsOn?: string | null;
  parentEventId?: number | null;
  instanceDate?: string | null;
  deletedDates?: string | null;
  attending: boolean;
  signupEnabled?: boolean;
  capacity?: number | null;
  acceptedCount?: number;
  inviteOnly?: boolean;
}

interface VirtualInstance extends CalendarEvent {
  _isVirtual: true;
  _instanceDate: string;
}

interface CalendarProps {
  currentUser?: any;
}

const TYPE_STYLES = CATEGORY_STYLES;

const COMPETITION_NOT_ATTENDING = {
  bg: 'bg-slate-100 dark:bg-slate-700/60',
  text: 'text-slate-500 dark:text-slate-400',
  border: 'border border-dashed border-slate-400 dark:border-slate-500',
  icon: <Trophy size={10} />,
  label: 'Competition',
};

const EVENT_TYPES: readonly string[] = HOUR_CATEGORIES;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const EMPTY_FORM = {
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  type: 'shop',
  location: '',
  recurrenceType: 'none',
  recurrenceEndsOn: '',
  attending: true,
  signupEnabled: true,
  capacity: '',
  inviteOnly: false,
  invitees: [] as (number | string)[],
};

function getTypeStyle(ev: CalendarEvent) {
  if (ev.type === 'competition' && !ev.attending) return COMPETITION_NOT_ATTENDING;
  return TYPE_STYLES[ev.type] || TYPE_STYLES['other'];
}

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function expandRecurring(events: CalendarEvent[]): (CalendarEvent | VirtualInstance)[] {
  const result: (CalendarEvent | VirtualInstance)[] = [];
  const exceptionDates = new Set<string>();
  for (const ev of events) {
    if (ev.parentEventId && ev.instanceDate) {
      exceptionDates.add(`${ev.parentEventId}::${ev.instanceDate}`);
    }
  }
  for (const ev of events) {
    if (ev.recurrenceType === 'weekly' && ev.recurrenceEndsOn && !ev.parentEventId) {
      const deleted: string[] = ev.deletedDates ? JSON.parse(ev.deletedDates) : [];
      const deletedSet = new Set(deleted);
      let cur = ev.startDate;
      const end = ev.recurrenceEndsOn;
      let iter = 0;
      while (cur <= end && iter < 200) {
        iter++;
        if (!deletedSet.has(cur) && !exceptionDates.has(`${ev.id}::${cur}`)) {
          result.push({ ...ev, _isVirtual: true, _instanceDate: cur } as VirtualInstance);
        }
        cur = addWeeks(cur, 1);
      }
    } else {
      result.push(ev);
    }
  }
  return result;
}

const Calendar: React.FC<CalendarProps> = ({ currentUser }) => {
  const { settings } = useTeamSettings();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<'month' | 'list'>('month');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [chipPopover, setChipPopover] = useState<{ event: CalendarEvent | VirtualInstance; x: number; y: number } | null>(null);
  const [rosterEvent, setRosterEvent] = useState<{ id: number; title: string; startDate: string } | null>(null);
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [tbaModal, setTbaModal] = useState(false);
  const [tbaLoading, setTbaLoading] = useState(false);
  const [tbaEvents, setTbaEvents] = useState<any[]>([]);
  const [tbaSelected, setTbaSelected] = useState<Set<string>>(new Set());
  const [tbaImporting, setTbaImporting] = useState(false);
  const [tbaError, setTbaError] = useState('');
  const [toaModal, setToaModal] = useState(false);
  const [toaLoading, setToaLoading] = useState(false);
  const [toaEvents, setToaEvents] = useState<any[]>([]);
  const [toaSelected, setToaSelected] = useState<Set<string>>(new Set());
  const [toaImporting, setToaImporting] = useState(false);
  const [toaError, setToaError] = useState('');

  const [subscribeModal, setSubscribeModal] = useState(false);
  const [feedUrls, setFeedUrls] = useState<{ url: string; webcalUrl: string } | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRegenerating, setFeedRegenerating] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);

  const isCoachOrCaptain = currentUser?.roles?.some(r => ['Coach', 'Team Captain', 'Department Head'].includes(r));

  const [showArchivedEvents, setShowArchivedEvents] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  // Only leadership can mark an event invite-only, so only fetch the roster
  // for the picker when they can actually see the create/edit dialog.
  useEffect(() => {
    if (!isCoachOrCaptain) return;
    api.users.getAll().then(setAllUsers).catch(() => {});
  }, [isCoachOrCaptain]);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.calendar.getAll(showArchivedEvents);
      setEvents(data);
    } catch (e) {
      console.error('Failed to fetch calendar events:', e);
    } finally {
      setLoading(false);
    }
  }, [showArchivedEvents]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  useEffect(() => {
    if (!chipPopover) return;
    const close = (e: MouseEvent) => {
      const el = document.getElementById('chip-popover');
      if (el && !el.contains(e.target as Node)) setChipPopover(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [chipPopover]);

  const expanded = useMemo(() => expandRecurring(events), [events]);

  const daysInMonth = useMemo(() => {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cells: (number | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, (CalendarEvent | VirtualInstance)[]> = {};
    const addToMap = (key: string, ev: CalendarEvent | VirtualInstance) => {
      if (!map[key]) map[key] = [];
      const alreadyThere = map[key].some(e => {
        if ('_isVirtual' in ev && '_isVirtual' in e) return e.id === ev.id && (e as VirtualInstance)._instanceDate === (ev as VirtualInstance)._instanceDate;
        return e.id === ev.id;
      });
      if (!alreadyThere) map[key].push(ev);
    };

    for (const ev of expanded) {
      const startKey = '_isVirtual' in ev ? (ev as VirtualInstance)._instanceDate : ev.startDate;
      addToMap(startKey, ev);
      if (!('_isVirtual' in ev) && ev.endDate) {
        let cur = new Date(ev.startDate + 'T12:00:00');
        const end = new Date(ev.endDate + 'T12:00:00');
        cur.setDate(cur.getDate() + 1);
        while (cur <= end) {
          addToMap(cur.toISOString().slice(0, 10), ev);
          cur.setDate(cur.getDate() + 1);
        }
      }
    }
    return map;
  }, [expanded]);

  const upcomingEvents = useMemo(() => {
    const now = todayLocalStr(today);
    return [...expanded]
      .filter(ev => {
        const start = '_isVirtual' in ev ? (ev as VirtualInstance)._instanceDate : ev.startDate;
        return start >= now;
      })
      .sort((a, b) => {
        const aStart = '_isVirtual' in a ? (a as VirtualInstance)._instanceDate : a.startDate;
        const bStart = '_isVirtual' in b ? (b as VirtualInstance)._instanceDate : b.startDate;
        return aStart.localeCompare(bStart);
      })
      .slice(0, 8);
  }, [expanded]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  const openAdd = (date?: string) => {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, startDate: date || '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setEditingEvent(ev);
    setForm({
      title: ev.title,
      description: ev.description || '',
      startDate: ev.startDate,
      endDate: ev.endDate || '',
      startTime: ev.startTime || '',
      endTime: ev.endTime || '',
      type: ev.type,
      location: ev.location || '',
      recurrenceType: ev.recurrenceType || 'none',
      recurrenceEndsOn: ev.recurrenceEndsOn || '',
      attending: ev.attending !== false,
      signupEnabled: ev.signupEnabled === true,
      capacity: (ev as any).capacity != null ? String((ev as any).capacity) : '',
      inviteOnly: !!ev.inviteOnly,
      invitees: [],
    });
    setError('');
    setShowModal(true);
    if (ev.inviteOnly) {
      api.events.roster(ev.id)
        .then((rows: any[]) => setForm(f => ({ ...f, invitees: rows.map(r => r.userId) })))
        .catch(() => {});
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.startDate) { setError('Start date is required'); return; }
    if (form.endDate && form.endDate < form.startDate) { setError('End date cannot be before start date'); return; }
    if (form.recurrenceType === 'weekly' && !form.recurrenceEndsOn) { setError('Ends-on date is required for weekly recurrence'); return; }
    if (form.recurrenceType === 'weekly' && form.recurrenceEndsOn < form.startDate) { setError('Ends-on must be after the start date'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        title: form.title.trim(),
        description: form.description.trim(),
        startDate: form.startDate,
        endDate: form.endDate || null,
        startTime: form.startTime || null,
        endTime: form.endTime || null,
        type: form.type,
        location: form.location.trim(),
        attending: form.attending,
        recurrenceType: form.recurrenceType !== 'none' ? form.recurrenceType : null,
        recurrenceEndsOn: form.recurrenceType !== 'none' ? form.recurrenceEndsOn : null,
        signupEnabled: form.signupEnabled,
        capacity: form.signupEnabled && form.capacity.trim() ? parseInt(form.capacity, 10) : null,
        inviteOnly: form.inviteOnly,
        invitees: form.inviteOnly ? form.invitees : [],
      };
      if (editingEvent) {
        await api.calendar.update(editingEvent.id, parseInt(currentUser.id), payload);
      } else {
        await api.calendar.create(parseInt(currentUser.id), payload);
      }
      await fetchEvents();
      setShowModal(false);
    } catch (e: any) {
      setError(e.message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ev: CalendarEvent) => {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try {
      await api.calendar.delete(ev.id, parseInt(currentUser.id));
      await fetchEvents();
    } catch (e) {
      console.error('Failed to delete event:', e);
    }
  };

  const handleDeleteThisOccurrence = async (instance: VirtualInstance) => {
    const parent = events.find(e => e.id === instance.id);
    if (!parent) return;
    const existing: string[] = parent.deletedDates ? JSON.parse(parent.deletedDates) : [];
    const newDeleted = [...existing, instance._instanceDate];
    try {
      await api.calendar.patchDeletedDates(parent.id, parseInt(currentUser.id), newDeleted);
      await fetchEvents();
      setChipPopover(null);
    } catch (e) {
      console.error('Failed to delete occurrence:', e);
    }
  };

  const handleDeleteAllOccurrences = async (ev: CalendarEvent) => {
    if (!confirm(`Delete all occurrences of "${ev.title}"?`)) return;
    try {
      await api.calendar.delete(ev.id, parseInt(currentUser.id));
      await fetchEvents();
      setChipPopover(null);
    } catch (e) {
      console.error('Failed to delete all occurrences:', e);
    }
  };

  const handleEditThisOccurrence = async (instance: VirtualInstance) => {
    const parent = events.find(e => e.id === instance.id);
    if (!parent) return;
    const existing: string[] = parent.deletedDates ? JSON.parse(parent.deletedDates) : [];
    const newDeleted = [...existing, instance._instanceDate];
    try {
      await api.calendar.patchDeletedDates(parent.id, parseInt(currentUser.id), newDeleted);
      const newException = await api.calendar.create(parseInt(currentUser.id), {
        title: parent.title,
        description: parent.description,
        startDate: instance._instanceDate,
        endDate: null,
        startTime: parent.startTime,
        endTime: parent.endTime,
        type: parent.type,
        location: parent.location,
        attending: parent.attending,
        signupEnabled: parent.signupEnabled === true,
        capacity: parent.capacity ?? null,
        recurrenceType: null,
        recurrenceEndsOn: null,
        parentEventId: parent.id,
        instanceDate: instance._instanceDate,
      });
      await fetchEvents();
      setChipPopover(null);
      openEdit(newException);
    } catch (e) {
      console.error('Failed to create exception occurrence:', e);
    }
  };

  const openSubscribeModal = async () => {
    setSubscribeModal(true);
    setFeedCopied(false);
    if (feedUrls) return; // already loaded this session
    setFeedLoading(true);
    try {
      const data = await api.calendar.getFeedToken();
      setFeedUrls(data);
    } catch (e) {
      console.error('Failed to load calendar feed link:', e);
    } finally {
      setFeedLoading(false);
    }
  };

  const regenerateFeed = async () => {
    if (!confirm('This invalidates your current calendar link — anything already subscribed to it will stop updating. Continue?')) return;
    setFeedRegenerating(true);
    try {
      const data = await api.calendar.regenerateFeedToken();
      setFeedUrls(data);
      setFeedCopied(false);
    } catch (e) {
      console.error('Failed to regenerate calendar feed link:', e);
    } finally {
      setFeedRegenerating(false);
    }
  };

  const copyFeedUrl = () => {
    if (!feedUrls) return;
    navigator.clipboard?.writeText(feedUrls.url).then(() => {
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 2000);
    }).catch(() => {});
  };

  const openTbaModal = async () => {
    setTbaModal(true);
    setTbaLoading(true);
    setTbaEvents([]);
    setTbaSelected(new Set());
    setTbaError('');
    try {
      const data = await api.calendar.tbaPreview(parseInt(currentUser.id));
      setTbaEvents(data);
      setTbaSelected(new Set(data.map((e: any) => e.key)));
    } catch (e: any) {
      setTbaError(e.message || 'Failed to fetch TBA events');
    } finally {
      setTbaLoading(false);
    }
  };

  const handleTbaImport = async () => {
    const toImport = tbaEvents.filter(e => tbaSelected.has(e.key));
    if (toImport.length === 0) return;
    setTbaImporting(true);
    try {
      const result = await api.calendar.tbaImport(parseInt(currentUser.id), toImport);
      await fetchEvents();
      setTbaModal(false);
      alert(`Imported ${result.created} event(s). ${result.skipped > 0 ? `${result.skipped} duplicate(s) skipped.` : ''}`);
    } catch (e: any) {
      setTbaError(e.message || 'Failed to import events');
    } finally {
      setTbaImporting(false);
    }
  };

  const openToaModal = async () => {
    setToaModal(true);
    setToaLoading(true);
    setToaEvents([]);
    setToaSelected(new Set());
    setToaError('');
    try {
      // FTC events come from FIRST's official API; the import below is
      // source-agnostic and consumes the same shape TOA used to produce.
      const data = await api.calendar.firstPreview(parseInt(currentUser.id));
      setToaEvents(data);
      setToaSelected(new Set(data.map((e: any) => e.key)));
    } catch (e: any) {
      setToaError(e.message || 'Failed to fetch FTC events');
    } finally {
      setToaLoading(false);
    }
  };

  const handleToaImport = async () => {
    const toImport = toaEvents.filter(e => toaSelected.has(e.key));
    if (toImport.length === 0) return;
    setToaImporting(true);
    try {
      const result = await api.calendar.toaImport(parseInt(currentUser.id), toImport);
      await fetchEvents();
      setToaModal(false);
      alert(`Imported ${result.created} event(s). ${result.skipped > 0 ? `${result.skipped} duplicate(s) skipped.` : ''}`);
    } catch (e: any) {
      setToaError(e.message || 'Failed to import events');
    } finally {
      setToaImporting(false);
    }
  };

  const getEventStartDate = (ev: CalendarEvent | VirtualInstance) =>
    '_isVirtual' in ev ? (ev as VirtualInstance)._instanceDate : ev.startDate;

  const isRecurringInstance = (ev: CalendarEvent | VirtualInstance): ev is VirtualInstance =>
    '_isVirtual' in ev && (ev as VirtualInstance)._isVirtual === true;

  return (
    <div className="w-full h-full flex flex-col gap-4 animate-in fade-in duration-300 overflow-auto pb-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Calendar</h1>
          <p className="text-[10px] font-black text-teamColor uppercase tracking-[0.3em] mt-0.5">Season Schedule & Events</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isCoachOrCaptain && (
            <>
              <button
                onClick={() => setShowArchivedEvents(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${showArchivedEvents ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
              >
                <Archive size={12} /> Archived
              </button>
              {settings.teamProgram === 'FTC' ? (
                <button
                  onClick={openToaModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20"
                >
                  <Download size={12} /> Import from TOA
                </button>
              ) : (
                <button
                  onClick={openTbaModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                >
                  <Download size={12} /> Import from TBA
                </button>
              )}
              <button
                onClick={() => openAdd()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teamColor text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-teamColor/20"
              >
                <Plus size={12} /> Add Event
              </button>
            </>
          )}
          <button
            onClick={openSubscribeModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
          >
            <Rss size={12} /> Subscribe
          </button>
          <button
            onClick={() => setView('month')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${view === 'month' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
          >
            Month
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${view === 'list' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
          >
            List
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase">
        {Object.entries(TYPE_STYLES).map(([type, style]) => (
          <span key={type} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full ${style.bg} ${style.text}`}>
            {style.icon} {style.label}
          </span>
        ))}
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed ${COMPETITION_NOT_ATTENDING.bg} ${COMPETITION_NOT_ATTENDING.text} border-slate-400 dark:border-slate-500`}>
          <Trophy size={10} /> Not Attending
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-slate-400" />
        </div>
      ) : view === 'month' ? (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
              <button onClick={prevMonth} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                <ChevronLeft size={18} className="text-slate-600 dark:text-slate-300" />
              </button>
              <h2 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {MONTHS[month]} {year}
              </h2>
              <button onClick={nextMonth} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                <ChevronRight size={18} className="text-slate-600 dark:text-slate-300" />
              </button>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-7 mb-1">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {daysInMonth.map((day, idx) => {
                  if (!day) return <div key={idx} />;
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEvents = eventsByDate[dateStr] || [];
                  const todayStr = todayLocalStr(today);
                  const isToday = dateStr === todayStr;
                  const isSelected = dateStr === selectedDate;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                      className={`relative p-1 rounded-lg min-h-[52px] text-left transition-all ${
                        isSelected ? 'bg-slate-900 dark:bg-white ring-2 ring-slate-900 dark:ring-white' :
                        isToday ? 'bg-teamColor/5 dark:bg-teamColor/10 ring-2 ring-teamColor' :
                        dayEvents.length > 0 ? 'bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700' :
                        'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                      }`}
                    >
                      <span className={`text-[10px] font-black block mb-0.5 ${
                        isSelected ? 'text-white dark:text-slate-900' :
                        isToday ? 'text-teamColor' :
                        'text-slate-700 dark:text-slate-200'
                      }`}>{day}</span>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 2).map((ev, i) => {
                          const style = getTypeStyle(ev as CalendarEvent);
                          const isRecurring = isRecurringInstance(ev);
                          return (
                            <button
                              key={`${ev.id}-${i}`}
                              onClick={e => {
                                e.stopPropagation();
                                const r = (e.target as HTMLElement).getBoundingClientRect();
                                setChipPopover({ event: ev, x: r.left, y: r.bottom + 4 });
                              }}
                              className={`w-full text-left px-1 py-0.5 rounded text-[7px] font-black truncate ${isSelected ? 'bg-white/20 text-white dark:text-slate-900' : `${style.bg} ${style.text} ${(style as any).border || ''}`} hover:opacity-80 transition-opacity ${isRecurring ? 'ring-1 ring-current ring-opacity-30' : ''}`}
                            >
                              {isRecurring && <RotateCcw size={6} className="inline mr-0.5" />}{ev.title}
                            </button>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <div className="text-[7px] font-black text-slate-400 dark:text-slate-500 pl-1">+{dayEvents.length - 2}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:w-72 xl:w-80 space-y-4">
            {selectedDate && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                  </h3>
                  {isCoachOrCaptain && (
                    <button
                      onClick={() => openAdd(selectedDate)}
                      className="p-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 transition-all"
                      title="Add event on this day"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                {selectedEvents.length === 0 ? (
                  <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase text-center py-4">No events</p>
                ) : (
                  <div className="space-y-2">
                    {selectedEvents.map((ev, i) => {
                      const style = getTypeStyle(ev as CalendarEvent);
                      const evStart = getEventStartDate(ev);
                      const isRecurring = isRecurringInstance(ev);
                      return (
                        <div key={`${ev.id}-${i}`} className={`p-3 rounded-xl ${style.bg} ${(style as any).border || ''}`}>
                          <div className={`flex items-center justify-between mb-1 ${style.text}`}>
                            <div className="flex items-center gap-1.5">
                              {style.icon}
                              <span className="text-[9px] font-black uppercase tracking-wider">{style.label}</span>
                              {isRecurring && <span className="text-[7px] font-black bg-black/10 px-1 rounded uppercase">Recurring</span>}
                              {ev.type === 'competition' && (
                                <span className={`text-[7px] font-black px-1 rounded uppercase ${ev.attending ? 'bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-slate-500/20 text-slate-600 dark:text-slate-400'}`}>
                                  {ev.attending ? 'Attending' : 'Not Attending'}
                                </span>
                              )}
                            </div>
                            {isCoachOrCaptain && evStart === selectedDate && (
                              <div className="flex gap-1">
                                {isRecurring ? (
                                  <>
                                    <button onClick={() => handleEditThisOccurrence(ev as VirtualInstance)} className="p-1 rounded hover:bg-black/10 transition-colors" title="Edit this occurrence"><Pencil size={10} /></button>
                                    <button onClick={() => handleDeleteThisOccurrence(ev as VirtualInstance)} className="p-1 rounded hover:bg-black/10 transition-colors" title="Delete this occurrence"><Trash2 size={10} /></button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => openEdit(ev as CalendarEvent)} className="p-1 rounded hover:bg-black/10 transition-colors" title="Edit"><Pencil size={10} /></button>
                                    <button onClick={() => handleDelete(ev as CalendarEvent)} className="p-1 rounded hover:bg-black/10 transition-colors" title="Delete"><Trash2 size={10} /></button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <p className={`text-xs font-black ${style.text}`}>{ev.title}</p>
                          {ev.startTime && (
                            <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                              {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}
                            </p>
                          )}
                          {ev.location && <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">{ev.location}</p>}
                          {ev.description && <p className="text-[9px] text-slate-400 dark:text-slate-500 italic mt-0.5">{ev.description}</p>}
                          {!isRecurring && ev.endDate && ev.endDate !== ev.startDate && (
                            <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase mt-0.5">
                              Through {new Date(ev.endDate + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
              <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Upcoming Events</h3>
              <div className="space-y-2">
                {upcomingEvents.length === 0 ? (
                  <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase text-center py-3">Nothing upcoming</p>
                ) : upcomingEvents.map((ev, i) => {
                  const style = getTypeStyle(ev as CalendarEvent);
                  const start = getEventStartDate(ev);
                  const d = new Date(start + 'T12:00:00');
                  const isRecurring = isRecurringInstance(ev);
                  return (
                    <div key={`${ev.id}-${i}`} className="flex items-start gap-2.5">
                      <div className="flex-shrink-0 text-center w-10">
                        <div className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase">{d.toLocaleDateString([], { month: 'short' })}</div>
                        <div className="text-base font-black text-slate-900 dark:text-white leading-none">{d.toLocaleDateString([], { day: 'numeric' })}</div>
                      </div>
                      <div className={`flex-1 p-2 rounded-xl ${style.bg} ${(style as any).border || ''}`}>
                        <div className={`flex items-center gap-1 mb-0.5 ${style.text}`}>
                          {style.icon}
                          <span className="text-[8px] font-black uppercase">{style.label}</span>
                          {isRecurring && <RotateCcw size={8} className="opacity-50" />}
                          {ev.type === 'competition' && !ev.attending && (
                            <span className="text-[7px] font-black bg-slate-500/20 px-1 rounded uppercase">Not Attending</span>
                          )}
                        </div>
                        <p className={`text-[10px] font-black ${style.text}`}>{ev.title}</p>
                        {ev.location && <p className="text-[9px] text-slate-500 dark:text-slate-400">{ev.location}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-700">
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">Season Schedule</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {upcomingEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm font-bold uppercase">No upcoming events</div>
            ) : upcomingEvents.map((ev, i) => {
              const style = getTypeStyle(ev as CalendarEvent);
              const start = getEventStartDate(ev);
              const d = new Date(start + 'T12:00:00');
              const isRecurring = isRecurringInstance(ev);
              return (
                <div key={`${ev.id}-${i}`} className="flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                  <div className="flex-shrink-0 w-12 text-center">
                    <div className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase">{d.toLocaleDateString([], { month: 'short' })}</div>
                    <div className="text-xl font-black text-slate-900 dark:text-white leading-none">{d.toLocaleDateString([], { day: 'numeric' })}</div>
                    <div className="text-[8px] font-black text-slate-400 dark:text-slate-500">{d.toLocaleDateString([], { weekday: 'short' })}</div>
                  </div>
                  <div className={`w-1 self-stretch rounded-full ${style.text.replace('text-', 'bg-').split(' ')[0]}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${style.bg} ${style.text} ${(style as any).border || ''} text-[8px] font-black uppercase mb-1`}>
                      {style.icon} {style.label}
                      {(ev as any).inviteOnly && <span title="Invite only"><Lock size={7} /></span>}
                      {isRecurring && <RotateCcw size={7} className="opacity-60" />}
                    </div>
                    <p className="text-sm font-black text-slate-900 dark:text-white uppercase">{ev.title}</p>
                    {ev.type === 'competition' && (
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${ev.attending ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                        {ev.attending ? 'Attending' : 'Not Attending'}
                      </span>
                    )}
                    {ev.startTime && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                        {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}
                      </p>
                    )}
                    {ev.location && <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{ev.location}</p>}
                    {ev.description && <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">{ev.description}</p>}
                    {!isRecurring && ev.endDate && ev.endDate !== ev.startDate && (
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-0.5">
                        Through {new Date(ev.endDate + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                  {isCoachOrCaptain && !isRecurring && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(ev as CalendarEvent)}
                        className="p-1.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg hover:text-slate-800 dark:hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(ev as CalendarEvent)}
                        className="p-1.5 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg hover:bg-red-100 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {chipPopover && (() => {
        const ev = chipPopover.event;
        const style = getTypeStyle(ev as CalendarEvent);
        const leftPct = chipPopover.x / window.innerWidth;
        const xPos = leftPct > 0.6 ? 'right' : 'left';
        const isRecurring = isRecurringInstance(ev);
        const evStart = getEventStartDate(ev);
        return (
          <div
            id="chip-popover"
            className="fixed z-[400] w-64 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{ top: chipPopover.y, [xPos]: xPos === 'right' ? window.innerWidth - chipPopover.x : chipPopover.x }}
          >
            <div className={`p-3 ${style.bg} ${(style as any).border || ''}`}>
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-1.5 ${style.text}`}>
                  {style.icon}
                  <span className="text-[9px] font-black uppercase tracking-wider">{style.label}</span>
                  {(ev as any).inviteOnly && <span title="Invite only"><Lock size={9} /></span>}
                  {isRecurring && <span className="text-[7px] font-black bg-black/10 px-1 rounded uppercase flex items-center gap-0.5"><RotateCcw size={6} />Recurring</span>}
                  {ev.type === 'competition' && (
                    <span className={`text-[7px] font-black px-1 rounded uppercase ${ev.attending ? 'bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-slate-500/20 text-slate-600'}`}>
                      {ev.attending ? 'Attending' : 'Not Attending'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isCoachOrCaptain && !isRecurring && (
                    <>
                      <button onClick={() => { openEdit(ev as CalendarEvent); setChipPopover(null); }} className={`p-1 rounded hover:bg-black/10 transition-colors ${style.text}`}><Pencil size={10} /></button>
                      <button
                        onClick={async () => {
                          const isArchived = !!(ev as any).archived;
                          await api.events.archive((ev as CalendarEvent).id, !isArchived);
                          await fetchEvents();
                          setChipPopover(null);
                        }}
                        title={(ev as any).archived ? 'Unarchive event' : 'Archive event'}
                        className={`p-1 rounded hover:bg-black/10 transition-colors ${style.text}`}
                      >
                        {(ev as any).archived ? <ArchiveRestore size={10} /> : <Archive size={10} />}
                      </button>
                      <button onClick={() => { handleDelete(ev as CalendarEvent); setChipPopover(null); }} className={`p-1 rounded hover:bg-black/10 transition-colors ${style.text}`}><Trash2 size={10} /></button>
                    </>
                  )}
                  <button onClick={() => setChipPopover(null)} className={`p-1 rounded hover:bg-black/10 transition-colors ${style.text}`}><X size={10} /></button>
                </div>
              </div>
              <p className={`text-sm font-black mt-1 ${style.text}`}>{ev.title}</p>
            </div>
            <div className="p-3 space-y-1.5">
              <div className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {new Date(evStart + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' })}
                {!isRecurring && ev.endDate && ev.endDate !== ev.startDate && (
                  <span> – {new Date(ev.endDate + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                )}
              </div>
              {ev.startTime && (
                <div className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold">
                  {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}
                </div>
              )}
              {ev.location && <div className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold">{ev.location}</div>}
              {ev.description && <div className="text-[9px] text-slate-400 dark:text-slate-500 italic leading-relaxed">{ev.description}</div>}
              {/* Virtual weekly occurrences have no persisted event row of their
                  own, so keep roster actions on persisted events/overrides only. */}
              {ev.signupEnabled && !isRecurring && (
                <div className="pt-2 mt-1 border-t border-slate-100 dark:border-slate-700 space-y-2">
                  {ev.capacity != null && (
                    <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest">
                      <span className="text-slate-400 dark:text-slate-500">Spots</span>
                      <span className={`${(ev.acceptedCount ?? 0) >= ev.capacity ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {ev.acceptedCount ?? 0} / {ev.capacity} filled
                        {(ev.acceptedCount ?? 0) >= ev.capacity && ' · Waitlist open'}
                      </span>
                    </div>
                  )}
                  {isCoachOrCaptain ? (
                    <button onClick={() => { setRosterEvent({ id: ev.id, title: ev.title, startDate: (ev as any)._instanceDate ?? ev.startDate }); setChipPopover(null); }} className="w-full py-2 bg-teamColor text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:opacity-90 flex items-center justify-center gap-1"><Users size={11} /> View Roster</button>
                  ) : (
                    <button
                      onClick={async () => { setSignupBusy(true); try { await api.events.signup(ev.id); setSignupDone(true); } catch { /* */ } finally { setSignupBusy(false); } }}
                      disabled={signupBusy || signupDone}
                      className="w-full py-2 bg-teamColor text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:opacity-90 disabled:opacity-60"
                    >
                      {signupDone ? 'Signed up ✓' : signupBusy ? '…' : 'Sign Up'}
                    </button>
                  )}
                </div>
              )}
              {isCoachOrCaptain && isRecurring && (
                <div className="pt-2 space-y-1 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">Manage occurrence</p>
                  <button
                    onClick={() => { handleEditThisOccurrence(ev as VirtualInstance); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-[9px] font-black uppercase hover:bg-blue-100 transition-colors"
                  >
                    <Pencil size={9} /> Edit this occurrence
                  </button>
                  <button
                    onClick={() => { handleDeleteThisOccurrence(ev as VirtualInstance); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-[9px] font-black uppercase hover:bg-red-100 transition-colors"
                  >
                    <Trash2 size={9} /> Delete this occurrence
                  </button>
                  <button
                    onClick={() => { const parent = events.find(e => e.id === ev.id); if (parent) handleDeleteAllOccurrences(parent); }}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[9px] font-black uppercase hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    <Trash2 size={9} /> Delete all occurrences
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border-t-4 border-teamColor max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <CalendarDays size={18} className="text-teamColor" />
                  {editingEvent ? 'Edit Event' : 'Add Event'}
                </h2>
                <p className="text-[10px] text-teamColor font-bold uppercase tracking-widest mt-0.5">
                  {editingEvent ? 'Update calendar event' : 'Add to season calendar'}
                </p>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  placeholder="Event title"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Type</label>
                <div className="flex gap-2 flex-wrap">
                  {EVENT_TYPES.map(t => {
                    const style = TYPE_STYLES[t];
                    const isActive = form.type === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setForm(f => ({ ...f, type: t }))}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${isActive ? `${style.bg} ${style.text} ring-2 ring-current` : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                      >
                        {style.icon} {style.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.type === 'competition' && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Attendance</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setForm(f => ({ ...f, attending: true }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${form.attending ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 ring-2 ring-green-500' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                    >
                      <CheckSquare size={10} /> Team is attending
                    </button>
                    <button
                      onClick={() => setForm(f => ({ ...f, attending: false }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${!form.attending ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 ring-2 ring-slate-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                    >
                      <Square size={10} /> Not attending
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Start Time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Recurrence</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setForm(f => ({ ...f, recurrenceType: 'none', recurrenceEndsOn: '' }))}
                    className={`px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${form.recurrenceType === 'none' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                  >
                    None
                  </button>
                  <button
                    onClick={() => setForm(f => ({ ...f, recurrenceType: 'weekly' }))}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all ${form.recurrenceType === 'weekly' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                  >
                    <RotateCcw size={9} /> Weekly
                  </button>
                </div>
                {form.recurrenceType === 'weekly' && (
                  <div className="mt-2">
                    <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Ends On *</label>
                    <input
                      type="date"
                      value={form.recurrenceEndsOn}
                      onChange={e => setForm(f => ({ ...f, recurrenceEndsOn: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Location</label>
                <input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                  placeholder="Location or venue"
                />
              </div>

              <div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.signupEnabled}
                    onChange={e => setForm(f => ({ ...f, signupEnabled: e.target.checked }))}
                    className="w-4 h-4 rounded accent-teamColor"
                  />
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">
                    <Users size={11} /> Enable Roster / Sign-ups
                  </span>
                </label>
                <p className="text-[9px] font-medium normal-case text-slate-400 dark:text-slate-500 mt-1 ml-6">
                  Let team members sign up and let leadership manage attendance for this event.
                </p>
              </div>

              {form.signupEnabled && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">
                    Signup Limit <span className="font-medium normal-case text-slate-400">— leave blank for unlimited</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={form.capacity}
                    onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
                    placeholder="e.g. 10"
                  />
                </div>
              )}

              <div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.inviteOnly}
                    onChange={e => setForm(f => ({ ...f, inviteOnly: e.target.checked }))}
                    className="w-4 h-4 rounded accent-teamColor"
                  />
                  <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">
                    <Lock size={11} /> Invite Only
                  </span>
                </label>
                <p className="text-[9px] font-medium normal-case text-slate-400 dark:text-slate-500 mt-1 ml-6">
                  Hidden from everyone except invitees, the creator, and leadership.
                </p>
              </div>

              {form.inviteOnly && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Invitees</label>
                  <UserMultiSelect
                    users={allUsers}
                    selectedIds={form.invitees}
                    onChange={(ids) => setForm(f => ({ ...f, invitees: ids }))}
                  />
                </div>
              )}

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Notes</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm resize-none h-20"
                  placeholder="Additional notes"
                />
              </div>

              {error && <p className="text-red-600 text-xs font-bold">{error}</p>}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 uppercase tracking-widest text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : (editingEvent ? 'Update Event' : 'Add Event')}
              </button>
            </div>
          </div>
        </div>
      )}

      {subscribeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border-t-4 border-teamColor">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <Rss size={18} className="text-teamColor" /> Subscribe to Calendar
                </h2>
                <p className="text-[10px] text-teamColor font-bold uppercase tracking-widest mt-0.5">
                  Sync with Google, Apple, or Outlook Calendar
                </p>
              </div>
              <button onClick={() => setSubscribeModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {feedLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={28} className="animate-spin text-teamColor" />
                </div>
              ) : feedUrls ? (
                <>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                    This link is personal — it shows exactly what you see in-app, including any invite-only events you're part of. Don't share it.
                  </p>

                  <div>
                    <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Calendar URL</label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={feedUrls.url}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 min-w-0 px-3 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl text-xs font-mono outline-none dark:text-white truncate"
                      />
                      <button
                        onClick={copyFeedUrl}
                        className={`flex-shrink-0 px-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-1.5 transition-all ${feedCopied ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                      >
                        {feedCopied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                      </button>
                    </div>
                  </div>

                  <a
                    href={feedUrls.webcalUrl}
                    className="flex items-center justify-center gap-2 w-full py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 uppercase tracking-widest text-sm transition-all"
                  >
                    <Rss size={16} /> Open in Calendar App
                  </a>

                  <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    <p><span className="font-black text-slate-700 dark:text-slate-300">Google Calendar:</span> Settings → Add calendar → From URL, paste the link above.</p>
                    <p><span className="font-black text-slate-700 dark:text-slate-300">Apple Calendar:</span> File → New Calendar Subscription, paste the link above (or tap "Open in Calendar App").</p>
                    <p><span className="font-black text-slate-700 dark:text-slate-300">Outlook:</span> Add calendar → Subscribe from web, paste the link above.</p>
                  </div>

                  <button
                    onClick={regenerateFeed}
                    disabled={feedRegenerating}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-black rounded-xl hover:bg-red-100 dark:hover:bg-red-900/30 uppercase tracking-widest text-[10px] transition-all disabled:opacity-50"
                  >
                    {feedRegenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate Link
                  </button>
                </>
              ) : (
                <p className="text-red-600 dark:text-red-400 text-sm font-bold text-center py-8">Failed to load your calendar link. Try again.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tbaModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border-t-4 border-blue-600 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <Trophy size={18} className="text-blue-600" /> Import from TBA
                </h2>
                <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mt-0.5">
                  Team {settings.teamNumber} · {today.getFullYear()} Season Events
                </p>
              </div>
              <button onClick={() => setTbaModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {tbaLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={28} className="animate-spin text-blue-400" />
                </div>
              ) : tbaError ? (
                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-400">
                  <AlertTriangle size={18} />
                  <p className="text-sm font-bold">{tbaError}</p>
                </div>
              ) : tbaEvents.length === 0 ? (
                <p className="text-slate-400 dark:text-slate-500 text-sm font-bold text-center py-8">No events found for team {settings.teamNumber} in {today.getFullYear()}.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{tbaEvents.length} event(s) found</p>
                    <div className="flex gap-2">
                      <button onClick={() => setTbaSelected(new Set(tbaEvents.map(e => e.key)))} className="text-[9px] font-black text-blue-600 hover:underline uppercase">Select All</button>
                      <button onClick={() => setTbaSelected(new Set())} className="text-[9px] font-black text-slate-400 hover:underline uppercase">None</button>
                    </div>
                  </div>
                  {tbaEvents.map(ev => {
                    const checked = tbaSelected.has(ev.key);
                    return (
                      <button
                        key={ev.key}
                        onClick={() => setTbaSelected(prev => {
                          const next = new Set(prev);
                          checked ? next.delete(ev.key) : next.add(ev.key);
                          return next;
                        })}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${checked ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${checked ? 'border-blue-500 bg-blue-500' : 'border-slate-300 dark:border-slate-500'}`}>
                          {checked && <X size={10} className="text-white" style={{ transform: 'rotate(45deg) scaleX(-1)' }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-900 dark:text-white">{ev.name}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` – ${ev.endDate}` : ''}</p>
                          {ev.location && <p className="text-[10px] text-slate-400 dark:text-slate-500">{ev.location}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {!tbaLoading && !tbaError && tbaEvents.length > 0 && (
              <div className="p-5 border-t border-slate-100 dark:border-slate-700">
                {tbaError && <p className="text-red-600 text-xs font-bold mb-2">{tbaError}</p>}
                <button
                  onClick={handleTbaImport}
                  disabled={tbaImporting || tbaSelected.size === 0}
                  className="w-full py-3 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-700 uppercase tracking-widest text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {tbaImporting ? <><Loader2 size={14} className="animate-spin" /> Importing...</> : `Import ${tbaSelected.size} Event(s)`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toaModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl border-t-4 border-orange-500 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <Trophy size={18} className="text-orange-500" /> Import from TOA
                </h2>
                <p className="text-[10px] text-orange-500 font-bold uppercase tracking-widest mt-0.5">
                  FTC Team {settings.teamNumber} · Current Season Events
                </p>
              </div>
              <button onClick={() => setToaModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {toaLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={28} className="animate-spin text-orange-400" />
                </div>
              ) : toaError ? (
                <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl text-red-600 dark:text-red-400">
                  <AlertTriangle size={18} />
                  <p className="text-sm font-bold">{toaError}</p>
                </div>
              ) : toaEvents.length === 0 ? (
                <p className="text-slate-400 dark:text-slate-500 text-sm font-bold text-center py-8">No events found for FTC team {settings.teamNumber} this season.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{toaEvents.length} event(s) found</p>
                    <div className="flex gap-2">
                      <button onClick={() => setToaSelected(new Set(toaEvents.map(e => e.key)))} className="text-[9px] font-black text-orange-500 hover:underline uppercase">Select All</button>
                      <button onClick={() => setToaSelected(new Set())} className="text-[9px] font-black text-slate-400 hover:underline uppercase">None</button>
                    </div>
                  </div>
                  {toaEvents.map(ev => {
                    const checked = toaSelected.has(ev.key);
                    return (
                      <button
                        key={ev.key}
                        onClick={() => setToaSelected(prev => {
                          const next = new Set(prev);
                          checked ? next.delete(ev.key) : next.add(ev.key);
                          return next;
                        })}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${checked ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'}`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${checked ? 'border-orange-500 bg-orange-500' : 'border-slate-300 dark:border-slate-500'}`}>
                          {checked && <X size={10} className="text-white" style={{ transform: 'rotate(45deg) scaleX(-1)' }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-900 dark:text-white">{ev.name}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` – ${ev.endDate}` : ''}</p>
                          {ev.location && <p className="text-[10px] text-slate-400 dark:text-slate-500">{ev.location}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {!toaLoading && !toaError && toaEvents.length > 0 && (
              <div className="p-5 border-t border-slate-100 dark:border-slate-700">
                {toaError && <p className="text-red-600 text-xs font-bold mb-2">{toaError}</p>}
                <button
                  onClick={handleToaImport}
                  disabled={toaImporting || toaSelected.size === 0}
                  className="w-full py-3 bg-orange-500 text-white font-black rounded-xl hover:bg-orange-600 uppercase tracking-widest text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {toaImporting ? <><Loader2 size={14} className="animate-spin" /> Importing...</> : `Import ${toaSelected.size} Event(s)`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {rosterEvent && (
        <EventRosterModal
          eventId={rosterEvent.id}
          eventTitle={rosterEvent.title}
          eventStartDate={rosterEvent.startDate}
          isCoach={!!isCoachOrCaptain}
          onClose={() => setRosterEvent(null)}
        />
      )}
    </div>
  );
};

export default Calendar;
