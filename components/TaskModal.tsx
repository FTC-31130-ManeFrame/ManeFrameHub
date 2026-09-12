
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Calendar, Plus, MessageSquare, History as HistoryIcon, Trash2, CheckCircle, BarChart3, AtSign, LifeBuoy, AlertTriangle, Clock, Search, Link2 } from 'lucide-react';
import { getUnmetDepNames } from '../utils/deps';
import { todayLocalStr, parseLocalDate } from '../utils/dates';
import { Task, TaskStatus, Priority, Department, User, Activity, Comment, Role, SuccessCriterion } from '../types';
import { STATUS_COLORS, PRIORITY_COLORS, PRIORITIES, STATUSES, EFFORT_POINTS } from '../constants';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { useTeamTime } from '../utils/timeFormat';
import { api } from '../services/api';

interface TaskModalProps {
  task: Task | null;
  users: User[];
  allTasks: Task[];
  currentUser: User | null;
  onClose: () => void;
  onSave: (task: Task) => void;
  onSaveWithoutClose?: (task: Task) => void;
  onNotify?: (toUserId: string, message: string) => void;
  onDelete?: (taskId: string) => void;
}

// Signature of the fields that "Commit Mission" persists, used to detect
// unsaved edits when the user tries to close. Comments/help auto-save on their
// own, so they're intentionally excluded.
const taskSignature = (t: Task): string => JSON.stringify({
  title: t.title ?? '',
  description: t.description ?? '',
  status: t.status,
  priority: t.priority,
  effort: t.effort ?? null,
  startDate: t.startDate ?? null,
  dueDate: t.dueDate ?? null,
  completedAt: t.completedAt ?? null,
  deptOnly: !!t.deptOnly,
  blockedReason: t.blockedReason ?? '',
  departments: [...(t.departments || [])].sort(),
  assignees: [...(t.assignees || [])].map(String).sort(),
  dependencies: [...(t.dependencies || [])].map(String).sort(),
  successCriteria: (t.successCriteria || []).map(s => ({ text: s.text, completed: s.completed })),
});

