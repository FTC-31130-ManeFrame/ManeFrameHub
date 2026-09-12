import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Task, TaskStatus, Department, Project, Priority, Role } from '../types';
import { STATUSES, STATUS_COLORS, PRIORITY_COLORS, DEPT_BORDER_COLORS } from '../constants';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { Plus, GripVertical, FolderPlus, LifeBuoy, AlertTriangle, X, CheckCircle, Folder, Clock, ChevronDown, Settings, ShieldCheck, Link2, Archive, Repeat, FileSpreadsheet } from 'lucide-react';
import { getUnmetDepNames } from '../utils/deps';
import { parseLocalDate, todayLocalStr } from '../utils/dates';
import TaskModal from './TaskModal';
import BoardSettingsModal from './BoardSettingsModal';
import RecurringTasksModal from './RecurringTasksModal';
import TaskImportExportModal from './TaskImportExportModal';
import { ProjectLinkChip } from './ProjectLinks';
import { api } from '../services/api';

interface KanbanBoardProps {
  state: AppState;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onAddTask: (task: Task) => void;
  onAddProject: (p: Project) => void;
  onUpdateProject: (p: Project) => void;
  onArchiveProject: (id: string) => void;
  onNotify: (taskId: string, toUserId: string, message: string) => void;
  onDataChanged?: () => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ state, onUpdateTask, onDeleteTask, onAddTask, onAddProject, onUpdateProject, onArchiveProject, onNotify, onDataChanged }) => {
  const { settings } = useTeamSettings();
  const deptNames = settings.departments.map(d => d.name);

  const [deptFilter, setDeptFilter] = useState<Department | 'All'>('All');
  const [view, setView] = useState<'board' | 'help'>('board');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  
  const [blockingTask, setBlockingTask] = useState<{id: string, newStatus: TaskStatus} | null>(null);
  const [blockReasonInput, setBlockReasonInput] = useState('');

  const [mobileStatus, setMobileStatus] = useState<TaskStatus>(TaskStatus.Backlog);
  const [showArchived, setShowArchived] = useState(false);
  const [showOverview, setShowOverview] = useState(false);

  const isCoachOnly = state.currentUser?.roles.some(r => r === Role.Coach);

  const isCoachOrCaptain = state.currentUser?.roles.some(r => 
    r === Role.Coach || r === Role.TeamCaptain || r === Role.ScrumMaster
  );

  const hasLeaderRole = state.currentUser?.roles.some(r => 
    r === Role.Coach || r === Role.TeamCaptain || r === Role.ScrumMaster || r === Role.DepartmentHead
  );

  const accessibleProjects = useMemo(() => {
    return state.projects.filter(project => {
      if (!project.department) return true;
      if (isCoachOrCaptain) return true;
      return state.currentUser?.departments.includes(project.department as Department);
    });
  }, [state.projects, state.currentUser, isCoachOrCaptain]);

  const firstAccessibleProject = useMemo(() => {
    return accessibleProjects.find(p => !p.archived)?.id || accessibleProjects[0]?.id || '';
  }, [accessibleProjects]);

  const [activeBoardKey, setActiveBoardKeyRaw] = useState<string>(() => {
    return localStorage.getItem('lastActiveBoardId') || '';
  });

  const selectBoard = (key: string) => {
    setActiveBoardKeyRaw(key);
    localStorage.setItem('lastActiveBoardId', key);
  };

  React.useEffect(() => {
    if (accessibleProjects.length === 0) return;
    const isDeptBoardKey = activeBoardKey.startsWith('dept:');
    const matchedProject = accessibleProjects.find(p => p.id === activeBoardKey);
    if (!activeBoardKey || (!isDeptBoardKey && !matchedProject)) {
      selectBoard(firstAccessibleProject);
    }
  }, [accessibleProjects, activeBoardKey, firstAccessibleProject]);

  const activeProject = useMemo(() => {
    if (activeBoardKey.startsWith('dept:')) return undefined;
    return state.projects.find(p => p.id === activeBoardKey);
  }, [state.projects, activeBoardKey]);

  const canCreateTask = hasLeaderRole || (!activeBoardKey.startsWith('dept:') && activeProject?.allowAllTaskCreation);

  const isDeptBoard = activeBoardKey.startsWith('dept:');
  const activeDept = isDeptBoard ? activeBoardKey.slice(5) as Department : null;

  const projectTasks = useMemo(() => {
    if (isDeptBoard && activeDept) {
      return state.tasks.filter(t => {
        const project = state.projects.find(p => p.id === t.projectId);
        return !project?.archived && t.departments.includes(activeDept);
      });
    }
    let tasks = state.tasks.filter(t => t.projectId === activeBoardKey && !t.deptOnly);
    if (deptFilter !== 'All') {
      tasks = tasks.filter(t => t.departments.includes(deptFilter));
    }
    return tasks;
  }, [state.tasks, state.projects, activeBoardKey, deptFilter, isDeptBoard, activeDept]);

  const helpWantedTasks = useMemo(() => {
    return state.tasks.filter(t => t.helpRequested && !state.projects.find(p => p.id === t.projectId)?.archived);
  }, [state.tasks, state.projects]);

  const tasksByStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      [TaskStatus.Backlog]: [],
      [TaskStatus.NotStarted]: [],
      [TaskStatus.InProgress]: [],
      [TaskStatus.Blocked]: [],
      [TaskStatus.Complete]: [],
    };
    projectTasks.forEach(t => map[t.status].push(t));
    return map;
  }, [projectTasks]);

  const tasksWithUnmetDeps = useMemo(() => {
    const set = new Set<string>();
    projectTasks.forEach(task => {
      if ((task.dependencies || []).length > 0) {
        const hasUnmet = (task.dependencies || []).some(depId => {
          const dep = state.tasks.find(t => t.id === depId);
          return dep && dep.status !== TaskStatus.Complete;
        });
        if (hasUnmet) set.add(task.id);
      }
    });
    return set;
  }, [projectTasks, state.tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, newStatus: TaskStatus) => {
    const taskId = e.dataTransfer.getData('taskId');
    const task = state.tasks.find(t => t.id === taskId);
    if (task && task.status !== newStatus) {
      if (newStatus === TaskStatus.InProgress) {
        const unmetNames = getUnmetDepNames(task, state.tasks);
        if (unmetNames.length > 0) {
          window.alert(`Cannot start — the following must be completed first:\n• ${unmetNames.join('\n• ')}`);
          return;
        }
      }
      if (newStatus === TaskStatus.Blocked) {
        setBlockingTask({ id: taskId, newStatus });
      } else {
        onUpdateTask({ ...task, status: newStatus, blockedReason: '' });
      }
    }
  };

  const submitBlockReason = () => {
    if (!blockingTask || !blockReasonInput.trim()) return;
    const task = state.tasks.find(t => t.id === blockingTask.id);
    if (task) {
      const history = [{
        id: Date.now().toString(),
        userId: state.currentUser?.id || 'system',
        action: `BLOCKED: ${blockReasonInput}`,
        timestamp: Date.now()
      }, ...task.history];
      onUpdateTask({ ...task, status: blockingTask.newStatus, blockedReason: blockReasonInput, history });
    }
    setBlockingTask(null);
    setBlockReasonInput('');
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    const newId = `proj-${Date.now()}`;
    const newProject: Project = {
      id: newId,
      name: newProjectName,
      description: newProjectDesc,
      createdAt: Date.now(),
      archived: false,
      scrumMasters: [],
      showInWarRoom: true,
      links: []
    };
    onAddProject(newProject);
    selectBoard(newId);
    setNewProjectName('');
    setNewProjectDesc('');
    setShowNewProjectModal(false);
  };

  const toggleHelp = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const newState = !task.helpRequested;
    const history = [{
      id: Date.now().toString(),
      userId: state.currentUser?.id || 'system',
      action: newState ? 'SOS: HELP REQUESTED' : 'SOS: HELP RESOLVED',
      timestamp: Date.now()
    }, ...task.history];
    onUpdateTask({ ...task, helpRequested: newState, history });
  };

  return (
    <div className="h-full flex flex-col gap-4 md:gap-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-700/50 p-1 rounded-xl border border-slate-200 dark:border-slate-600 shadow-inner">
            <button 
                onClick={() => setView('board')} 
                className={`px-3 md:px-6 py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${view === 'board' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'}`}
            >
                Board
            </button>
            <button 
                onClick={() => setView('help')} 
                className={`px-3 md:px-6 py-2 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1 md:gap-2 ${view === 'help' ? 'bg-red-600 text-white shadow-lg' : 'text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400'}`}
            >
                <span className="hidden sm:inline">Help</span> SOS
                {helpWantedTasks.length > 0 && <span className="bg-white text-red-600 px-1.5 rounded-full text-[8px]">{helpWantedTasks.length}</span>}
            </button>
          </div>

          {view === 'board' && (
            <>
              <select 
                value={activeBoardKey} 
                onChange={(e) => selectBoard(e.target.value)}
                className="flex-1 min-w-0 sm:flex-none sm:min-w-[160px] md:min-w-[200px] px-3 md:px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 font-bold text-sm text-slate-800 dark:text-white shadow-sm outline-none focus:ring-2 focus:ring-teamColor/20"
              >
                <optgroup label="Projects">
                  {accessibleProjects.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
                <optgroup label="Department Boards">
                  {deptNames.map(d => <option key={d} value={`dept:${d}`}>⬡ {d}</option>)}
                </optgroup>
              </select>
              <button 
                  onClick={() => setShowNewProjectModal(true)}
                  className="p-2 md:p-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors shadow-sm"
                  title="Create New Project"
              >
                  <FolderPlus size={16} />
              </button>
              <button
                  onClick={() => setShowRecurringModal(true)}
                  className="p-2 md:p-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors shadow-sm"
                  title="Recurring Tasks"
              >
                  <Repeat size={16} />
              </button>
              {activeProject && hasLeaderRole && (
                <button
                    onClick={() => setShowImportExportModal(true)}
                    className="p-2 md:p-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors shadow-sm"
                    title="Import / Export Tasks"
                >
                    <FileSpreadsheet size={16} />
                </button>
              )}
              {activeProject && hasLeaderRole && (
                <button
                    onClick={() => setShowSettingsModal(true)}
                    className="p-2 md:p-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors shadow-sm"
                    title="Board Settings"
                >
                    <Settings size={16} />
                </button>
              )}
              {accessibleProjects.some(p => p.archived) && (
                <button
                  onClick={() => setShowArchived(v => !v)}
                  title={showArchived ? 'Hide archived boards' : 'Show archived boards'}
                  className={`p-2 md:p-2.5 border rounded-xl transition-colors shadow-sm ${
                    showArchived
                      ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400'
                      : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  <Archive size={16} />
                </button>
              )}
              {!isDeptBoard && (
                <select 
                  value={deptFilter} 
                  onChange={(e) => setDeptFilter(e.target.value as Department | 'All')}
                  className="hidden sm:block px-3 md:px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 shadow-sm outline-none focus:ring-2 focus:ring-teamColor/20"
                >
                  <option value="All">All Depts</option>
                  {deptNames.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {isDeptBoard && activeDept && (
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest border"
                  style={(() => {
                    const deptColor = settings.departments.find(d => d.name === activeDept)?.color || settings.themeColor;
                    return { borderColor: deptColor + '60', backgroundColor: deptColor + '18', color: deptColor };
                  })()}
                >
                  ⬡ {activeDept} Board
                </span>
              )}
            </>
          )}

          {canCreateTask && (
            <button 
              onClick={() => setShowAddModal(true)}
              className="ml-auto flex items-center justify-center gap-1 md:gap-2 px-4 md:px-6 py-2 md:py-3 bg-teamColor text-white font-black rounded-xl md:rounded-2xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase text-[10px] md:text-xs tracking-wider"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">New</span> Task
            </button>
          )}
        </div>

        {showArchived && view === 'board' && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 flex items-center gap-1">
              <Archive size={10} /> Archived
            </span>
            {accessibleProjects.filter(p => p.archived).map(p => (
              <button
                key={p.id}
                onClick={() => { selectBoard(p.id); setShowArchived(false); }}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                  activeBoardKey === p.id
                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {view === 'board' && activeProject && (activeProject.description?.trim() || activeProject.links?.length > 0) && (
          <div className="mt-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowOverview(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                <Folder size={12} /> Overview
                {activeProject.links?.length > 0 && (
                  <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500 normal-case tracking-normal">
                    <Link2 size={11} /> {activeProject.links.length}
                  </span>
                )}
              </span>
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${showOverview ? 'rotate-180' : ''}`} />
            </button>
            {showOverview && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100 dark:border-slate-700">
                {activeProject.description?.trim() && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {activeProject.description}
                  </p>
                )}
                {activeProject.links?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {activeProject.links.map(link => <ProjectLinkChip key={link.id} link={link} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {view === 'board' ? (
        <>
          <div className="md:hidden flex gap-1 overflow-x-auto pb-2">
            {STATUSES.map(status => (
              <button
                key={status}
                onClick={() => setMobileStatus(status)}
                className={`flex-shrink-0 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-tight transition-all ${
                  mobileStatus === status 
                    ? 'bg-slate-900 dark:bg-slate-700 text-white' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                {status} ({tasksByStatus[status].length})
              </button>
            ))}
          </div>

          <div className="md:hidden flex-1 overflow-auto">
            <div className="space-y-3 pb-4">
              {tasksByStatus[mobileStatus].map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  hasUnmetDeps={tasksWithUnmetDeps.has(task.id)}
                  onClick={() => setSelectedTask(task)}
                  onToggleHelp={(e) => toggleHelp(task, e)}
                  onDragStart={(e) => handleDragStart(e, task.id)}
                />
              ))}
              {tasksByStatus[mobileStatus].length === 0 && (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-sm font-bold uppercase">
                  No tasks in this column
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:grid flex-1 grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 2xl:gap-6 min-h-0">
            {STATUSES.map(status => (
              <div 
                key={status} 
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, status)}
                className="flex flex-col h-full bg-slate-100/40 dark:bg-slate-800/40 rounded-xl md:rounded-2xl 2xl:rounded-[32px] border border-slate-200 dark:border-slate-700"
              >
                <div className="p-3 md:p-4 2xl:p-6 flex items-center justify-between bg-white/50 dark:bg-slate-800/50 rounded-t-xl md:rounded-t-2xl 2xl:rounded-t-[32px] border-b border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-2 md:gap-3">
                    <span className={`w-2 md:w-3 h-2 md:h-3 rounded-full ${STATUS_COLORS[status].split(' ')[0]}`} />
                    <h3 className="font-black text-slate-800 dark:text-slate-200 text-[9px] md:text-[10px] uppercase tracking-wider">{status}</h3>
                  </div>
                  <span className="bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-lg border border-slate-200 dark:border-slate-600">
                    {tasksByStatus[status].length}
                  </span>
                </div>
                <div className="flex-1 overflow-auto p-2 md:p-3 kanban-scroll">
                  <div className="grid grid-cols-1 2xl:grid-cols-2 gap-2">
                    {tasksByStatus[status].map(task => (
                      <TaskCard 
                        key={task.id} 
                        task={task} 
                        hasUnmetDeps={tasksWithUnmetDeps.has(task.id)}
                        onClick={() => setSelectedTask(task)}
                        onToggleHelp={(e) => toggleHelp(task, e)}
                        onDragStart={(e) => handleDragStart(e, task.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] border-2 border-slate-100 dark:border-slate-700 shadow-sm p-6 md:p-12 overflow-auto kanban-scroll">
          <div className="max-w-4xl mx-auto space-y-6 md:space-y-12">
            <div className="flex items-center gap-4 md:gap-6">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-2xl md:rounded-[24px] flex items-center justify-center">
                <LifeBuoy size={24} />
              </div>
              <div>
                <h2 className="text-xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">Help Wanted</h2>
                <p className="text-slate-400 dark:text-slate-500 font-bold text-xs md:text-sm uppercase tracking-widest">Active SOS signals</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:gap-4">
              {helpWantedTasks.map(task => (
                <div 
                  key={task.id} 
                  onClick={() => setSelectedTask(task)}
                  className="bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-100 dark:border-slate-600 rounded-2xl md:rounded-[32px] p-4 md:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 md:gap-6 hover:border-red-600/30 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-4 md:gap-6">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-red-600 text-white rounded-xl md:rounded-2xl flex items-center justify-center animate-pulse shadow-lg shadow-red-600/40">
                      <AlertTriangle size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="text-sm md:text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">{task.title}</h3>
                        <span className={`text-[7px] md:text-[8px] font-black px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority]}`}>
                          {task.priority}
                        </span>
                      </div>
                      <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 font-medium truncate uppercase tracking-widest">
                        {state.projects.find(p => p.id === task.projectId)?.name} • {task.departments.join(' & ')}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => toggleHelp(task, e)}
                    className="w-full sm:w-auto px-4 md:px-6 py-2 md:py-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-red-600 dark:text-red-400 font-black text-[9px] md:text-[10px] rounded-xl md:rounded-2xl hover:bg-red-600 hover:text-white transition-all uppercase tracking-widest shadow-sm"
                  >
                    Resolve SOS
                  </button>
                </div>
              ))}
              {helpWantedTasks.length === 0 && (
                <div className="py-16 md:py-24 text-center">
                  <CheckCircle size={48} className="text-slate-100 dark:text-slate-800 mx-auto mb-4 md:mb-6" />
                  <p className="text-xl md:text-2xl font-black text-slate-300 dark:text-slate-600 uppercase tracking-tighter">No Active SOS</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">All departments nominal.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewProjectModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-xl p-6 md:p-12 shadow-2xl border-t-8 border-teamColor">
            <div className="flex justify-between items-start mb-6 md:mb-10">
              <div>
                <h2 className="text-xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">New Project</h2>
                <p className="text-[10px] md:text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">Create a new Kanban board</p>
              </div>
              <button onClick={() => setShowNewProjectModal(false)} className="p-2 md:p-3 bg-slate-50 dark:bg-slate-700 text-slate-400 dark:text-slate-500 hover:text-red-600 rounded-xl transition-all">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 md:space-y-8">
              <div className="space-y-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Project Name</label>
                <input 
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Robot Build 2025"
                  className="w-full p-4 md:p-6 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-black text-base md:text-lg uppercase tracking-tight text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2">Description</label>
                <textarea 
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="What's this project about?"
                  className="w-full h-24 md:h-32 p-4 md:p-6 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[28px] outline-none focus:border-teamColor transition-all font-bold text-slate-700 dark:text-slate-300 resize-none"
                />
              </div>

              <button 
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="w-full py-4 md:py-6 bg-teamColor text-white font-black rounded-xl md:rounded-[32px] hover:opacity-90 shadow-2xl shadow-teamColor/20 transition-all uppercase tracking-widest text-xs md:text-sm flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50"
              >
                <Folder size={16} />
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}

      {blockingTask && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 md:p-6 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-xl p-6 md:p-12 shadow-2xl border-t-8 border-black dark:border-slate-600">
            <div className="flex flex-col items-center text-center mb-6 md:mb-10">
              <div className="w-14 h-14 md:w-20 md:h-20 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-2xl md:rounded-[28px] flex items-center justify-center mb-4 md:mb-6">
                <AlertTriangle size={28} />
              </div>
              <h2 className="text-2xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase mb-2">Block Report</h2>
              <p className="text-slate-400 dark:text-slate-500 text-xs md:text-sm font-bold uppercase tracking-widest">What's blocking this task?</p>
            </div>
            <div className="space-y-4 md:space-y-6">
              <textarea 
                autoFocus
                value={blockReasonInput}
                onChange={(e) => setBlockReasonInput(e.target.value)}
                placeholder="e.g. Waiting on parts shipment..."
                className="w-full h-24 md:h-32 p-4 md:p-6 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl md:rounded-[32px] outline-none focus:border-black dark:focus:border-white transition-all font-medium text-slate-700 dark:text-slate-300 resize-none"
              />
              <div className="flex gap-3 md:gap-4">
                <button onClick={() => setBlockingTask(null)} className="flex-1 py-3 md:py-5 text-slate-400 dark:text-slate-500 font-black hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl md:rounded-[24px] uppercase tracking-widest text-[9px] md:text-[10px]">Cancel</button>
                <button 
                  disabled={!blockReasonInput.trim()}
                  onClick={submitBlockReason} 
                  className="flex-1 py-3 md:py-5 bg-black dark:bg-slate-900 text-white font-black rounded-xl md:rounded-[24px] hover:bg-slate-900 dark:hover:bg-black shadow-xl disabled:opacity-30 uppercase tracking-widest text-[9px] md:text-[10px] transition-all"
                >
                  Confirm Block
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(selectedTask || showAddModal) && (
        <TaskModal 
          task={selectedTask || {
            id: Math.random().toString(36).substr(2, 9),
            projectId: isDeptBoard ? (accessibleProjects.find(p => !p.archived)?.id || '') : activeBoardKey,
            title: '',
            description: '',
            status: TaskStatus.NotStarted,
            priority: Priority.Medium,
            effort: 1,
            departments: [],
            assignees: [],
            successCriteria: [],
            attachments: [],
            comments: [],
            history: [{ id: Date.now().toString(), userId: 'system', action: 'Task Created', timestamp: Date.now() }],
            startDate: todayLocalStr(),
            dueDate: todayLocalStr(),
            dependencies: [],
            deptOnly: isDeptBoard,
            contributors: [],
            createdAt: Date.now()
          }}
          users={state.users}
          allTasks={state.tasks}
          currentUser={state.currentUser}
          onClose={() => {
              setSelectedTask(null);
              setShowAddModal(false);
          }}
          onNotify={(to, msg) => onNotify(selectedTask?.id || 'new', to, msg)}
          onSave={(task) => {
              if (selectedTask) onUpdateTask(task);
              else onAddTask(task);
              setSelectedTask(null);
              setShowAddModal(false);
          }}
          onSaveWithoutClose={(task) => {
              if (selectedTask) onUpdateTask(task);
          }}
          onDelete={(taskId) => {
              setSelectedTask(null);
              setShowAddModal(false);
              onDeleteTask(taskId);
          }}
        />
      )}

      {showSettingsModal && activeProject && (
        <BoardSettingsModal
          project={activeProject}
          users={state.users}
          currentUser={state.currentUser}
          onClose={() => setShowSettingsModal(false)}
          onSave={(updated) => {
            onUpdateProject(updated);
            setShowSettingsModal(false);
          }}
          onArchive={onArchiveProject}
        />
      )}

      {showRecurringModal && (
        <RecurringTasksModal
          projects={state.projects.filter(p => !p.archived).map(p => ({ id: String(p.id), name: p.name }))}
          canManage={(state.currentUser?.roles || []).some((r: string) => ['Coach', 'Team Captain', 'SCRUM Master', 'Department Head'].includes(r))}
          onClose={() => setShowRecurringModal(false)}
        />
      )}

      {showImportExportModal && activeProject && (
        <TaskImportExportModal
          project={{ id: activeProject.id, name: activeProject.name }}
          boardTasks={projectTasks}
          users={state.users.map(u => ({ id: u.id, username: u.username }))}
          onClose={() => setShowImportExportModal(false)}
          onImported={() => onDataChanged?.()}
        />
      )}
    </div>
  );
};

const TaskCard: React.FC<{ 
    task: Task; 
    hasUnmetDeps?: boolean;
    onClick: () => void; 
    onToggleHelp: (e: React.MouseEvent) => void;
    onDragStart: (e: React.DragEvent) => void 
}> = ({ task, hasUnmetDeps, onClick, onToggleHelp, onDragStart }) => {
    const primaryDept = task.departments[0] as Department | undefined;
    const deptBorder = primaryDept ? DEPT_BORDER_COLORS[primaryDept] : '';
    return (
        <div 
            onClick={onClick}
            draggable
            onDragStart={onDragStart}
            className={`group bg-white dark:bg-slate-700 p-2.5 md:p-3 rounded-lg md:rounded-xl border shadow-sm hover:shadow-md hover:scale-[1.01] transition-all cursor-grab active:cursor-grabbing relative overflow-hidden ${deptBorder} ${
                task.helpRequested ? 'border-red-600 shadow-red-600/5' : hasUnmetDeps ? 'border-slate-300 dark:border-slate-500 bg-slate-50/80 dark:bg-slate-700/60' : 'border-slate-100 dark:border-slate-600 hover:border-red-600/30'
            }`}
        >
            {task.helpRequested && (
                <div className="absolute top-0 right-0 px-1.5 py-0.5 bg-red-600 text-white text-[5px] md:text-[6px] font-black uppercase tracking-widest">
                    SOS
                </div>
            )}
            <div className="flex justify-between items-start mb-1.5">
                <div className="flex gap-1">
                    <span className={`text-[6px] md:text-[7px] font-black px-1 md:px-1.5 py-0.5 rounded uppercase ${PRIORITY_COLORS[task.priority]}`}>
                        {task.priority}
                    </span>
                    <span className="text-[6px] md:text-[7px] font-black px-1 md:px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-600">
                        {task.effort}pt
                    </span>
                </div>
                <GripVertical size={10} className="text-slate-200 dark:text-slate-600 group-hover:text-slate-400 hidden md:block" />
            </div>
            <h4 className="text-[10px] md:text-xs font-black text-slate-900 dark:text-white leading-tight mb-1.5 uppercase tracking-tight group-hover:text-red-600 transition-colors line-clamp-2">
                {task.title}
            </h4>
            {(hasUnmetDeps || task.deptOnly) && (
                <div className="flex items-center flex-wrap gap-1 mb-1.5">
                    {hasUnmetDeps && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-[6px] md:text-[7px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight">
                            <Link2 size={7} /> Waiting on deps
                        </span>
                    )}
                    {task.deptOnly && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded text-[6px] md:text-[7px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-tight">
                            Dept Only
                        </span>
                    )}
                </div>
            )}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="flex -space-x-1">
                        {task.assignees.slice(0, 2).map((id) => (
                            <div key={id} className="w-4 h-4 md:w-5 md:h-5 rounded bg-slate-950 text-white border border-white dark:border-slate-800 flex items-center justify-center text-[6px] md:text-[7px] font-black">
                                {id[0]}
                            </div>
                        ))}
                        {task.assignees.length > 2 && (
                            <div className="w-4 h-4 md:w-5 md:h-5 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-white dark:border-slate-800 flex items-center justify-center text-[6px] md:text-[7px] font-black">
                                +{task.assignees.length - 2}
                            </div>
                        )}
                    </div>
                    {/* A due date is optional — the modal writes null when it's
                        cleared, and imports/recurring tasks can omit it. Render
                        nothing rather than feeding null to parseLocalDate. */}
                    {task.dueDate && (
                        <span className="text-[6px] md:text-[7px] font-bold text-slate-400 dark:text-slate-500">
                            {parseLocalDate(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                    )}
                </div>
                <button 
                    onClick={onToggleHelp}
                    className={`p-1 rounded transition-all ${
                        task.helpRequested ? 'bg-red-600 text-white shadow' : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
                    }`}
                    title="Request SOS"
                >
                    <LifeBuoy size={10} />
                </button>
            </div>
        </div>
    );
};

export default KanbanBoard;
