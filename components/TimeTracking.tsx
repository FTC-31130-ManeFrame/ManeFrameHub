import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, TimeEntry, TimeEntryAudit, Role, AvailableTask, GeneralTask, TimeEntryWithTaskInfo } from '../types';
import { Clock, LogIn, LogOut, Check, X, Edit3, History, AlertCircle, ChevronDown, ChevronUp, Users, Plus, Trash2, Trophy, MapPin, Flag, Briefcase, ListChecks, CheckSquare, Square, Loader2, Pencil, Archive, Repeat, Shuffle } from 'lucide-react';
import { api } from '../services/api';
import { useTeamTime } from '../utils/timeFormat';
import { CategoryBadge, styleFor, HOUR_CATEGORIES } from './hourCategoryStyles';
import { TASK_LINKED_CATEGORIES } from '../shared/hourCategories';
import { LEADERSHIP_ALL, hasAnyRole } from '../shared/roles';
import { presentEntries as selectPresent, groupByCategory, untaskedCount as countUntasked, workingOnLabel } from '../utils/presence';
import TaskPickerModal from './TaskPickerModal';

/** An in-flight "what are you working on?" prompt — see `taskPicker` below. */
interface TaskPickerSession {
  mode: 'checkin' | 'switch' | 'reassign';
  entryId: number;
  /** Whose session is being changed — not necessarily the person clicking. */
  subjectUserId: number;
  subjectName: string;
  currentTaskId: number | null;
  currentGeneralTaskId: number | null;
}