const TaskModal: React.FC<TaskModalProps> = ({ task, users, allTasks, currentUser, onClose, onSave, onSaveWithoutClose, onNotify, onDelete }) => {
  const { settings } = useTeamSettings();
  const { fmtTime, fmtDate, fmtDateTime } = useTeamTime();
  const deptNames = settings.departments.map(d => d.name);

  const [editedTask, setEditedTask] = useState<Task>(task || {
    id: Math.random().toString(36).substr(2, 9),
    projectId: 'default',
    title: '',
    description: '',
    status: TaskStatus.NotStarted,
    priority: Priority.Medium,
    effort: 1,
    departments: [],
    assignees: [],
    contributors: [],
    successCriteria: [],
    attachments: [],
    comments: [],
    history: [{ id: Date.now().toString(), userId: 'system', action: 'Task Created', timestamp: Date.now() }],
    startDate: todayLocalStr(),
    dueDate: todayLocalStr(),
    dependencies: [],
    helpRequested: false,
    deptOnly: false,
    blockedReason: '',
    createdAt: Date.now()
  });

  const [newComment, setNewComment] = useState('');
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const [depSearch, setDepSearch] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Baseline captured on first render; edits that differ from it are "unsaved".
  const pristineRef = useRef<string | null>(null);
  if (pristineRef.current === null) pristineRef.current = taskSignature(editedTask);
  const isDirty = taskSignature(editedTask) !== pristineRef.current;

  const commitTask = () => {
    const taskToSave = (editedTask.deptOnly && editedTask.departments.length === 0)
      ? { ...editedTask, deptOnly: false }
      : editedTask;
    onSave(taskToSave);
  };

  const handleCloseAttempt = () => {
    if (isDirty) setShowCloseConfirm(true);
    else onClose();
  };

  const filteredUsersForAssignment = useMemo(() => {
    let filtered = users;
    if (editedTask.departments.length > 0) {
      filtered = filtered.filter(u => 
        u.departments.some(d => editedTask.departments.includes(d))
      );
    }
    if (assigneeSearch.trim()) {
      const search = assigneeSearch.toLowerCase();
      filtered = filtered.filter(u => 
        u.username.toLowerCase().includes(search) || 
        u.name.toLowerCase().includes(search)
      );
    }
    return filtered;
  }, [users, editedTask.departments, assigneeSearch]);

  const candidateDeps = useMemo(() => {
    return allTasks.filter(t =>
      t.projectId === editedTask.projectId &&
      t.id !== editedTask.id &&
      !(t.dependencies || []).includes(editedTask.id)
    );
  }, [allTasks, editedTask.projectId, editedTask.id]);

  const depTasks = useMemo(() => {
    return (editedTask.dependencies || [])
      .map(depId => allTasks.find(t => t.id === depId))
      .filter(Boolean) as Task[];
  }, [editedTask.dependencies, allTasks]);

  const allDepsComplete = depTasks.length > 0 && depTasks.every(t => t.status === TaskStatus.Complete);

  const logActivity = (action: string) => {
    const newActivity: Activity = {
      id: Date.now().toString(),
      userId: currentUser?.id || 'unknown', 
      action,
      timestamp: Date.now()
    };
    setEditedTask(prev => ({
      ...prev,
      history: [newActivity, ...prev.history]
    }));
  };

  const isMuted = currentUser?.muted === true;
  const isCoach = currentUser?.roles.includes(Role.Coach);

  const deleteComment = (commentId: string) => {
    if (!confirm('Delete this comment?')) return;
    const deleteActivity: Activity = {
      id: Date.now().toString(),
      userId: currentUser?.id || 'unknown',
      action: 'Comment deleted by coach',
      timestamp: Date.now()
    };
    const updatedTask = {
      ...editedTask,
      comments: editedTask.comments.filter(c => c.id !== commentId),
      history: [deleteActivity, ...editedTask.history]
    };
    setEditedTask(updatedTask);
    if (onSaveWithoutClose) onSaveWithoutClose(updatedTask);
  };

  const addComment = () => {
    if (!newComment.trim() || isMuted) return;
    const commentId = Date.now().toString();
    const comment: Comment = {
        id: commentId,
        userId: currentUser?.id || 'unknown',
        text: newComment,
        timestamp: Date.now()
    };
    
    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    let match;
    const notifiedIds = new Set<string>();
    
    while ((match = mentionRegex.exec(newComment)) !== null) {
      const username = match[1].toLowerCase();
      const mentionedUser = users.find(u => u.username.toLowerCase() === username);
      if (mentionedUser && mentionedUser.id !== currentUser?.id && onNotify) {
        onNotify(mentionedUser.id, `Mentioned you in task "${editedTask.title}": ${newComment}`);
        notifiedIds.add(mentionedUser.id);
      }
    }

    const commentPreview = newComment.length > 25 ? newComment.substring(0, 25) + '...' : newComment;
    const commentActivity: Activity = {
      id: (Date.now() + 1).toString(),
      userId: currentUser?.id || 'unknown',
      action: `Comment posted: "${commentPreview}"`,
      timestamp: Date.now()
    };
    
    const updatedTask = {
      ...editedTask,
      comments: [comment, ...editedTask.comments],
      history: [commentActivity, ...editedTask.history]
    };
    
    setEditedTask(updatedTask);
    if (onSaveWithoutClose) onSaveWithoutClose(updatedTask);
    
    setNewComment('');
    setMentionFilter(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewComment(val);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPosition);
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1];
    
    if (lastWord.startsWith('@')) {
      setMentionFilter(lastWord.slice(1).toLowerCase());
    } else {
      setMentionFilter(null);
    }
  };

  const insertMention = (username: string) => {
    if (!commentInputRef.current) return;
    const val = newComment;
    const cursorPosition = commentInputRef.current.selectionStart || 0;
    const textBeforeCursor = val.slice(0, cursorPosition);
    const textAfterCursor = val.slice(cursorPosition);
    
    const words = textBeforeCursor.split(/\s/);
    words[words.length - 1] = `@${username} `;
    
    const newText = words.join(' ') + textAfterCursor;
    setNewComment(newText);
    setMentionFilter(null);
    commentInputRef.current.focus();
  };

  const filteredMentionUsers = useMemo(() => {
    if (mentionFilter === null) return [];
    return users.filter(u => 
      u.username.toLowerCase().includes(mentionFilter) || 
      u.name.toLowerCase().includes(mentionFilter)
    ).slice(0, 5);
  }, [mentionFilter, users]);

  const toggleHelp = () => {
    const newState = !editedTask.helpRequested;
    setEditedTask({...editedTask, helpRequested: newState});
    logActivity(newState ? 'SOS: HELP REQUESTED' : 'SOS: HELP RESOLVED');
  };

  const renderCommentText = (text: string) => {
    const parts = text.split(/(@[a-zA-Z0-9._-]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const username = part.slice(1).toLowerCase();
        const exists = users.some(u => u.username.toLowerCase() === username);
        if (exists) {
          return <span key={i} className="text-teamColor font-black bg-teamColor/5 px-1.5 py-0.5 rounded-lg border border-teamColor/20">{part}</span>;
        }
      }
      return part;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-[40px] w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in duration-300">
        <header className="p-8 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex-1 flex items-center gap-6">
            <button 
                onClick={toggleHelp}
                className={`p-4 rounded-2xl transition-all shadow-lg ${editedTask.helpRequested ? 'bg-red-600 text-white animate-pulse' : 'bg-white dark:bg-slate-800 text-slate-300 border border-slate-200 dark:border-slate-700 hover:text-red-600'}`}
                title="Toggle SOS"
            >
                <LifeBuoy size={24} />
            </button>
            <div className="flex-1">
                <input 
                  value={editedTask.title}
                  onChange={(e) => setEditedTask({...editedTask, title: e.target.value})}
                  placeholder="Task Title"
                  className="text-3xl font-black text-slate-900 dark:text-white bg-transparent border-none outline-none focus:ring-4 focus:ring-teamColor/10 rounded-xl px-2 w-full uppercase tracking-tighter"
                />
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-2 flex items-center gap-1.5 mt-1">
                   <Clock size={10} /> POSTED {fmtDate(editedTask.createdAt)} {fmtTime(editedTask.createdAt)}
                </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {onDelete && (
                <button onClick={() => onDelete(editedTask.id)} className="p-3 text-slate-300 hover:text-red-600 transition-colors">
                    <Trash2 size={24} />
                </button>
            )}
            <button onClick={handleCloseAttempt} className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-400 hover:text-slate-600 shadow-sm transition-all">
              <X size={24} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-3 gap-0">
          <div className="lg:col-span-2 p-10 space-y-10 border-r border-slate-100 dark:border-slate-700">
            {editedTask.status === TaskStatus.Blocked && editedTask.blockedReason && (
              <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-100 dark:border-red-700 p-8 rounded-[32px] flex items-start gap-6">
                <div className="p-3 bg-red-600 text-white rounded-2xl">
                    <AlertTriangle size={24} />
                </div>
                <div>
                    <h4 className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1">Block Report</h4>
                    <p className="text-slate-700 dark:text-slate-300 font-bold text-lg leading-tight uppercase tracking-tight">{editedTask.blockedReason}</p>
                </div>
              </div>
            )}

            <section>
              <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4 ml-1">Mission Intel (Description)</h3>
              <textarea 
                value={editedTask.description}
                onChange={(e) => setEditedTask({...editedTask, description: e.target.value})}
                className="w-full h-40 p-8 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[32px] focus:ring-4 focus:ring-teamColor/10 focus:border-teamColor focus:bg-white dark:focus:bg-slate-800 outline-none transition-all resize-none text-slate-700 dark:text-slate-300 leading-relaxed font-medium"
                placeholder="What needs to be done?"
              />
            </section>

            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Success Criteria</h3>
                {editedTask.successCriteria.length > 0 && (
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                    {editedTask.successCriteria.filter(c => c.completed).length}/{editedTask.successCriteria.length} completed
                  </span>
                )}
              </div>
              <ul className="space-y-3">
                {editedTask.successCriteria.map((criterion, idx) => (
                  <li key={criterion.id} className={`flex items-start gap-4 p-5 rounded-[24px] border group transition-all ${criterion.completed ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700' : 'bg-slate-50 dark:bg-slate-700 border-slate-100 dark:border-slate-600'}`}>
                    <button
                      onClick={() => {
                        const updated = editedTask.successCriteria.map((c, i) => 
                          i === idx ? { ...c, completed: !c.completed } : c
                        );
                        setEditedTask({ ...editedTask, successCriteria: updated });
                      }}
                      className="mt-0.5 flex-shrink-0"
                    >
                      {criterion.completed ? (
                        <CheckCircle size={20} className="text-green-500" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-green-500 transition-colors" />
                      )}
                    </button>
                    <input
                      type="text"
                      value={criterion.text}
                      onChange={(e) => {
                        const updated = editedTask.successCriteria.map((c, i) =>
                          i === idx ? { ...c, text: e.target.value } : c
                        );
                        setEditedTask({ ...editedTask, successCriteria: updated });
                      }}
                      className={`flex-1 bg-transparent outline-none font-bold uppercase text-xs tracking-tight ${criterion.completed ? 'text-green-700 dark:text-green-400 line-through' : 'text-slate-700 dark:text-slate-300'}`}
                    />
                    <button 
                      onClick={() => setEditedTask({
                        ...editedTask, 
                        successCriteria: editedTask.successCriteria.filter((_, i) => i !== idx)
                      })}
                      className="text-slate-300 dark:text-slate-600 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
                <div className="flex items-center gap-3">
                    <input 
                        id="new-criterion"
                        className="flex-1 text-sm p-5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor transition-all font-bold uppercase placeholder:font-normal dark:text-white" 
                        placeholder="Add success criterion..."
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value;
                                if (val) {
                                    const newCriterion: SuccessCriterion = {
                                      id: Date.now().toString(),
                                      text: val,
                                      completed: false
                                    };
                                    setEditedTask(prev => ({...prev, successCriteria: [...prev.successCriteria, newCriterion]}));
                                    (e.target as HTMLInputElement).value = '';
                                }
                            }
                        }}
                    />
                </div>
              </ul>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pt-10 border-t border-slate-100 dark:border-slate-700">
                <section className="relative">
                    <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2 ml-1">
                        <MessageSquare size={16} /> Comms
                    </h3>
                    
                    {mentionFilter !== null && filteredMentionUsers.length > 0 && (
                      <div className="absolute bottom-[80px] left-0 w-full z-20 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                        {filteredMentionUsers.map(u => (
                          <button 
                            key={u.id}
                            onClick={() => insertMention(u.username)}
                            className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-600 text-left transition-colors border-b border-slate-100 dark:border-slate-600 last:border-0"
                          >
                            <div className="w-8 h-8 rounded-lg bg-teamColor text-white flex items-center justify-center font-black text-[10px]">
                              {u.name[0]}
                            </div>
                            <div>
                              <p className="text-xs font-black text-slate-900 dark:text-white uppercase">@{u.username}</p>
                              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{u.name}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="space-y-4 mb-6 max-h-96 overflow-auto pr-2 kanban-scroll">
                        {editedTask.comments.map(c => {
                          const user = users.find(u => u.id === c.userId);
                          return (
                            <div key={c.id} className="bg-slate-50 dark:bg-slate-700 p-6 rounded-[24px] border border-slate-100 dark:border-slate-600 group">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">{user?.name || 'Unknown'}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase">{fmtTime(c.timestamp)}</span>
                                      {isCoach && (
                                        <button 
                                          onClick={() => deleteComment(c.id)}
                                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 dark:text-slate-500 hover:text-red-600 transition-all"
                                          title="Delete comment"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                    </div>
                                </div>
                                <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                                  {renderCommentText(c.text)}
                                </div>
                            </div>
                          );
                        })}
                    </div>
                    <div className="flex flex-col gap-3">
                        <div className="relative">
                          <textarea 
                              ref={commentInputRef}
                              value={newComment}
                              onChange={handleInputChange}
                              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), addComment())}
                              placeholder="Write a comment... Use @handle to mention someone. Press Enter to send, Shift+Enter for new line."
                              rows={4}
                              className="w-full text-sm p-5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor transition-all pr-12 font-medium resize-none dark:text-white"
                          />
                          <AtSign size={16} className="absolute right-5 top-5 text-slate-300 dark:text-slate-600" />
                        </div>
                        <button 
                          onClick={addComment} 
                          disabled={isMuted || !newComment.trim()}
                          className="w-full py-3 bg-teamColor text-white rounded-[24px] hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all font-black text-xs uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            <Plus size={16} /> Post Comment
                        </button>
                    </div>
                </section>
                <section>
                    <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2 ml-1">
                        <HistoryIcon size={16} /> Operations Log
                    </h3>
                    <div className="space-y-4 max-h-64 overflow-auto kanban-scroll pr-4">
                        {editedTask.history.map(h => {
                          const user = users.find(u => u.id === h.userId);
                          const isSOS = h.action.includes('SOS');
                          const isResolved = h.action.includes('RESOLVED');
                          return (
                            <div key={h.id} className="flex gap-4 text-xs">
                                <div className={`w-1 rounded-full ${isSOS && !isResolved ? 'bg-red-600' : isResolved ? 'bg-green-500' : 'bg-red-600/20 dark:bg-red-600/40'}`} />
                                <div>
                                    <p className={`font-black uppercase tracking-tight text-[10px] ${isSOS && !isResolved ? 'text-red-600' : isResolved ? 'text-green-600' : 'text-slate-800 dark:text-slate-100'}`}>{h.action}</p>
                                    <p className="text-slate-400 dark:text-slate-500 text-[9px] font-bold uppercase mt-0.5">{user?.name} • {fmtDateTime(h.timestamp)}</p>
                                </div>
                            </div>
                          );
                        })}
                    </div>
                </section>
            </div>
          </div>

          <div className="bg-slate-50/50 dark:bg-slate-900/50 p-10 space-y-8">
            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Task Status</label>
              <select 
                value={editedTask.status}
                onChange={(e) => {
                    const newStatus = e.target.value as TaskStatus;
                    if (newStatus === TaskStatus.InProgress) {
                      const unmetNames = getUnmetDepNames(editedTask, allTasks);
                      if (unmetNames.length > 0) {
                        window.alert(`Cannot start — the following must be completed first:\n• ${unmetNames.join('\n• ')}`);
                        return;
                      }
                    }
                    setEditedTask({...editedTask, status: newStatus});
                    logActivity(`Status changed to ${newStatus.toUpperCase()}`);
                }}
                className={`w-full p-5 rounded-[24px] border-2 border-slate-100 dark:border-slate-700 text-[11px] font-black uppercase tracking-[0.2em] outline-none focus:border-teamColor transition-all ${STATUS_COLORS[editedTask.status]} dark:bg-slate-800`}
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Board Visibility</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setEditedTask({...editedTask, deptOnly: false})}
                  className={`py-3 px-4 rounded-[18px] border-2 text-[9px] font-black uppercase tracking-widest transition-all ${
                    !editedTask.deptOnly
                      ? 'bg-slate-950 dark:bg-white text-white dark:text-slate-900 border-slate-950 dark:border-white'
                      : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  Both Boards
                </button>
                <button
                  onClick={() => setEditedTask({...editedTask, deptOnly: true})}
                  className={`py-3 px-4 rounded-[18px] border-2 text-[9px] font-black uppercase tracking-widest transition-all ${
                    editedTask.deptOnly
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  Dept Board Only
                </button>
              </div>
              {editedTask.deptOnly && editedTask.departments.length > 0 && (
                <p className="text-[9px] text-blue-500 font-bold mt-2 ml-1 uppercase tracking-wide">
                  Only visible on departmental boards, not on the project Kanban board.
                </p>
              )}
              {editedTask.deptOnly && editedTask.departments.length === 0 && (
                <div className="mt-2 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[9px] text-amber-700 dark:text-amber-300 font-black uppercase tracking-wide leading-snug">
                    No department selected — this task will be invisible on all boards. Assign at least one department, or switch back to "Both Boards".
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6 pb-6 border-b border-slate-200 dark:border-slate-700">
               <div className="space-y-3">
                  <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                    <Calendar size={12} /> Start Date
                  </label>
                  <input 
                    type="date"
                    value={editedTask.startDate ?? ''}
                    onChange={(e) => setEditedTask({...editedTask, startDate: e.target.value})}
                    className="w-full p-4 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[20px] text-xs font-black uppercase tracking-widest outline-none focus:border-teamColor transition-all dark:text-white"
                  />
               </div>
               <div className="space-y-3">
                  <label className="block text-[10px] font-black text-teamColor uppercase tracking-widest ml-1 flex items-center gap-1.5">
                    <Calendar size={12} /> Due Date
                  </label>
                  <input
                    type="date"
                    value={editedTask.dueDate ?? ''}
                    onChange={(e) => setEditedTask({...editedTask, dueDate: e.target.value})}
                    className="w-full p-4 bg-white dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[20px] text-xs font-black uppercase tracking-widest outline-none focus:border-teamColor transition-all dark:text-white"
                  />
               </div>
            </div>

            {editedTask.status === TaskStatus.Complete && (
              <div className="pb-6 border-b border-slate-200 dark:border-slate-700 space-y-3">
                <label className="block text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                  <CheckCircle size={12} /> Completed On
                </label>
                <input
                  type="date"
                  value={editedTask.completedAt ? todayLocalStr(new Date(editedTask.completedAt)) : todayLocalStr()}
                  onChange={(e) => setEditedTask({ ...editedTask, completedAt: e.target.value ? parseLocalDate(e.target.value).getTime() : Date.now() })}
                  className="w-full p-4 bg-white dark:bg-slate-700 border-2 border-emerald-100 dark:border-emerald-900/40 rounded-[20px] text-xs font-black uppercase tracking-widest outline-none focus:border-emerald-500 transition-all dark:text-white"
                />
                <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold ml-1">
                  Auto-set when marked complete — adjust if it was actually finished on a different day.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Priority</label>
                <select 
                  value={editedTask.priority}
                  onChange={(e) => {
                      setEditedTask({...editedTask, priority: e.target.value as Priority});
                      logActivity(`Priority changed to ${e.target.value.toUpperCase()}`);
                  }}
                  className={`w-full p-5 rounded-[24px] border-2 border-slate-100 dark:border-slate-700 text-[10px] font-black uppercase tracking-widest outline-none focus:border-teamColor transition-all ${PRIORITY_COLORS[editedTask.priority]} dark:bg-slate-800`}
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1 flex items-center gap-1.5">
                    <BarChart3 size={12} /> Effort
                </label>
                <select 
                  value={editedTask.effort}
                  onChange={(e) => {
                      setEditedTask({...editedTask, effort: parseInt(e.target.value)});
                      logActivity(`Effort set to ${e.target.value} PTS`);
                  }}
                  className="w-full p-5 rounded-[24px] border-2 border-slate-100 dark:border-slate-700 text-xs font-black uppercase tracking-widest bg-white dark:bg-slate-800 outline-none focus:border-teamColor transition-all dark:text-white"
                >
                  {EFFORT_POINTS.map(pt => <option key={pt} value={pt}>{pt} points</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Assigned Sectors</label>
              <div className="flex flex-wrap gap-2">
                {deptNames.map(dept => (
                  <button
                    key={dept}
                    onClick={() => {
                        const newDepts = editedTask.departments.includes(dept as any)
                            ? editedTask.departments.filter(d => d !== dept)
                            : [...editedTask.departments, dept as any];
                        setEditedTask({...editedTask, departments: newDepts});
                    }}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl border transition-all ${
                        editedTask.departments.includes(dept)
                        ? 'bg-slate-950 dark:bg-slate-700 text-white border-slate-800 dark:border-slate-600 shadow-lg scale-105'
                        : 'bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {dept}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Authorized Units</label>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by username..."
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl text-sm font-medium outline-none focus:border-teamColor transition-colors dark:text-white"
                />
              </div>
              {editedTask.departments.length === 0 && (
                <p className="text-[9px] text-amber-600 dark:text-amber-500 font-bold mb-2 ml-1">Select sectors above to filter available units</p>
              )}
              <div className="space-y-2 max-h-48 overflow-auto kanban-scroll pr-2">
                {filteredUsersForAssignment.length === 0 ? (
                  <p className="text-center text-slate-400 dark:text-slate-500 text-xs font-bold py-4">No matching users found</p>
                ) : (
                  filteredUsersForAssignment.map(u => {
                    const isAssigned = editedTask.assignees.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => {
                          const newAssignees = isAssigned
                            ? editedTask.assignees.filter(id => id !== u.id)
                            : [...editedTask.assignees, u.id];
                          setEditedTask({...editedTask, assignees: newAssignees});
                        }}
                        className={`w-full flex items-center gap-4 p-4 rounded-[20px] text-[10px] font-black border-2 transition-all uppercase tracking-tight ${
                          isAssigned
                            ? 'bg-teamColor/5 dark:bg-teamColor/10 border-teamColor/20 dark:border-teamColor text-teamColor shadow-sm'
                            : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:border-slate-200 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black ${isAssigned ? 'bg-teamColor text-white' : 'bg-slate-950 dark:bg-slate-900 text-white'}`}>
                          {u.name[0]}
                        </div>
                        <div className="text-left flex-1">
                          <p className="tracking-tight">{u.name}</p>
                          <p className="text-[8px] opacity-50 font-bold">@{u.username}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {(() => {
              const taskContributors = (editedTask.contributors || []) as string[];
              const contributorUsers = taskContributors
                .map((id: string) => users.find(u => String(u.id) === String(id)))
                .filter(Boolean) as typeof users;
              if (contributorUsers.length === 0) return null;
              return (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1">Contributors</label>
                  <div className="space-y-2">
                    {contributorUsers.map(u => (
                      <div
                        key={u.id}
                        className="flex items-center gap-4 p-4 rounded-[20px] bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-100 dark:border-slate-700"
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-black bg-orange-500 text-white">
                          {u.name[0]}
                        </div>
                        <div className="text-left flex-1">
                          <p className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-tight">{u.name}</p>
                          <p className="text-[8px] opacity-50 font-bold">@{u.username}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 ml-1 flex items-center gap-2">
                <Link2 size={12} /> Depends On
                {allDepsComplete && <CheckCircle size={10} className="text-green-500 ml-auto" />}
                {depTasks.length > 0 && !allDepsComplete && (
                  <span className="ml-auto text-[7px] font-black text-amber-500 uppercase tracking-wider">Unmet</span>
                )}
              </label>

              {depTasks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {depTasks.map(dep => (
                    <span key={dep.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg max-w-full">
                      <span className="text-[8px] font-black uppercase tracking-tight text-slate-700 dark:text-slate-300 max-w-[70px] truncate">{dep.title}</span>
                      <span className={`flex-shrink-0 text-[6px] font-black px-1 py-0.5 rounded uppercase ${STATUS_COLORS[dep.status]}`}>{dep.status}</span>
                      <button
                        onClick={() => setEditedTask({...editedTask, dependencies: (editedTask.dependencies || []).filter(id => id !== dep.id)})}
                        className="flex-shrink-0 text-slate-300 dark:text-slate-500 hover:text-red-600 ml-0.5 transition-colors"
                      >
                        <X size={8} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative mb-2">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={depSearch}
                  onChange={(e) => setDepSearch(e.target.value)}
                  placeholder="Search tasks to depend on..."
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl text-xs font-medium outline-none focus:border-teamColor transition-colors dark:text-white"
                />
              </div>
              <div className="space-y-1 max-h-36 overflow-auto kanban-scroll">
                {candidateDeps
                  .filter(t => !depSearch.trim() || t.title.toLowerCase().includes(depSearch.toLowerCase()))
                  .map(dep => {
                    const isSelected = (editedTask.dependencies || []).includes(dep.id);
                    return (
                      <button
                        key={dep.id}
                        onClick={() => {
                          const newDeps = isSelected
                            ? (editedTask.dependencies || []).filter(id => id !== dep.id)
                            : [...(editedTask.dependencies || []), dep.id];
                          setEditedTask({...editedTask, dependencies: newDeps});
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[9px] font-black border-2 transition-all text-left uppercase tracking-tight ${
                          isSelected
                            ? 'bg-slate-950 dark:bg-slate-700 text-white border-slate-800 dark:border-slate-600'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <span className="truncate flex-1">{dep.title}</span>
                        <span className={`flex-shrink-0 text-[7px] font-black px-1.5 py-0.5 rounded uppercase ${isSelected ? 'bg-white/20 text-white' : STATUS_COLORS[dep.status]}`}>
                          {dep.status}
                        </span>
                      </button>
                    );
                  })
                }
                {candidateDeps.filter(t => !depSearch.trim() || t.title.toLowerCase().includes(depSearch.toLowerCase())).length === 0 && (
                  <p className="text-center text-slate-400 dark:text-slate-500 text-xs py-3 font-medium">No tasks available in this project</p>
                )}
              </div>
            </div>

            <div className="pt-8 border-t border-slate-200 dark:border-slate-700 space-y-3">
                {editedTask.deptOnly && editedTask.departments.length === 0 && (
                  <p className="text-[9px] text-amber-600 dark:text-amber-400 font-black text-center uppercase tracking-wide">
                    "Dept Board Only" will be cleared on save — no department selected.
                  </p>
                )}
                <button
                  onClick={commitTask}
                  className="w-full py-6 bg-teamColor text-white font-black rounded-[28px] hover:opacity-90 shadow-2xl shadow-teamColor/20 transition-all uppercase tracking-[0.2em] text-sm"
                >
                  Commit Mission
                </button>
            </div>
          </div>
        </div>
      </div>

      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setShowCloseConfirm(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl border-t-8 border-amber-500" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={26} />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase text-center tracking-tight">Unsaved Changes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-bold text-center mt-2 mb-6">
              You've edited this task but haven't committed the mission. What would you like to do?
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => { setShowCloseConfirm(false); commitTask(); }}
                className="w-full py-4 bg-teamColor text-white font-black rounded-2xl hover:opacity-90 transition-all uppercase tracking-widest text-xs"
              >
                Commit Mission
              </button>
              <button
                onClick={() => { setShowCloseConfirm(false); onClose(); }}
                className="w-full py-4 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-black rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all uppercase tracking-widest text-xs"
              >
                Discard &amp; Close
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full py-3 text-slate-400 font-bold rounded-2xl hover:text-slate-600 dark:hover:text-slate-300 transition-all uppercase tracking-widest text-[10px]"
              >
                Keep Editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskModal;