interface TimeTrackingProps {
  state: AppState;
  onRefresh: () => void;
}

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const toLocalDateTimeString = (date: Date | number | string) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const TimeTracking: React.FC<TimeTrackingProps> = ({ state, onRefresh }) => {
  // Device time, with home-base time shown in parens whenever they differ —
  // see utils/timeFormat.ts. Shadows the plain-function names every call
  // site below already uses. formatDate keeps its original weekday-included
  // default (the hook's own default omits weekday).
  const { fmtTime: formatTime, fmtDate: fmtDateBase, fmtDateTime } = useTeamTime();
  const formatDate = (date: Date | number | string) => fmtDateBase(date, { weekday: 'short', month: 'short', day: 'numeric' });
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [auditEntry, setAuditEntry] = useState<TimeEntry | null>(null);
  const [auditLogs, setAuditLogs] = useState<TimeEntryAudit[]>([]);
  const [editForm, setEditForm] = useState({ checkInAt: '', checkOutAt: '', notes: '' });
  const [showHistory, setShowHistory] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showNotCheckedIn, setShowNotCheckedIn] = useState(false);
  const [showAllEntries, setShowAllEntries] = useState(false);


  // One picker serves three flows, distinguished by `mode`:
  //   checkin  — the prompt right after clocking in (dismissible: task is optional)
  //   switch   — the member moving themselves onto different work mid-session
  //   reassign — leadership moving someone else onto different work
  const [taskPicker, setTaskPicker] = useState<TaskPickerSession | null>(null);
  const [taskPickerLoading, setTaskPickerLoading] = useState(false);
  const [availableAssignedTasks, setAvailableAssignedTasks] = useState<AvailableTask[]>([]);
  const [availableOpenTasks, setAvailableOpenTasks] = useState<AvailableTask[]>([]);
  const [availableGeneralTasks, setAvailableGeneralTasks] = useState<GeneralTask[]>([]);
  const [taskPickerError, setTaskPickerError] = useState('');
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [showKindPicker, setShowKindPicker] = useState(false);
  const [clockableEvents, setClockableEvents] = useState<any[]>([]);
  const [myTotals, setMyTotals] = useState<Record<string, number> | null>(null);
  const [myLedgerRows, setMyLedgerRows] = useState<any[] | null>(null);
  const [eventTitles, setEventTitles] = useState<Record<number, { title: string; type: string }>>({});

  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutHandoffNote, setCheckoutHandoffNote] = useState('');
  const [checkoutMarkComplete, setCheckoutMarkComplete] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const [showGenTaskSettings, setShowGenTaskSettings] = useState(false);
  const [genTasks, setGenTasks] = useState<GeneralTask[]>([]);
  const [genTasksLoading, setGenTasksLoading] = useState(false);
  const [genTaskForm, setGenTaskForm] = useState({ name: '', description: '' });
  const [editingGenTask, setEditingGenTask] = useState<GeneralTask | null>(null);
  const [bulkForm, setBulkForm] = useState<{ 
    selectedUsers: string[]; 
    minutes: number; 
    notes: string; 
    date: string;
    filterRole: string;
  }>({
    selectedUsers: [],
    minutes: 45,
    notes: 'Class time',
    date: new Date().toISOString().split('T')[0],
    filterRole: '',
  });

  /**
   * Everyone still on the roster. Every coach-facing member list on this page
   * draws from this rather than `state.users` — an archived member has left the
   * team and shouldn't be offered for bulk time, manual entry, or a check-in.
   * `getUserName` deliberately still resolves archived members, because their
   * historical entries remain and need a name.
   */
  const activeUsers = useMemo(() => state.users.filter(u => !u.archived), [state.users]);

  const filteredUsersForBulk = useMemo(() => {
    if (!bulkForm.filterRole) return activeUsers;
    return activeUsers.filter(u => u.roles.includes(bulkForm.filterRole as Role));
  }, [activeUsers, bulkForm.filterRole]);

  const isCoach = useMemo(() => state.currentUser?.roles.includes(Role.Coach), [state.currentUser]);
  const isCoachOrCaptain = useMemo(() => state.currentUser?.roles.some(r => [Role.Coach, Role.TeamCaptain].includes(r as Role)), [state.currentUser]);
  // Everyone the SERVER lets move another member onto a task (Coach, Captain,
  // Department Head, SCRUM Master). Read from the shared list rather than a
  // local role array — this gate previously said Coach/Captain only, so dept
  // heads held the permission with no button to reach it.
  const isLeadership = useMemo(
    () => hasAnyRole(state.currentUser?.roles ?? [], LEADERSHIP_ALL),
    [state.currentUser],
  );
  const currentUserId = parseInt(state.currentUser?.id || '0');

  const myOpenEntry = useMemo(() => {
    return state.timeEntries.find(e => 
      e.userId === state.currentUser?.id && 
      e.status !== 'completed' &&
      !e.checkOutAt
    );
  }, [state.timeEntries, state.currentUser]);

  const pendingApprovals = useMemo(() => {
    return state.timeEntries.filter(e => 
      e.status === 'pending_check_in' || e.status === 'pending_check_out'
    );
  }, [state.timeEntries]);

  // Presence is derived in utils/presence.ts so this card and the War Room's
  // live worker chips can never disagree about who is in the room.
  const presentEntries = useMemo(() => selectPresent(state.timeEntries), [state.timeEntries]);

  // Grouped for the "Who's Here" board: one group per category, and within a
  // category one line per person.
  const presenceGroups = useMemo(() => groupByCategory(presentEntries), [presentEntries]);

  const untaskedCount = useMemo(() => countUntasked(presentEntries), [presentEntries]);

  const notCheckedInUsers = useMemo(() => {
    const activeUserIds = state.timeEntries
      .filter(e => e.status === 'checked_in' || e.status === 'pending_check_in' || e.status === 'pending_check_out')
      .map(e => e.userId);
    // Archived members have left the team — they are not "not checked in".
    return state.users.filter(u => !u.archived && !activeUserIds.includes(u.id) && !u.roles.includes(Role.Coach));
  }, [state.timeEntries, state.users]);


  const myEntries = useMemo(() => {
    return state.timeEntries
      .filter(e => e.userId === state.currentUser?.id)
      .sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime());
  }, [state.timeEntries, state.currentUser]);

  // Totals come from the combined ledger (shop clock + competition check-ins), so
  // every category counts. Falls back to clock-only math until it loads.
  const totalHours = useMemo(() => {
    if (myTotals) return myTotals.total || 0;
    return myEntries
      .filter(e => e.status === 'completed' && e.roundedMinutes)
      .reduce((acc, e) => acc + (e.roundedMinutes || 0), 0);
  }, [myEntries, myTotals]);

  const myCategoryTotals = useMemo(
    () => HOUR_CATEGORIES
      .map(c => ({ category: c, minutes: myTotals?.[c] || 0 }))
      .filter(c => c.minutes > 0),
    [myTotals],
  );

  const loadMyTotals = async () => {
    try {
      const { totals, rows } = await api.hours.mine();
      setMyTotals(totals);
      setMyLedgerRows(rows);
    } catch {}
  };

  // Last 7 days across every category, not just the shop clock.
  const weekMinutes = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (myLedgerRows) {
      return myLedgerRows
        .filter(r => new Date(r.occurredAt).getTime() > weekAgo)
        .reduce((acc, r) => acc + (r.minutes || 0), 0);
    }
    return myEntries
      .filter(e => new Date(e.checkInAt).getTime() > weekAgo && e.roundedMinutes)
      .reduce((acc, e) => acc + (e.roundedMinutes || 0), 0);
  }, [myLedgerRows, myEntries]);

  useEffect(() => { loadMyTotals(); }, [state.timeEntries, currentUserId]);

  // Live "you've been here N minutes" readout. Ticks every 30s — a session is
  // measured in quarter hours, so a per-second clock would be false precision.
  const [myElapsed, setMyElapsed] = useState('');
  useEffect(() => {
    if (!myOpenEntry) { setMyElapsed(''); return; }
    const tick = () => setMyElapsed(formatDuration(Math.max(0, Math.floor((Date.now() - new Date(myOpenEntry.checkInAt).getTime()) / 60000))));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [myOpenEntry?.id, myOpenEntry?.checkInAt]);

  useEffect(() => {
    api.calendar.getAll().then((events: any[]) => {
      const map: Record<number, { title: string; type: string }> = {};
      for (const e of events) map[e.id] = { title: e.title, type: e.type };
      setEventTitles(map);
    }).catch(() => {});
  }, []);

  // Ask "what are you clocking?" only when there are events to clock into today;
  // otherwise go straight to a normal shop check-in.
  const handleCheckIn = async () => {
    setCheckInLoading(true);
    try {
      const events = await api.events.clockableEvents().catch(() => []);
      if (events.length > 0) {
        setClockableEvents(events);
        setShowKindPicker(true);
        setCheckInLoading(false);
        return;
      }
      await doShopCheckIn();
    } catch (error) {
      console.error('Check-in failed:', error);
      onRefresh();
      setCheckInLoading(false);
    }
  };

  /**
   * Open the task picker for a session. `session.subjectUserId` decides whose
   * assignments float to the top, so a coach reassigning a student sees that
   * student's own work first rather than their own.
   *
   * The server already excludes tasks on archived boards
   * (`storage.getAvailableTasksForUser`) — retired work must never come back as
   * something to clock onto.
   */
  const openTaskPicker = async (session: TaskPickerSession) => {
    setTaskPicker(session);
    setTaskPickerError('');
    setTaskPickerLoading(true);
    try {
      const [allAvailableTasks, generalTaskList] = await Promise.all([
        api.timeEntries.availableTasks(session.subjectUserId),
        api.generalTasks.getAll(false),
      ]);
      setAvailableAssignedTasks(allAvailableTasks.filter((t: AvailableTask) => t.isAssigned));
      setAvailableOpenTasks(allAvailableTasks.filter((t: AvailableTask) => !t.isAssigned));
      setAvailableGeneralTasks(generalTaskList);
    } catch (error: any) {
      setAvailableAssignedTasks([]);
      setAvailableOpenTasks([]);
      setAvailableGeneralTasks([]);
      setTaskPickerError(error?.message || 'Could not load the task list.');
    } finally {
      setTaskPickerLoading(false);
    }
  };

  /** The picker for one's own freshly-created entry, right after clocking in. */
  const openCheckInPicker = (entryId: number) =>
    openTaskPicker({
      mode: 'checkin',
      entryId,
      subjectUserId: currentUserId,
      subjectName: state.currentUser?.name || 'You',
      currentTaskId: null,
      currentGeneralTaskId: null,
    });

  /** "I've moved onto something else" — valid any time during an open session. */
  const openSwitchPicker = () => {
    if (!myOpenEntry) return;
    openTaskPicker({
      mode: 'switch',
      entryId: parseInt(myOpenEntry.id),
      subjectUserId: currentUserId,
      subjectName: state.currentUser?.name || 'You',
      currentTaskId: myOpenEntry.workingOnTaskId ?? null,
      currentGeneralTaskId: myOpenEntry.workingOnGeneralTaskId ?? null,
    });
  };

  /** Leadership moving someone else onto different work mid-class. */
  const openReassignPicker = (entry: TimeEntryWithTaskInfo) =>
    openTaskPicker({
      mode: 'reassign',
      entryId: parseInt(entry.id),
      subjectUserId: parseInt(entry.userId),
      subjectName: getUserName(entry.userId),
      currentTaskId: entry.workingOnTaskId ?? null,
      currentGeneralTaskId: entry.workingOnGeneralTaskId ?? null,
    });

  const doShopCheckIn = async () => {
    setShowKindPicker(false);
    setCheckInLoading(true);
    try {
      const entry = await api.timeEntries.checkIn(currentUserId, { kind: 'shop' });
      await openCheckInPicker(parseInt(entry.id));
    } catch (error) {
      console.error('Check-in failed:', error);
      onRefresh();
    } finally {
      setCheckInLoading(false);
    }
  };

  const doEventCheckIn = async (event: any) => {
    setShowKindPicker(false);
    setCheckInLoading(true);
    try {
      const entry = await api.timeEntries.checkIn(currentUserId, { kind: event.type, calendarEventId: event.id });
      if ((TASK_LINKED_CATEGORIES as readonly string[]).includes(event.type)) {
        await openCheckInPicker(parseInt(entry.id));
      }
    } catch (error: any) {
      alert(error?.message || 'Could not clock in to that event.');
    } finally {
      setCheckInLoading(false);
      onRefresh();
    }
  };

  /**
   * Commit the picker's choice. `subjectUserId` — not the clicker — is sent as
   * the subject, so a coach's reassignment lands on the student's session; the
   * server checks that the clicker is either that student or leadership.
   */
  const handlePickTask = async (taskId: number | null, generalTaskId: number | null) => {
    const session = taskPicker;
    if (!session) return;
    // At check-in "no task" means skip, not an edit — nothing to save.
    if (session.mode === 'checkin' && taskId === null && generalTaskId === null) {
      setTaskPicker(null);
      onRefresh();
      return;
    }
    try {
      await api.timeEntries.setWorkingOn(session.entryId, session.subjectUserId, taskId, generalTaskId);
      setTaskPicker(null);
    } catch (error: any) {
      setTaskPickerError(error?.message || 'Could not update the task.');
      return;
    }
    onRefresh();
  };

  const openCheckoutModal = () => {
    if (!myOpenEntry) return;
    if (myOpenEntry.workingOnTaskId || myOpenEntry.workingOnGeneralTaskId) {
      setCheckoutHandoffNote('');
      setCheckoutMarkComplete(false);
      setShowCheckoutModal(true);
    } else {
      handleCheckOut();
    }
  };

  const handleCheckOut = async (handoffNote?: string, markComplete?: boolean) => {
    if (!myOpenEntry) return;
    setCheckoutLoading(true);
    try {
      await api.timeEntries.checkOut(parseInt(myOpenEntry.id), currentUserId, {
        taskHandoffNote: handoffNote,
        markTaskComplete: markComplete,
      });
      setShowCheckoutModal(false);
      onRefresh();
    } catch (error) {
      console.error('Check-out failed:', error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const loadGenTasks = async () => {
    setGenTasksLoading(true);
    try {
      const items = await api.generalTasks.getAll(true, currentUserId);
      setGenTasks(items);
    } catch {
      setGenTasks([]);
    } finally {
      setGenTasksLoading(false);
    }
  };

  const handleSaveGenTask = async () => {
    if (!genTaskForm.name.trim()) return;
    try {
      if (editingGenTask) {
        await api.generalTasks.update(editingGenTask.id, { name: genTaskForm.name, description: genTaskForm.description || '' }, currentUserId);
      } else {
        await api.generalTasks.create(genTaskForm.name, genTaskForm.description || '', currentUserId);
      }
      setGenTaskForm({ name: '', description: '' });
      setEditingGenTask(null);
      loadGenTasks();
    } catch (error) {
      console.error('Save gen task failed:', error);
    }
  };

  const handleToggleGenTaskActive = async (task: any) => {
    try {
      await api.generalTasks.update(task.id, { active: !task.active }, currentUserId);
      loadGenTasks();
    } catch (error) {
      console.error('Toggle gen task failed:', error);
    }
  };

  const handleDeleteGenTask = async (id: number) => {
    if (!window.confirm('Delete this general task permanently?')) return;
    try {
      await api.generalTasks.delete(id, currentUserId);
      loadGenTasks();
    } catch (error) {
      console.error('Delete gen task failed:', error);
    }
  };

  const handleConfirm = async (entryId: string, confirmType: 'check_in' | 'check_out') => {
    try {
      await api.timeEntries.confirm(parseInt(entryId), currentUserId, confirmType);
      onRefresh();
    } catch (error) {
      console.error('Confirm failed:', error);
    }
  };

  const [approveAllLoading, setApproveAllLoading] = useState(false);

  /**
   * Clear the whole approval queue in one go. A coach at the end of class has
   * twenty of these to confirm and no reason to look at them one at a time.
   * Sequential rather than parallel: each confirm writes an audit row, and the
   * queue is small enough that ordering beats a burst of concurrent writes.
   */
  const handleApproveAll = async () => {
    const queue = pendingApprovals;
    if (queue.length === 0) return;
    if (!confirm(`Approve all ${queue.length} pending entr${queue.length === 1 ? 'y' : 'ies'}?`)) return;
    setApproveAllLoading(true);
    let failed = 0;
    for (const entry of queue) {
      try {
        await api.timeEntries.confirm(
          parseInt(entry.id),
          currentUserId,
          entry.status === 'pending_check_in' ? 'check_in' : 'check_out',
        );
      } catch {
        failed += 1;
      }
    }
    setApproveAllLoading(false);
    onRefresh();
    if (failed > 0) alert(`${failed} of ${queue.length} could not be approved. The rest went through.`);
  };

  const handleCoachCheckOut = async (entryId: string, userId: string) => {
    try {
      await api.timeEntries.checkOut(parseInt(entryId), parseInt(userId));
      onRefresh();
    } catch (error) {
      console.error('Coach check-out failed:', error);
    }
  };

  const handleCoachCheckIn = async (userId: string) => {
    try {
      await api.timeEntries.checkIn(parseInt(userId));
      onRefresh();
    } catch (error) {
      console.error('Coach check-in failed:', error);
    }
  };

  const openEditModal = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditForm({
      checkInAt: toLocalDateTimeString(entry.checkInAt),
      checkOutAt: entry.checkOutAt ? toLocalDateTimeString(entry.checkOutAt) : '',
      notes: entry.notes || '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    try {
      await api.timeEntries.update(parseInt(editingEntry.id), currentUserId, {
        checkInAt: new Date(editForm.checkInAt).toISOString(),
        checkOutAt: editForm.checkOutAt ? new Date(editForm.checkOutAt).toISOString() : undefined,
        notes: editForm.notes,
      });
      setEditingEntry(null);
      onRefresh();
    } catch (error) {
      console.error('Update failed:', error);
    }
  };

  const openAuditModal = async (entry: TimeEntry) => {
    setAuditEntry(entry);
    try {
      const logs = await api.timeEntries.getAudit(parseInt(entry.id));
      setAuditLogs(logs);
    } catch (error) {
      console.error('Failed to fetch audit:', error);
      setAuditLogs([]);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this time entry? This cannot be undone.')) return;
    try {
      await api.timeEntries.delete(parseInt(entryId), currentUserId);
      onRefresh();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const getUserName = (userId: string) => {
    return state.users.find(u => u.id === userId)?.name || 'Unknown';
  };

  const handleBulkAdd = async () => {
    if (bulkForm.selectedUsers.length === 0 || bulkForm.minutes <= 0) return;
    try {
      await api.timeEntries.bulkAdd(
        currentUserId,
        bulkForm.selectedUsers.map(id => parseInt(id)),
        bulkForm.minutes,
        bulkForm.notes,
        bulkForm.date
      );
      setBulkForm({ selectedUsers: [], minutes: 45, notes: 'Class time', date: new Date().toISOString().split('T')[0], filterRole: '' });
      setShowBulkAdd(false);
      onRefresh();
    } catch (error) {
      console.error('Bulk add failed:', error);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setBulkForm(prev => ({
      ...prev,
      selectedUsers: prev.selectedUsers.includes(userId)
        ? prev.selectedUsers.filter(id => id !== userId)
        : [...prev.selectedUsers, userId]
    }));
  };

  const selectAllUsers = () => {
    const usersToSelect = filteredUsersForBulk;
    const allSelected = usersToSelect.every(u => bulkForm.selectedUsers.includes(u.id));
    setBulkForm(prev => ({
      ...prev,
      selectedUsers: allSelected 
        ? prev.selectedUsers.filter(id => !usersToSelect.some(u => u.id === id))
        : [...new Set([...prev.selectedUsers, ...usersToSelect.map(u => u.id)])]
    }));
  };

  const selectByRole = (role: string) => {
    const usersWithRole = activeUsers.filter(u => u.roles.includes(role as Role));
    const allSelected = usersWithRole.every(u => bulkForm.selectedUsers.includes(u.id));
    setBulkForm(prev => ({
      ...prev,
      selectedUsers: allSelected
        ? prev.selectedUsers.filter(id => !usersWithRole.some(u => u.id === id))
        : [...new Set([...prev.selectedUsers, ...usersWithRole.map(u => u.id)])]
    }));
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 md:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-slate-400" />
            <h2 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Time Clock</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400">
              Week — <span className="text-slate-700 dark:text-slate-200 font-black">{formatDuration(weekMinutes)}</span>
            </span>
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400">
              Sessions — <span className="text-slate-700 dark:text-slate-200 font-black">{myLedgerRows ? myLedgerRows.length : myEntries.filter(e => e.status === 'completed').length}</span>
            </span>
            <span className="px-2.5 py-1 bg-teamColor/5 dark:bg-teamColor/10 rounded-lg text-[10px] font-black text-teamColor">
              Total — {formatDuration(totalHours)}
            </span>
          </div>
        </div>

        {myCategoryTotals.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            {myCategoryTotals.map(({ category, minutes }) => {
              const s = styleFor(category);
              return (
                <span key={category} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold ${s.bg} ${s.text}`}>
                  {s.icon} {s.label} <span className="font-black">{formatDuration(minutes)}</span>
                </span>
              );
            })}
          </div>
        )}

        {myOpenEntry ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 mb-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 bg-green-500 text-white rounded-xl flex items-center justify-center animate-pulse shrink-0">
                  <Clock size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-black text-green-800 dark:text-green-100 uppercase">On the Clock</p>
                    <CategoryBadge category={myOpenEntry.kind} />
                    {myOpenEntry.calendarEventId && eventTitles[myOpenEntry.calendarEventId] && (
                      <span className="text-[10px] font-bold text-green-700 dark:text-green-300 truncate">
                        {eventTitles[myOpenEntry.calendarEventId].title}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-green-600 dark:text-green-400 font-bold">
                    Since {formatTime(myOpenEntry.checkInAt)} on {formatDate(myOpenEntry.checkInAt)}
                  </p>
                  {myOpenEntry.status === 'pending_check_in' && (
                    <p className="text-[9px] text-orange-600 dark:text-orange-400 font-bold uppercase mt-1">Awaiting coach confirmation</p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[8px] font-black text-green-600/70 dark:text-green-400/70 uppercase tracking-widest">Elapsed</p>
                <p className="text-lg font-black text-green-700 dark:text-green-300 tabular-nums leading-none">{myElapsed}</p>
              </div>
            </div>

            {/* Working-on row. A member may change this at any point in the
                session — they routinely finish one thing and pick up another
                without clocking out, and the record should follow them. */}
            <div className="flex items-center justify-between gap-2 p-2.5 bg-white/70 dark:bg-slate-800/50 rounded-xl border border-green-200/70 dark:border-green-800/50">
              <div className="flex items-center gap-2 min-w-0">
                {myOpenEntry.workingOnGeneralTaskName
                  ? <ListChecks size={13} className="text-violet-500 shrink-0" />
                  : <Briefcase size={13} className={myOpenEntry.workingOnTaskTitle ? 'text-blue-500 shrink-0' : 'text-slate-400 shrink-0'} />}
                <div className="min-w-0">
                  <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Working On</p>
                  <p className={`text-xs font-black truncate ${myOpenEntry.workingOnTaskTitle || myOpenEntry.workingOnGeneralTaskName ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
                    {myOpenEntry.workingOnTaskTitle || myOpenEntry.workingOnGeneralTaskName || 'Nothing picked yet'}
                  </p>
                </div>
              </div>
              <button
                onClick={openSwitchPicker}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-700 text-white rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-slate-700 dark:hover:bg-slate-600 transition-all"
              >
                <Repeat size={11} />
                {myOpenEntry.workingOnTaskTitle || myOpenEntry.workingOnGeneralTaskName ? 'Switch' : 'Pick Task'}
              </button>
            </div>

            <button
              onClick={openCheckoutModal}
              disabled={myOpenEntry.status === 'pending_check_in' || checkoutLoading}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${
                myOpenEntry.status === 'pending_check_in'
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  : 'bg-teamColor text-white hover:opacity-90 shadow-lg shadow-teamColor/20'
              }`}
            >
              <LogOut size={14} /> Check Out
            </button>
          </div>
        ) : (
          <button
            onClick={handleCheckIn}
            disabled={checkInLoading}
            className="w-full flex items-center justify-center gap-3 py-4 bg-green-600 text-white font-black rounded-xl hover:bg-green-700 shadow-lg shadow-green-600/20 transition-all uppercase tracking-widest text-sm mb-4 disabled:opacity-70"
          >
            {checkInLoading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
            Check In
          </button>
        )}

        <button 
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-widest"
        >
          <span>My Time History</span>
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showHistory && (
          <div className="mt-3 space-y-2 max-h-64 overflow-auto">
            {myEntries.slice(0, 20).map(entry => (
              <div key={entry.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-black text-slate-800 dark:text-slate-100">{formatDate(entry.checkInAt)}</p>
                    <CategoryBadge category={entry.kind} />
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                    {formatTime(entry.checkInAt)} - {entry.checkOutAt ? formatTime(entry.checkOutAt) : 'In Progress'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {entry.status === 'completed' && entry.roundedMinutes && (
                    <span className="text-xs font-black text-green-600 dark:text-green-400">{formatDuration(entry.roundedMinutes)}</span>
                  )}
                  <span className={`text-[8px] font-black px-2 py-1 rounded-lg uppercase ${
                    entry.status === 'completed' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                    entry.status === 'checked_in' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                    'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                  }`}>
                    {entry.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
            {myEntries.length === 0 && (
              <p className="text-center text-slate-400 dark:text-slate-500 py-6 text-sm font-bold">No time entries yet</p>
            )}
          </div>
        )}
      </div>

      {isCoach && pendingApprovals.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={15} className="text-orange-500" />
            <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Pending Approvals</h3>
            <span className="ml-auto text-[9px] font-black px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 rounded-md uppercase">{pendingApprovals.length} pending</span>
            <button
              onClick={handleApproveAll}
              disabled={approveAllLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg shadow-green-600/20 disabled:opacity-60"
            >
              {approveAllLoading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve All
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {pendingApprovals.map(entry => (
              <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-slate-200 dark:bg-slate-600 rounded-lg flex items-center justify-center font-black text-xs text-slate-600 dark:text-slate-300 flex-shrink-0">
                    {getUserName(entry.userId)[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{getUserName(entry.userId)}</p>
                      <CategoryBadge category={entry.kind} />
                    </div>
                    <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                      {formatDate(entry.checkInAt)} • {formatTime(entry.checkInAt)}
                      {entry.checkOutAt && ` - ${formatTime(entry.checkOutAt)}`}
                      {entry.calendarEventId && eventTitles[entry.calendarEventId] && ` • ${eventTitles[entry.calendarEventId].title}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${
                    entry.status === 'pending_check_in' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                  }`}>
                    {entry.status === 'pending_check_in' ? 'Check-In' : 'Check-Out'}
                  </span>
                  <button
                    onClick={() => handleConfirm(entry.id, entry.status === 'pending_check_in' ? 'check_in' : 'check_out')}
                    className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg font-bold text-[10px] uppercase hover:bg-green-700 transition-all shadow-lg shadow-green-600/20"
                  >
                    <Check size={12} /> Approve
                  </button>
                  <button
                    onClick={() => openEditModal(entry)}
                    className="p-2 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-500 transition-all"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => openAuditModal(entry)}
                    className="p-2 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-500 transition-all"
                  >
                    <History size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-2 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 transition-all"
                    title="Delete Entry"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Who's Here — the live floor. Everyone sees who is on the clock and
          what they're on; leadership additionally gets the controls to move
          someone onto different work, check them out, or fix their entry. */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Users size={15} className="text-green-500" />
          <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Who's Here</h3>
          <span className="ml-auto text-[9px] font-black px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 rounded-md uppercase">{presentEntries.length} on the clock</span>
          {presentEntries.length > 0 && (
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase ${
              untaskedCount > 0
                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
            }`}>
              {untaskedCount} without a task
            </span>
          )}
        </div>

        {presenceGroups.length === 0 ? (
          <p className="text-center text-slate-400 dark:text-slate-500 py-6 text-sm font-bold">Nobody is clocked in right now</p>
        ) : (
          <div className="space-y-4">
            {presenceGroups.map(({ category, entries }) => {
              const s = styleFor(category);
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{s.label}</p>
                    <span className="text-[9px] font-black text-slate-400">{entries.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {entries.map(entry => {
                      const event = entry.calendarEventId ? eventTitles[entry.calendarEventId] : null;
                      const workingOn = workingOnLabel(entry);
                      const isMe = entry.userId === state.currentUser?.id;
                      // Leadership can move anyone; a member can move themselves
                      // straight from this board rather than scrolling back up.
                      const canRetask = isLeadership || isMe;
                      return (
                        <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs flex-shrink-0 ${s.bg} ${s.text}`}>
                              {getUserName(entry.userId)[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                                {getUserName(entry.userId)}
                                {isMe && <span className="ml-1.5 text-[8px] font-black text-teamColor uppercase tracking-widest">You</span>}
                              </p>
                              <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium truncate">
                                Since {formatTime(entry.checkInAt)}
                                {event ? ` • ${event.title}` : ''}
                              </p>
                              <p className={`text-[9px] font-bold mt-0.5 flex items-center gap-1 truncate ${
                                workingOn
                                  ? (entry.workingOnGeneralTaskName ? 'text-violet-600 dark:text-violet-400' : 'text-blue-600 dark:text-blue-400')
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}>
                                {entry.workingOnGeneralTaskName ? <ListChecks size={9} className="shrink-0" /> : <Briefcase size={9} className="shrink-0" />}
                                <span className="truncate">{workingOn || 'No task picked'}</span>
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                            <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${
                              entry.status === 'pending_check_in'
                                ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                                : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                            }`}>
                              {entry.status === 'pending_check_in' ? 'Unconfirmed' : 'Active'}
                            </span>
                            {canRetask && (
                              <button
                                onClick={() => (isMe ? openSwitchPicker() : openReassignPicker(entry))}
                                title={isMe ? 'Switch your task' : `Move ${getUserName(entry.userId)} onto another task`}
                                className="flex items-center gap-1 px-2.5 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-slate-900 hover:text-white dark:hover:bg-slate-600 transition-all"
                              >
                                <Shuffle size={11} /> {workingOn ? 'Retask' : 'Assign'}
                              </button>
                            )}
                            {isCoach && entry.status === 'checked_in' && (
                              <button
                                onClick={() => handleCoachCheckOut(entry.id, entry.userId)}
                                className="flex items-center gap-1 px-3 py-2 bg-teamColor text-white rounded-lg font-bold text-[10px] uppercase hover:opacity-90 transition-all shadow-lg shadow-teamColor/20"
                              >
                                <LogOut size={12} /> Check Out
                              </button>
                            )}
                            {isCoach && (
                              <button
                                onClick={() => openEditModal(entry)}
                                title="Edit this entry"
                                className="p-2 bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-500 transition-all"
                              >
                                <Edit3 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isCoach && notCheckedInUsers.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <button
            onClick={() => setShowNotCheckedIn(v => !v)}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Users size={15} className="text-slate-400 flex-shrink-0" />
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Not Checked In</h3>
              <span className="text-[9px] font-black px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-md uppercase">{notCheckedInUsers.length}</span>
            </div>
            {showNotCheckedIn ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
          </button>

          {showNotCheckedIn && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 animate-in slide-in-from-top-1 fade-in duration-200">
              {notCheckedInUsers.map(user => (
                <div key={user.id} className="flex items-center justify-between gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 bg-slate-200 dark:bg-slate-600 rounded-lg flex items-center justify-center font-black text-sm text-slate-600 dark:text-slate-300 flex-shrink-0">
                      {user.name[0]}
                    </div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{user.name.split(' ')[0]}</p>
                  </div>
                  <button
                    onClick={() => handleCoachCheckIn(user.id)}
                    className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all flex-shrink-0 shadow-lg shadow-green-600/20"
                    title="Check In"
                  >
                    <LogIn size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isCoachOrCaptain && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-0">
            <div className="flex items-center gap-2">
              <Users size={15} className="text-slate-400" />
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Coach Tools</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setShowGenTaskSettings(true); loadGenTasks(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-bold text-xs uppercase hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:text-violet-700 dark:hover:text-violet-300 transition-all"
              >
                <ListChecks size={13} /> Manage Tasks
              </button>
              {isCoach && (
                <button
                  onClick={() => setShowBulkAdd(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs uppercase hover:bg-blue-700 transition-all"
                >
                  <Plus size={13} /> Bulk Add Time
                </button>
              )}
            </div>
          </div>

          {isCoach && showBulkAdd && (
            <div className="space-y-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Quick Select by Role</label>
                <button onClick={() => setShowBulkAdd(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors" title="Close"><X size={14} /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                  {[Role.ClassMember, Role.TeamMember, Role.DepartmentHead, Role.TeamCaptain, Role.ScrumMaster].map(role => {
                    const usersWithRole = activeUsers.filter(u => u.roles.includes(role));
                    const allSelected = usersWithRole.length > 0 && usersWithRole.every(u => bulkForm.selectedUsers.includes(u.id));
                    return (
                      <button
                        key={role}
                        onClick={() => selectByRole(role)}
                        disabled={usersWithRole.length === 0}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
                          usersWithRole.length === 0
                            ? 'bg-slate-100 dark:bg-slate-700 text-slate-300 dark:text-slate-500 cursor-not-allowed'
                            : allSelected
                              ? 'bg-green-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-300'
                        }`}
                      >
                        {role} ({usersWithRole.length})
                      </button>
                    );
                  })}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  onClick={selectAllUsers}
                  className={`p-3 rounded-xl border-2 text-xs font-black uppercase transition-all ${
                    bulkForm.selectedUsers.length === activeUsers.length
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                  }`}
                >
                  {bulkForm.selectedUsers.length === activeUsers.length ? 'Deselect All' : 'Select All'}
                </button>
                {activeUsers.map(user => (
                  <button
                    key={user.id}
                    onClick={() => toggleUserSelection(user.id)}
                    className={`p-3 rounded-xl border-2 text-xs font-bold transition-all truncate ${
                      bulkForm.selectedUsers.includes(user.id)
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                        : 'bg-white dark:bg-slate-700 border-slate-100 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-200'
                    }`}
                  >
                    {user.name.split(' ')[0]}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Minutes</label>
                  <input
                    type="number"
                    value={bulkForm.minutes}
                    onChange={(e) => setBulkForm({ ...bulkForm, minutes: parseInt(e.target.value) || 0 })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-blue-600 dark:text-white font-bold"
                    min="1"
                    step="15"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Date</label>
                  <input
                    type="date"
                    value={bulkForm.date}
                    onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-blue-600 dark:text-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Notes</label>
                  <input
                    type="text"
                    value={bulkForm.notes}
                    onChange={(e) => setBulkForm({ ...bulkForm, notes: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-blue-600 dark:text-white font-bold"
                    placeholder="Class time"
                  />
                </div>
              </div>

              <button
                onClick={handleBulkAdd}
                disabled={bulkForm.selectedUsers.length === 0 || bulkForm.minutes <= 0}
                className={`w-full py-4 font-black rounded-xl uppercase tracking-widest text-sm transition-all ${
                  bulkForm.selectedUsers.length === 0 || bulkForm.minutes <= 0
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20'
                }`}
              >
                Add {bulkForm.minutes} Minutes to {bulkForm.selectedUsers.length} Members
              </button>
            </div>
          )}
        </div>
      )}

      {isCoach && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <button
            onClick={() => setShowAllEntries(v => !v)}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <History size={15} className="text-slate-400 flex-shrink-0" />
              <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">All Time Entries</h3>
              <span className="text-[9px] font-black px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-md uppercase">{state.timeEntries.length}</span>
            </div>
            {showAllEntries ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
          </button>

          {showAllEntries && (
          <div className="px-4 pb-4 animate-in slide-in-from-top-1 fade-in duration-200">
          <div className="space-y-2 max-h-96 overflow-auto">
            {state.timeEntries.map(entry => (
              <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 md:p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600 hover:border-slate-200 dark:hover:border-slate-500 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-200 dark:bg-slate-600 rounded-lg flex items-center justify-center font-bold text-sm text-slate-600 dark:text-slate-300">
                    {getUserName(entry.userId)[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs md:text-sm font-bold text-slate-800 dark:text-slate-100">{getUserName(entry.userId)}</p>
                      <CategoryBadge category={entry.kind} />
                    </div>
                    <p className="text-[9px] md:text-[10px] text-slate-500 dark:text-slate-400">
                      {formatDate(entry.checkInAt)} • {formatTime(entry.checkInAt)}
                      {entry.checkOutAt && ` - ${formatTime(entry.checkOutAt)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {entry.roundedMinutes && (
                    <span className="text-xs font-black text-green-600 dark:text-green-400">{formatDuration(entry.roundedMinutes)}</span>
                  )}
                  <span className={`text-[8px] font-black px-2 py-1 rounded uppercase ${
                    entry.status === 'completed' ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                    entry.status === 'checked_in' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                    'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                  }`}>
                    {entry.status.replace('_', ' ')}
                  </span>
                  <button onClick={() => openEditModal(entry)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                    <Edit3 size={12} />
                  </button>
                  <button onClick={() => openAuditModal(entry)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                    <History size={12} />
                  </button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {state.timeEntries.length === 0 && (
              <p className="text-center text-slate-400 dark:text-slate-500 py-8 font-bold">No time entries recorded yet</p>
            )}
          </div>
          </div>
          )}
        </div>
      )}

      {editingEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] w-full max-w-lg p-6 md:p-10 shadow-2xl border-t-8 border-teamColor">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Edit Time Entry</h2>
                <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase">{getUserName(editingEntry.userId)}</p>
              </div>
              <button onClick={() => setEditingEntry(null)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Check In</label>
                <input
                  type="datetime-local"
                  value={editForm.checkInAt}
                  onChange={(e) => setEditForm({ ...editForm, checkInAt: e.target.value })}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-bold"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Check Out</label>
                <input
                  type="datetime-local"
                  value={editForm.checkOutAt}
                  onChange={(e) => setEditForm({ ...editForm, checkOutAt: e.target.value })}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-bold"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium h-20 resize-none"
                  placeholder="Optional notes..."
                />
              </div>
              <button
                onClick={handleSaveEdit}
                className="w-full py-4 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 uppercase tracking-widest text-sm"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {showKindPicker && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300" onClick={() => setShowKindPicker(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">What are you clocking?</h2>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mb-5">Pick shop time or one of today's events</p>
            <div className="space-y-2.5">
              <button onClick={doShopCheckIn} className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700 rounded-2xl hover:ring-2 hover:ring-teamColor transition-all text-left">
                <div className="w-10 h-10 rounded-xl bg-teamColor/10 text-teamColor flex items-center justify-center flex-shrink-0"><Briefcase size={18} /></div>
                <div><p className="font-black text-sm text-slate-900 dark:text-white">Shop Time</p><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Build / work session</p></div>
              </button>
              {clockableEvents.map((ev) => {
                const s = styleFor(ev.type);
                return (
                  <button key={ev.id} onClick={() => doEventCheckIn(ev)} className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700 rounded-2xl hover:ring-2 hover:ring-teamColor transition-all text-left">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg} ${s.text}`}><MapPin size={18} /></div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-slate-900 dark:text-white truncate">{ev.title}</p>
                      <CategoryBadge category={ev.type} className="mt-0.5" />
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowKindPicker(false)} className="w-full mt-4 py-2.5 text-slate-400 font-bold uppercase tracking-widest text-[10px] hover:text-slate-600 dark:hover:text-slate-300">Cancel</button>
          </div>
        </div>
      )}

      {taskPicker && (
        <>
          <TaskPickerModal
            title={taskPicker.mode === 'reassign' ? 'Move Them Onto' : taskPicker.mode === 'switch' ? 'Switch Task' : 'What are you working on?'}
            subtitle={
              taskPicker.mode === 'reassign'
                ? taskPicker.subjectName
                : taskPicker.mode === 'switch'
                  ? 'Your clock keeps running — only the task changes'
                  : 'Optional — skip to just check in'
            }
            loading={taskPickerLoading}
            assignedTasks={availableAssignedTasks}
            openTasks={availableOpenTasks}
            generalTasks={availableGeneralTasks}
            selectedTaskId={taskPicker.currentTaskId}
            selectedGeneralTaskId={taskPicker.currentGeneralTaskId}
            confirmLabel={taskPicker.mode === 'reassign' ? 'Move Them' : taskPicker.mode === 'switch' ? 'Switch' : 'Start Working'}
            dismissLabel={taskPicker.mode === 'checkin' ? 'Skip' : 'Cancel'}
            allowClear={taskPicker.mode !== 'checkin'}
            onDismiss={() => { setTaskPicker(null); if (taskPicker.mode === 'checkin') onRefresh(); }}
            onConfirm={handlePickTask}
          />
          {taskPickerError && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5 bg-red-600 text-white rounded-xl shadow-2xl text-xs font-bold max-w-[90vw] text-center">
              {taskPickerError}
            </div>
          )}
        </>
      )}

      {showCheckoutModal && myOpenEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg p-6 shadow-2xl">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Check Out</h2>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase mt-0.5 flex items-center gap-1">
                  {myOpenEntry.workingOnTaskTitle && <><Briefcase size={9} /> {myOpenEntry.workingOnTaskTitle}</>}
                  {myOpenEntry.workingOnGeneralTaskName && <><ListChecks size={9} /> {myOpenEntry.workingOnGeneralTaskName}</>}
                </p>
              </div>
              <button onClick={() => setShowCheckoutModal(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {myOpenEntry.workingOnTaskId && (
                <button
                  onClick={() => setCheckoutMarkComplete(!checkoutMarkComplete)}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                    checkoutMarkComplete
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-green-300'
                  }`}
                >
                  {checkoutMarkComplete ? <CheckSquare size={18} className="text-green-600 shrink-0" /> : <Square size={18} className="text-slate-400 shrink-0" />}
                  <span className={`text-sm font-black uppercase tracking-wide ${checkoutMarkComplete ? 'text-green-700 dark:text-green-300' : 'text-slate-700 dark:text-slate-300'}`}>
                    Mark task as complete
                  </span>
                </button>
              )}

              <div>
                <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                  Handoff Note {!checkoutMarkComplete && <span className="text-red-500">*</span>}
                </label>
                <textarea
                  value={checkoutHandoffNote}
                  onChange={e => setCheckoutHandoffNote(e.target.value)}
                  rows={3}
                  placeholder={checkoutMarkComplete ? 'Optional completion notes...' : 'What did you accomplish? What\'s next for this task?'}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium resize-none text-sm"
                />
              </div>

              {(() => {
                const noteRequired = !checkoutMarkComplete && !checkoutHandoffNote.trim();
                return (
                  <button
                    onClick={() => handleCheckOut(checkoutHandoffNote.trim() || undefined, checkoutMarkComplete)}
                    disabled={checkoutLoading || noteRequired}
                    className={`w-full py-3.5 font-black rounded-xl text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                      checkoutLoading || noteRequired
                        ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                        : 'bg-teamColor text-white hover:opacity-90 shadow-lg shadow-teamColor/20'
                    }`}
                  >
                    {checkoutLoading ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                    {noteRequired ? 'Add a handoff note to continue' : 'Confirm Check Out'}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {showGenTaskSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">General Tasks</h2>
                <p className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase mt-0.5">Always-available recurring tasks for check-in</p>
              </div>
              <button onClick={() => setShowGenTaskSettings(false)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl space-y-3">
              <input
                type="text"
                value={genTaskForm.name}
                onChange={e => setGenTaskForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Task name (e.g. Scouting matches)"
                className="w-full p-2.5 bg-white dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-bold text-sm"
              />
              <input
                type="text"
                value={genTaskForm.description}
                onChange={e => setGenTaskForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description (optional)"
                className="w-full p-2.5 bg-white dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor dark:text-white font-medium text-sm"
              />
              <div className="flex gap-2">
                {editingGenTask && (
                  <button onClick={() => { setEditingGenTask(null); setGenTaskForm({ name: '', description: '' }); }} className="flex-1 py-2.5 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-black text-xs uppercase">Cancel</button>
                )}
                <button
                  onClick={handleSaveGenTask}
                  disabled={!genTaskForm.name.trim()}
                  className="flex-1 py-2.5 bg-teamColor text-white rounded-xl font-black text-xs uppercase hover:opacity-90 disabled:opacity-40"
                >
                  {editingGenTask ? 'Save Changes' : 'Add Task'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto space-y-2">
              {genTasksLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-teamColor" /></div>
              ) : genTasks.length === 0 ? (
                <p className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm font-bold">No general tasks yet</p>
              ) : (
                genTasks.map(gt => (
                  <div key={gt.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 ${gt.active ? 'border-slate-100 dark:border-slate-700' : 'border-dashed border-slate-200 dark:border-slate-700 opacity-60'}`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-black truncate ${gt.active ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 line-through'}`}>{gt.name}</p>
                      {gt.description && <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{gt.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditingGenTask(gt); setGenTaskForm({ name: gt.name, description: gt.description || '' }); }} className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg text-blue-600 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleToggleGenTaskActive(gt)} className={`p-1.5 rounded-lg transition-colors ${gt.active ? 'hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600' : 'hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600'}`}>
                        <Archive size={13} />
                      </button>
                      {isCoach && (
                        <button onClick={() => handleDeleteGenTask(gt.id)} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {auditEntry && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] w-full max-w-lg p-6 md:p-10 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Audit Log</h2>
                <p className="text-slate-400 dark:text-slate-500 text-xs font-bold uppercase">{getUserName(auditEntry.userId)} - {formatDate(auditEntry.checkInAt)}</p>
              </div>
              <button onClick={() => setAuditEntry(null)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:text-red-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-3">
              {auditLogs.map(log => (
                <div key={log.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black text-red-600 uppercase">{log.actionType.replace('_', ' ')}</span>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold">
                      {fmtDateTime(log.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">By: {getUserName(log.actorId)}</p>
                  {log.deltaMinutes !== undefined && log.deltaMinutes !== null && (
                    <p className={`text-xs font-black mt-1 ${log.deltaMinutes >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {log.deltaMinutes >= 0 ? '+' : ''}{log.deltaMinutes} minutes
                    </p>
                  )}
                  {log.previousValues && Object.keys(log.previousValues).length > 0 && (
                    <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="font-bold">Previous:</span> {JSON.stringify(log.previousValues)}
                    </div>
                  )}
                </div>
              ))}
              {auditLogs.length === 0 && (
                <p className="text-center text-slate-400 dark:text-slate-500 py-6 font-bold">No audit records</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeTracking;
