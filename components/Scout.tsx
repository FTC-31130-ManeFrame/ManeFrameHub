import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTeamSettings } from '../contexts/TeamSettingsContext';
import { useTeamTime } from '../utils/timeFormat';
import { api } from '../services/api';
import { Plus, ArrowLeft, Search, X, ChevronLeft, ChevronRight, QrCode, Camera, Download, Upload, Bot, Swords, Trophy, Hash, Users, MapPin, Calendar, Trash2, Flame, Monitor, WifiOff, Wifi, ArrowUpDown, Grid3X3, List, ImageIcon, Brain, Video, UserCheck, AlertCircle, Copy, Check, Settings, Zap, RefreshCw, KeyRound } from 'lucide-react';
import pako from 'pako';
import { QRCodeSVG } from 'qrcode.react';
import { getOfflineQueue, addToOfflineQueue, syncOfflineQueue, type OfflineMatchEntry } from '../services/offlineQueue';
import { ROLE_COLORS } from '../constants';
import { Counter, StarRating, RatingSlider, TagInput } from './scout/shared';
import RobotDashboard from './scout/RobotDashboard';
import ScoutQR from './scout/ScoutQR';
import PitDisplay from './scout/PitDisplay';
import ScoutEventList from './scout/ScoutEventList';
import FirstEventImportModal from './FirstEventImportModal';
import { ftcSeasonFor } from '../shared/ftcSeason';
import SeasonManager from './scout/SeasonManager';
import DynamicScoutForm from './scout/DynamicScoutForm';
import {
  DEFAULT_TEMPLATES, isNumericField, computeAggregates, describeRecord, summarizeRecord, summaryFields,
  observationCount, mergeScoutData, formatValue, fieldValue,
  type TemplateField, type ScoutKind,
} from '../shared/scoutingTemplates';

// Scouting always renders from a template: the event's season template, or the
// current game's default when the event has no season (or its season has none).
function effectiveTemplate(tpl: any, kind: ScoutKind): { id?: number; name: string; fields: TemplateField[] } {
  return tpl?.fields?.length ? tpl : DEFAULT_TEMPLATES[kind];
}

// Build an empty form (defaults per field type) for a custom template so custom
// records never carry legacy default keys.
function defaultFormFromTemplate(tpl: any): Record<string, any> {
  const form: Record<string, any> = {};
  for (const f of (tpl?.fields || []) as TemplateField[]) {
    if (f.archived) continue;
    switch (f.type) {
      case 'multiselect': form[f.key] = []; break;
      case 'boolean': form[f.key] = false; break;
      case 'counter': form[f.key] = f.min ?? 0; break;
      case 'rating': form[f.key] = 0; break;
      case 'slider': form[f.key] = f.min ?? 1; break;
      case 'number': form[f.key] = undefined; break;
      default: form[f.key] = '';
    }
  }
  return form;
}

interface ScoutProps {
  currentUser: any;
}

const Scout: React.FC<ScoutProps> = ({ currentUser }) => {
  const location = useLocation();
  const { settings } = useTeamSettings();
  const { fmtTime } = useTeamTime();
  const teamNumber = settings.teamNumber;
  // FIRST's FTC API identifies teams by number; match rows carry them as
  // "ftc<number>" keys (see server/services/firstApi.ts).
  const teamKeyPrefix = 'ftc';
  const myTeamKey = `${teamKeyPrefix}${teamNumber}`;
  const [events, setEvents] = useState<any[]>([]);
  const [activeEvent, setActiveEvent] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'robots' | 'matches' | 'info' | 'schedule' | 'qr' | 'display'>('robots');
  const [pitScouts, setPitScouts] = useState<any[]>([]);
  const [matchScoutsData, setMatchScoutsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPitForm, setShowPitForm] = useState(false);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingPit, setEditingPit] = useState<any | null>(null);
  const [editingMatch, setEditingMatch] = useState<any | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<any | null>(null);
  const [eventCounts, setEventCounts] = useState<Record<number, { pits: number; matches: number }>>({});
  const [seasons, setSeasons] = useState<any[]>([]);
  const [showSeasonManager, setShowSeasonManager] = useState(false);
  const [activePitTemplate, setActivePitTemplate] = useState<any | null>(null);
  const [activeMatchTemplate, setActiveMatchTemplate] = useState<any | null>(null);
  const pitTemplate = effectiveTemplate(activePitTemplate, 'pit');
  const matchTemplate = effectiveTemplate(activeMatchTemplate, 'match');
  const [eventSeasonFilter, setEventSeasonFilter] = useState<number | 'all'>('all');

  const [eventForm, setEventForm] = useState<any>({ name: '', location: '', startDate: '', endDate: '', eventCode: '', seasonId: undefined });
  const [showImportModal, setShowImportModal] = useState(false);
  const [tbaMatches, setTbaMatches] = useState<any[]>([]);
  const [tbaRecord, setTbaRecord] = useState<{ wins: number; losses: number; ties: number } | null>(null);
  const [tbaLoading, setTbaLoading] = useState(false);
  const [tbaImporting, setTbaImporting] = useState(false);
  const [tbaRankings, setTbaRankings] = useState<Map<number, { rank: number; rp: number; record: string }>>(new Map());
  const [pitSubTab, setPitSubTab] = useState<'live' | 'rankings'>('live');

  const [pitForm, setPitForm] = useState<Record<string, any>>(() => defaultFormFromTemplate(DEFAULT_TEMPLATES.pit));
  const [matchForm, setMatchForm] = useState<Record<string, any>>(() => defaultFormFromTemplate(DEFAULT_TEMPLATES.match));

  const [matchClaims, setMatchClaims] = useState<Record<string, { userId: number; userName: string }>>(() => {
    try { return JSON.parse(localStorage.getItem(`piobyte_claims`) || '{}'); } catch { return {}; }
  });
  const [teamClaims, setTeamClaims] = useState<Record<string, { userId: number; userName: string }>>({});
  const activeTeamClaimRef = useRef<{ matchKey: string; teamNumber: number } | null>(null);
  const teamClaimsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [geminiModal, setGeminiModal] = useState<{ open: boolean; text: string; matchLabel: string }>({ open: false, text: '', matchLabel: '' });
  const [copiedGemini, setCopiedGemini] = useState(false);

  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
  const [selectedRobotIds, setSelectedRobotIds] = useState<Set<number>>(new Set());
  const [robotSort, setRobotSort] = useState<'number' | 'name'>('number');
  const [matchViewMode, setMatchViewMode] = useState<'list' | 'roster'>('list');
  const [matchRefreshing, setMatchRefreshing] = useState(false);

  const [teamSeasonEvents, setTeamSeasonEvents] = useState<any[]>([]);
  const [teamSeasonLoading, setTeamSeasonLoading] = useState(false);
  const [crossEventMatches, setCrossEventMatches] = useState<any[]>([]);

  const [qrData, setQrData] = useState<string[]>([]);
  const [qrChunkIndex, setQrChunkIndex] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scannedChunks, setScannedChunks] = useState<Map<string, string>>(new Map());
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const scannerRef = useRef<any>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  const [offlineQueue, setOfflineQueue] = useState<OfflineMatchEntry[]>(getOfflineQueue());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [showEventSettings, setShowEventSettings] = useState(false);
  const [eventSettingsForm, setEventSettingsForm] = useState({ eventCode: '' });
  const [eventSettingsSaveError, setEventSettingsSaveError] = useState<string | null>(null);


  const [pitDisplayAlerts, setPitDisplayAlerts] = useState<any[]>([]);
  const [dismissedPitAlertIds, setDismissedPitAlertIds] = useState<Set<number>>(() => {
    try {
      const s = sessionStorage.getItem('piobyte_dismissed_pit_alerts');
      return s ? new Set(JSON.parse(s)) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [eventInfoData, setEventInfoData] = useState<any | null>(null);
  const [editingEventInfo, setEditingEventInfo] = useState(false);
  const [eventInfoForm, setEventInfoForm] = useState({ venueInfo: '', wifiNetwork: '', wifiPassword: '', parkingInfo: '', schedule: '', resources: '', notes: '' });
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [assignmentForm, setAssignmentForm] = useState({ userId: 0, fromMatch: 1, toMatch: 10, role: 'Scout - Stands', notes: '' });
  const [showAssignmentList, setShowAssignmentList] = useState(false);
  const [matchExceptionsSet, setMatchExceptionsSet] = useState<Set<string>>(new Set());
  const [cellPopover, setCellPopover] = useState<{ userId: number; matchNum: number; assign: any } | null>(null);

  const ASSIGNMENT_ROLES = ['Scout - Stands', 'Pit Crew', 'Networking', 'Media', 'Free Time', 'Driver/Coach Support'];
  const ROLE_CHIP_COLORS: Record<string, string> = {
    'Scout - Stands': 'bg-teamColor text-white',
    'Pit Crew': 'bg-orange-500 text-white',
    'Networking': 'bg-blue-500 text-white',
    'Media': 'bg-violet-500 text-white',
    'Free Time': 'bg-green-500 text-white',
    'Driver/Coach Support': 'bg-indigo-500 text-white',
  };
  const ROLE_ABBREV: Record<string, string> = {
    'Scout - Stands': 'Scout',
    'Pit Crew': 'Pit',
    'Networking': 'Net',
    'Media': 'Media',
    'Free Time': 'Free',
    'Driver/Coach Support': 'D/C',
  };

  const fetchEventInfoData = useCallback(async (eventId: number) => {
    try {
      const data = await api.eventInfo.get(eventId);
      setEventInfoData(data || null);
    } catch (err) {
      console.error('Failed to fetch event info:', err);
    }
  }, []);

  const fetchAssignments = useCallback(async (eventId: number) => {
    setAssignmentsLoading(true);
    try {
      const data = await api.competitionAssignments.list(eventId);
      setAssignments(data);
    } catch (err) {
      console.error('Failed to fetch assignments:', err);
    }
    setAssignmentsLoading(false);
  }, []);

  const fetchMatchExceptions = useCallback(async (eventId: number) => {
    try {
      const data = await api.matchExceptions.list(eventId);
      setMatchExceptionsSet(new Set(data.map((e: any) => `${e.userId}_${e.matchNumber}`)));
    } catch (err) {
      console.error('Failed to fetch match exceptions:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'display') return;
    const fetchPitAlerts = async () => {
      try {
        const alerts = await api.fullscreenAlerts.list(true);
        setPitDisplayAlerts(alerts.filter((a: any) => a.targetPitDisplay && a.active));
      } catch {}
    };
    fetchPitAlerts();
    const interval = setInterval(fetchPitAlerts, 10000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const dismissPitAlert = (id: number) => {
    setDismissedPitAlertIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try { sessionStorage.setItem('piobyte_dismissed_pit_alerts', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      handleSync();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const handleSync = async () => {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;
    try {
      const result = await syncOfflineQueue(async (eventId, data) => {
        await api.scout.createMatchScout(eventId, data);
      });
      setOfflineQueue(getOfflineQueue());
      if (result.synced > 0) {
        setSyncMessage(`Synced ${result.synced} offline match${result.synced !== 1 ? 'es' : ''}`);
        setTimeout(() => setSyncMessage(null), 4000);
        if (activeEvent) fetchEventData(activeEvent.id);
      }
    } catch {}
  };

  const isCoachOrCaptain = currentUser?.roles?.some((r: string) =>
    r === 'Coach' || r === 'Team Captain'
  );
  const isGuest = currentUser?.roles?.includes('Guest') ?? false;

  const fetchEvents = useCallback(async (): Promise<any[]> => {
    try {
      const data = await api.scout.getEvents();
      setEvents(data);
      const counts: Record<number, { pits: number; matches: number }> = {};
      for (const evt of data) {
        try {
          const [pits, matches] = await Promise.all([
            api.scout.getPitScouts(evt.id),
            api.scout.getMatchScouts(evt.id),
          ]);
          counts[evt.id] = { pits: pits.length, matches: matches.length };
        } catch {
          counts[evt.id] = { pits: 0, matches: 0 };
        }
      }
      setEventCounts(counts);
      return data;
    } catch (err) {
      console.error('Failed to fetch events:', err);
      return [];
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const fetchSeasons = useCallback(async () => {
    try {
      const rows = await api.seasons.getAll();
      setSeasons(rows);
      return rows;
    } catch {
      return [];
    }
  }, []);
  useEffect(() => { fetchSeasons(); }, [fetchSeasons]);

  // Auto-enter event when navigated from the home page upcoming-events card
  const openEventIdHandled = useRef(false);
  useEffect(() => {
    const openId = (location.state as any)?.openEventId;
    if (!openId || openEventIdHandled.current || events.length === 0) return;
    const target = events.find((e: any) => e.id === openId);
    if (target) {
      openEventIdHandled.current = true;
      enterEvent(target);
    }
  }, [events, location.state]);

  const guestEventHandled = useRef(false);
  useEffect(() => {
    if (!isGuest || guestEventHandled.current || events.length === 0 || activeEvent) return;
    const guestEventId = currentUser?.guestEventId;
    if (!guestEventId) return;
    const target = events.find((e: any) => e.id === guestEventId);
    if (target) {
      guestEventHandled.current = true;
      enterEvent(target);
    }
  }, [isGuest, events, activeEvent, currentUser?.guestEventId]);

  useEffect(() => {
    api.users.getAll().then(setAllUsers).catch(() => {});
  }, []);

  const fetchEventData = useCallback(async (eventId: number) => {
    setLoading(true);
    try {
      const [pits, matches] = await Promise.all([
        api.scout.getPitScouts(eventId),
        api.scout.getMatchScouts(eventId),
      ]);
      setPitScouts(pits);
      setMatchScoutsData(matches);
    } catch (err) {
      console.error('Failed to fetch event data:', err);
    }
    setLoading(false);
  }, []);

  // Schedule, results and rankings come from FIRST's FTC Events API, already
  // normalized by the server. The season comes from the event's own date so a
  // past event keeps loading after the season rolls over.
  const fetchFirstData = useCallback(async (event: any) => {
    const eventCode = event?.eventCode;
    if (!eventCode) return;
    const season = ftcSeasonFor(event.startDate);
    setTbaLoading(true);
    try {
      const [allMatches, rankingsData] = await Promise.all([
        api.first.getEventMatches(eventCode, season),
        api.first.getEventRankings(eventCode, season).catch(() => []),
      ]);
      const normalizedMatches = allMatches || [];
      setTbaMatches(normalizedMatches);
      if (Array.isArray(rankingsData) && rankingsData.length > 0) {
        const map = new Map<number, { rank: number; rp: number; record: string }>();
        for (const r of rankingsData) {
          if (r.teamNumber) {
            map.set(r.teamNumber, {
              rank: r.rank || 0,
              rp: r.rp || 0,
              record: r.record || '0-0-0',
            });
          }
        }
        setTbaRankings(map);
      }
      const ftcKey = `ftc${teamNumber}`;
      const ourMatches = normalizedMatches.filter((m: any) =>
        m.alliances?.red?.team_keys?.includes(ftcKey) || m.alliances?.blue?.team_keys?.includes(ftcKey)
      );
      if (ourMatches.length > 0) {
        let wins = 0, losses = 0, ties = 0;
        for (const m of ourMatches) {
          if (m.post_result_time === null) continue;
          const isRed = m.alliances?.red?.team_keys?.includes(ftcKey);
          const ourAlliance = isRed ? 'red' : 'blue';
          if (m.winning_alliance === '') { ties++; }
          else if (m.winning_alliance === ourAlliance) { wins++; }
          else { losses++; }
        }
        setTbaRecord({ wins, losses, ties });
      } else {
        setTbaRecord(null);
      }
    } catch (err) {
      console.error('Failed to fetch FIRST event data:', err);
      setTbaMatches([]);
      setTbaRecord(null);
    }
    setTbaLoading(false);
  }, [teamNumber]);

  // Re-runs the FIRST import for this event: adds any teams FIRST has
  // published since, and links the calendar event if it isn't yet.
  const refreshTeamsFromFirst = async () => {
    if (!activeEvent?.eventCode) return;
    setTbaImporting(true);
    try {
      const r = await api.first.importEvent(activeEvent.eventCode, ftcSeasonFor(activeEvent.startDate));
      alert(r.teamsTotal === 0
        ? "FIRST hasn't published the team list for this event yet. Try again closer to the event."
        : r.teamsAdded === 0
          ? `All ${r.teamsTotal} teams are already in this event.`
          : `Added ${r.teamsAdded} team${r.teamsAdded === 1 ? '' : 's'} (${r.teamsTotal} registered).`);
      fetchEventData(activeEvent.id);
    } catch (err: any) {
      alert(err?.message || 'Could not refresh teams from FIRST.');
    }
    setTbaImporting(false);
  };

  const openRobotByNumber = (teamNumber: number) => {
    const robot = pitScouts.find((ps: any) => ps.teamNumber === teamNumber);
    if (robot) {
      setSelectedRobot(robot);
    }
  };

  const enterEvent = (event: any) => {
    setActiveEvent(event);
    setActiveTab('robots');
    setEventInfoData(null);
    setAssignments([]);
    setEditingEventInfo(false);
    // Load the event's season templates (drives the dynamic scout forms).
    setActivePitTemplate(null);
    setActiveMatchTemplate(null);
    if (event.seasonId) {
      api.seasons.getTemplate(event.seasonId, 'pit').then(setActivePitTemplate).catch(() => {});
      api.seasons.getTemplate(event.seasonId, 'match').then(setActiveMatchTemplate).catch(() => {});
    }
    fetchEventData(event.id);
    fetchEventInfoData(event.id);
    fetchAssignments(event.id);
    fetchMatchExceptions(event.id);
    if (event.eventCode) fetchFirstData(event);
  };

  useEffect(() => {
    if (!activeEvent) return;
    fetchTeamClaims();
    if (teamClaimsPollRef.current) clearInterval(teamClaimsPollRef.current);
    teamClaimsPollRef.current = setInterval(fetchTeamClaims, 30000);
    return () => {
      if (teamClaimsPollRef.current) clearInterval(teamClaimsPollRef.current);
    };
  }, [activeEvent?.id]);

  const handleCreateEvent = async () => {
    if (!eventForm.name.trim()) return;
    try {
      await api.scout.createEvent({
        ...eventForm,
        createdBy: parseInt(currentUser.id),
      });
      setShowEventForm(false);
      setEventForm({ name: '', location: '', startDate: '', endDate: '', eventCode: '' });
      fetchEvents();
    } catch (err) {
      console.error('Failed to create event:', err);
    }
  };

  const openEventSettings = () => {
    setEventSettingsForm({ eventCode: activeEvent?.eventCode || '' });
    setEventSettingsSaveError(null);
    setShowEventSettings(true);
  };

  const handleSaveEventSettings = async () => {
    if (!activeEvent) return;
    setEventSettingsSaveError(null);
    try {
      const eventCode = eventSettingsForm.eventCode.trim().toUpperCase() || null;
      await api.scout.updateEvent(activeEvent.id, { eventCode });
      const freshEvents = await fetchEvents();
      const merged = freshEvents.find((e: any) => e.id === activeEvent.id) || { ...activeEvent, eventCode };
      setActiveEvent(merged);
      setShowEventSettings(false);
      if (merged.eventCode) fetchFirstData(merged);
    } catch (err: any) {
      console.error('Failed to update event settings:', err);
      setEventSettingsSaveError(err?.message || 'Failed to save settings. Please try again.');
    }
  };

  const handleDeleteEvent = async (id: number) => {
    if (!confirm('Delete this event and all its scouting data?')) return;
    try {
      await api.scout.deleteEvent(id);
      fetchEvents();
    } catch (err) {
      console.error('Failed to delete event:', err);
    }
  };

  const handleSavePitScout = async () => {
    if (isGuest) return;
    if (!pitForm.teamNumber || !activeEvent) return;
    try {
      // Send the form as an explicit `data` blob so custom-template fields are
      // stored verbatim; the server dual-writes the built-in legacy columns.
      const payload = { data: { ...pitForm }, scoutedBy: parseInt(currentUser.id), templateId: activePitTemplate?.id };
      if (editingPit) {
        await api.scout.updatePitScout(editingPit.id, payload);
      } else {
        await api.scout.createPitScout(activeEvent.id, payload);
      }
      setShowPitForm(false);
      setEditingPit(null);
      resetPitForm();
      fetchEventData(activeEvent.id);
    } catch (err) {
      console.error('Failed to save pit scout:', err);
    }
  };

  const handleDeletePitScout = async (id: number) => {
    if (isGuest) return;
    if (!confirm('Delete this robot scouting data?')) return;
    try {
      await api.scout.deletePitScout(id);
      setSelectedRobot(null);
      if (activeEvent) fetchEventData(activeEvent.id);
    } catch (err) {
      console.error('Failed to delete pit scout:', err);
    }
  };

  const handleSaveMatchScout = async () => {
    if (isGuest) return;
    if (!matchForm.teamNumber || !activeEvent) return;
    const matchData: Record<string, any> = { ...matchForm };
    const payload = { data: matchData, scoutedBy: parseInt(currentUser.id), templateId: activeMatchTemplate?.id };
    if (editingMatch) {
      try {
        await api.scout.updateMatchScout(editingMatch.id, payload);
        if (activeTeamClaimRef.current) {
          unclaimTeam(activeTeamClaimRef.current.matchKey, activeTeamClaimRef.current.teamNumber);
        }
        setShowMatchForm(false);
        setEditingMatch(null);
        resetMatchForm();
        setSyncMessage(`Match ${matchData.matchNumber} updated — Team ${matchData.teamNumber} ✓`);
        setTimeout(() => setSyncMessage(null), 4000);
        fetchEventData(activeEvent.id);
      } catch (err) {
        console.error('Failed to update match scout:', err);
      }
      return;
    }
    try {
      await api.scout.createMatchScout(activeEvent.id, payload);
      if (activeTeamClaimRef.current) {
        unclaimTeam(activeTeamClaimRef.current.matchKey, activeTeamClaimRef.current.teamNumber);
      }
      setShowMatchForm(false);
      resetMatchForm();
      setSyncMessage(`Match ${matchData.matchNumber} saved — Team ${matchData.teamNumber} ✓`);
      setTimeout(() => setSyncMessage(null), 4000);
      fetchEventData(activeEvent.id);
    } catch (err) {
      addToOfflineQueue({ eventId: activeEvent.id, data: payload });
      setOfflineQueue(getOfflineQueue());
      setSyncMessage('Saved offline — will sync when connected');
      setTimeout(() => setSyncMessage(null), 4000);
      if (activeTeamClaimRef.current) {
        unclaimTeam(activeTeamClaimRef.current.matchKey, activeTeamClaimRef.current.teamNumber);
      }
      setShowMatchForm(false);
      resetMatchForm();
    }
  };

  const handleDeleteMatchScout = async (id: number) => {
    if (!confirm('Delete this match record?')) return;
    try {
      await api.scout.deleteMatchScout(id);
      if (activeEvent) fetchEventData(activeEvent.id);
    } catch (err) {
      console.error('Failed to delete match scout:', err);
    }
  };

  const resetPitForm = () => setPitForm(defaultFormFromTemplate(pitTemplate));

  const resetMatchForm = () => setMatchForm(defaultFormFromTemplate(matchTemplate));

  const openEditPit = (pit: any) => {
    setSelectedRobot(null);
    setEditingPit(pit);
    setPitForm({ ...defaultFormFromTemplate(pitTemplate), ...(pit.data || {}) });
    setShowPitForm(true);
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = (h / w) * maxDim; w = maxDim; }
            else { w = (w / h) * maxDim; h = maxDim; }
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const openEditMatch = (match: any) => {
    setEditingMatch(match);
    setMatchForm({ ...defaultFormFromTemplate(matchTemplate), ...(match.data || {}) });
    setShowMatchForm(true);
  };

  const claimMatch = (matchKey: string) => {
    if (isGuest) return;
    const updated = { ...matchClaims, [matchKey]: { userId: parseInt(currentUser.id), userName: currentUser.name || currentUser.username } };
    setMatchClaims(updated);
    localStorage.setItem('piobyte_claims', JSON.stringify(updated));
  };

  const unclaimMatch = (matchKey: string) => {
    if (isGuest) return;
    const updated = { ...matchClaims };
    delete updated[matchKey];
    setMatchClaims(updated);
    localStorage.setItem('piobyte_claims', JSON.stringify(updated));
  };

  const fetchTeamClaims = async () => {
    if (!activeEvent) return;
    try {
      const claims = await api.scout.getTeamClaims(activeEvent.id);
      const map: Record<string, { userId: number; userName: string }> = {};
      for (const c of claims) {
        map[`${c.matchKey}:${c.teamNumber}`] = { userId: c.userId, userName: c.userName };
      }
      setTeamClaims(map);
    } catch {}
  };

  const handleMatchRefresh = useCallback(async () => {
    if (!activeEvent) return;
    setMatchRefreshing(true);
    const tasks: Promise<any>[] = [
      fetchEventData(activeEvent.id),
      fetchTeamClaims(),
    ];
    if (activeEvent.eventCode) tasks.push(fetchFirstData(activeEvent));
    await Promise.allSettled(tasks);
    setMatchRefreshing(false);
  }, [activeEvent, fetchEventData, fetchFirstData]);

  const claimTeam = async (matchKey: string, teamNumber: number) => {
    if (isGuest || !activeEvent || !currentUser) return;
    const key = `${matchKey}:${teamNumber}`;
    const entry = { userId: parseInt(currentUser.id), userName: currentUser.name || currentUser.username };
    setTeamClaims(prev => ({ ...prev, [key]: entry }));
    activeTeamClaimRef.current = { matchKey, teamNumber };
    try {
      await api.scout.upsertTeamClaim(activeEvent.id, { matchKey, teamNumber, userId: parseInt(currentUser.id), userName: entry.userName });
    } catch {}
  };

  const unclaimTeam = async (matchKey: string, teamNumber: number) => {
    if (!activeEvent || !currentUser) return;
    const key = `${matchKey}:${teamNumber}`;
    setTeamClaims(prev => { const next = { ...prev }; delete next[key]; return next; });
    activeTeamClaimRef.current = null;
    try {
      await api.scout.deleteTeamClaim(activeEvent.id, matchKey, teamNumber, parseInt(currentUser.id));
    } catch {}
  };

  const generateGeminiReport = (tbaMatch: any) => {
    const getLabel = (m: any) => {
      const c = m.comp_level || 'qm', n = m.match_number || 0, s = m.set_number || 0;
      if (c === 'qm') return `Qualification ${n}`;
      if (c === 'qf') return `Quarterfinal ${s}-${n}`;
      if (c === 'sf') return `Semifinal ${s}-${n}`;
      if (c === 'f') return `Final ${n}`;
      return `Match ${n}`;
    };
    const label = getLabel(tbaMatch);
    const allTeamKeys = [...(tbaMatch.alliances?.red?.team_keys || []), ...(tbaMatch.alliances?.blue?.team_keys || [])];
    let report = `# FTC Match Analysis Request: ${label}\nEvent: ${activeEvent?.name}\n\n`;
    report += `**Red Alliance:** ${(tbaMatch.alliances?.red?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(', ')}\n`;
    report += `**Blue Alliance:** ${(tbaMatch.alliances?.blue?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(', ')}\n\n`;
    report += `## Scouted Team Data\n\n`;
    for (const teamKey of allTeamKeys) {
      const teamNum = parseInt(teamKey.replace(/^ftc/, ''));
      const isRed = tbaMatch.alliances?.red?.team_keys?.includes(teamKey);
      const pit = pitScouts.find((p: any) => p.teamNumber === teamNum);
      const teamMatches = matchScoutsData.filter((m: any) => m.teamNumber === teamNum);
      report += `### Team ${teamNum}${pit?.teamName ? ` — ${pit.teamName}` : ''} (${isRed ? 'RED' : 'BLUE'})\n`;
      const pitLines = pit ? describeRecord(pit, pitTemplate.fields) : [];
      report += pitLines.length ? `Pit: ${pitLines.join(' | ')}\n` : `No pit scout data.\n`;
      if (teamMatches.length > 0) {
        const stats = computeAggregates(teamMatches, matchTemplate.fields).filter(a => a.n > 0);
        report += `Match Performance (${teamMatches.length} matches): ${stats.map(a => `${a.prefix ? `${a.prefix} ` : ''}${a.label} ${a.display}`).join(', ') || 'no stats configured'}\n`;
        for (const m of [...teamMatches].sort((a: any, b: any) => a.matchNumber - b.matchNumber).slice(-3)) {
          const notes = fieldValue(m, 'notes');
          report += `  M${m.matchNumber} (${m.alliance}): ${summarizeRecord(m, matchTemplate.fields, 6)}${notes ? `, "${notes}"` : ''}\n`;
        }
      } else { report += `No match data.\n`; }
      const r = tbaRankings.get(teamNum);
      if (r) report += `Event Rank: #${r.rank} | Record: ${r.record} | RP: ${r.rp.toFixed(2)}\n`;
      report += '\n';
    }
    report += `---\nPlease analyze this match data and provide strategic recommendations for match strategy and alliance performance.`;
    setGeminiModal({ open: true, text: report, matchLabel: label });
  };

  const generateRobotAIReport = () => {
    if (!selectedRobot) return;
    const r = selectedRobot;
    let report = `# Team ${r.teamNumber} — ${r.teamName || 'Unknown Team'}\n\n`;
    report += `## Pit Scout Data\n`;
    const pitLines = describeRecord(r, pitTemplate.fields);
    report += pitLines.length ? pitLines.map(l => `${l}\n`).join('') : 'Not pit scouted yet.\n';
    report += '\n';

    const currentEventName = activeEvent?.name || 'Current Event';
    const currentMatches = robotMatches;
    const otherEventMatches = crossEventMatches.filter((m: any) => m.eventId !== activeEvent?.id);
    const otherGrouped = new Map<string, any[]>();
    for (const m of otherEventMatches) {
      const key = m.eventName || `Event ${m.eventId}`;
      if (!otherGrouped.has(key)) otherGrouped.set(key, []);
      otherGrouped.get(key)!.push(m);
    }

    const formatMatchBlock = (matches: any[], eventLabel: string) => {
      let block = `## Match History — ${eventLabel} (${matches.length} matches)\n`;
      if (matches.length > 0) {
        const stats = computeAggregates(matches, matchTemplate.fields).filter(a => a.n > 0);
        if (stats.length) block += `Stats: ${stats.map(a => `${a.prefix ? `${a.prefix} ` : ''}${a.label} ${a.display}`).join(', ')}\n`;
        for (const m of [...matches].sort((a: any, b: any) => a.matchNumber - b.matchNumber)) {
          const lines = describeRecord(m, matchTemplate.fields);
          block += `  M${m.matchNumber} [${m.matchType || 'qualification'}] (${m.alliance}): ${lines.join(', ') || '—'}\n`;
        }
      }
      return block + '\n';
    };

    report += formatMatchBlock(currentMatches, currentEventName);

    for (const [eventName, matches] of otherGrouped) {
      report += formatMatchBlock(matches, eventName);
    }

    if (teamSeasonEvents.length > 0) {
      report += `## Events This Season (FIRST)\n`;
      for (const evt of [...teamSeasonEvents].sort((a: any, b: any) => String(a.startDate || '').localeCompare(String(b.startDate || '')))) {
        report += `  ${evt.name} (${evt.startDate || '?'})\n`;
      }
      report += '\n';
    }

    report += `---\nPlease analyze this team's scouting data and provide strategic insights: strengths, weaknesses, ideal match roles, and how to best compete against or alongside them.`;
    setGeminiModal({ open: true, text: report, matchLabel: `Team ${r.teamNumber} Scouting Report` });
  };

  const generateQR = async () => {
    if (!activeEvent) return;
    try {
      const allMatches = matchScoutsData;
      const filteredMatches = selectedMatchIds.size > 0
        ? allMatches.filter((m: any) => selectedMatchIds.has(m.id))
        : allMatches;
      // v4 carries each record's full template data, so any season's fields
      // survive the transfer. (v2/v3 encoded fixed legacy columns and silently
      // dropped most of what scouts actually recorded.) Photos are left out —
      // a single image would need dozens of QR frames.
      const withoutPhotos = (data: Record<string, any> = {}) =>
        Object.fromEntries(Object.entries(data).filter(([, v]) => !(typeof v === 'string' && v.startsWith('data:'))));
      const filteredRobots = selectedRobotIds.size > 0
        ? pitScouts.filter((r: any) => selectedRobotIds.has(r.id))
        : [];
      const payload: any = {
        v: 4,
        m: filteredMatches.map((m: any) => ({ ...withoutPhotos(m.data), matchNumber: m.matchNumber, teamNumber: m.teamNumber, matchType: m.matchType, alliance: m.alliance })),
      };
      if (filteredRobots.length > 0) {
        payload.r = filteredRobots.map((r: any) => ({ ...withoutPhotos(r.data), teamNumber: r.teamNumber, teamName: r.teamName || '' }));
      }
      const jsonStr = JSON.stringify(payload);
      const compressed = pako.deflate(new TextEncoder().encode(jsonStr));
      const base64 = btoa(String.fromCharCode(...compressed));
      const maxChunkSize = 2000;
      if (base64.length <= maxChunkSize) {
        setQrData([`1/1|${base64}`]);
      } else {
        const totalChunks = Math.ceil(base64.length / maxChunkSize);
        const chunks: string[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = base64.slice(i * maxChunkSize, (i + 1) * maxChunkSize);
          chunks.push(`${i + 1}/${totalChunks}|${chunk}`);
        }
        setQrData(chunks);
      }
      setQrChunkIndex(0);
    } catch (err) {
      console.error('Failed to generate QR:', err);
    }
  };

  const startScanner = async () => {
    setScanning(true);
    setScannedChunks(new Map());
    setImportPreview(null);
    setTimeout(async () => {
      const container = document.getElementById('qr-scanner-container');
      if (container) {
        try {
          const { Html5Qrcode } = await import('html5-qrcode');
          if (scannerRef.current) {
            try { await scannerRef.current.stop(); } catch {}
            scannerRef.current = null;
          }
          const scanner = new Html5Qrcode("qr-scanner-container");
          scannerRef.current = scanner;
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText: string) => {
              handleQRScanned(decodedText);
            },
            () => {}
          );
        } catch (err: any) {
          console.error('Scanner error:', err);
          if (err?.toString?.().includes('NotAllowedError') || err?.toString?.().includes('NotFoundError')) {
            alert('Camera access denied or no camera found. Please allow camera permissions and try again.');
          }
          setScanning(false);
        }
      }
    }, 300);
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const expandSlimMatch = (m: any) => ({
    matchNumber: m.mn,
    teamNumber: m.tn,
    alliance: m.al === 'R' ? 'Red' : 'Blue',
    autoScore: m.as || 0,
    teleopScore: m.ts || 0,
    endgameScore: m.es || 0,
    penalties: m.p || 0,
    autoClimb: !!m.ac,
    endClimbLevel: m.ec || 0,
    coralScored: m.cs || 0,
    algaeScored: m.ag || 0,
    humanPlayerScore: m.hp || 0,
    defenseRating: m.dr || 3,
    notes: m.n || '',
  });

  const expandSlimRobot = (r: any) => ({
    teamNumber: r.tn,
    teamName: r.tna || '',
    robotName: r.rn || '',
    drivetrain: r.dt || '',
    weight: r.w || 0,
    speed: r.sp || 0,
    height: r.h || 0,
    capabilities: r.cap || [],
    deficiencies: r.def || [],
    autonomousRoutine: r.ar || '',
    notes: r.n || '',
    offenseRating: r.or || 5,
    defenseRating: r.dr || 5,
    overallRating: r.ovr || 5,
  });

  const handleQRScanned = (text: string) => {
    const pipeIndex = text.indexOf('|');
    if (pipeIndex === -1) return;
    const header = text.substring(0, pipeIndex);
    const data = text.substring(pipeIndex + 1);
    setScannedChunks(prev => {
      const next = new Map(prev);
      next.set(header, data);
      const [, total] = header.split('/');
      const totalNum = parseInt(total);
      if (next.size === totalNum) {
        const sorted: string[] = [];
        for (let i = 1; i <= totalNum; i++) {
          sorted.push((next.get(`${i}/${totalNum}`) as string) || '');
        }
        const fullBase64 = sorted.join('');
        try {
          const binary = atob(fullBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const decompressed = pako.inflate(bytes);
          const jsonStr = new TextDecoder().decode(decompressed);
          const parsed = JSON.parse(jsonStr);
          let matchScouts: any[];
          let pitScoutsImport: any[] = [];
          if (parsed.v === 4 && Array.isArray(parsed.m)) {
            matchScouts = parsed.m.map((d: any) => ({
              data: d, matchNumber: d.matchNumber, teamNumber: d.teamNumber, matchType: d.matchType, alliance: d.alliance,
            }));
            pitScoutsImport = Array.isArray(parsed.r)
              ? parsed.r.map((d: any) => ({ data: d, teamNumber: d.teamNumber, teamName: d.teamName }))
              : [];
          } else if ((parsed.v === 2 || parsed.v === 3) && Array.isArray(parsed.m)) {
            matchScouts = parsed.m.map(expandSlimMatch);
            if (parsed.v === 3 && Array.isArray(parsed.r)) {
              pitScoutsImport = parsed.r.map(expandSlimRobot);
            }
          } else if (Array.isArray(parsed)) {
            matchScouts = parsed.map(expandSlimMatch);
          } else if (parsed.matchScouts) {
            matchScouts = parsed.matchScouts;
          } else {
            matchScouts = [];
          }
          setImportPreview({ matchScouts, pitScouts: pitScoutsImport });
          stopScanner();
        } catch (err) {
          console.error('Failed to decode QR data:', err);
        }
      }
      return next;
    });
  };

  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; robotsImported?: number; robotsSkipped?: number } | null>(null);

  const confirmImport = async () => {
    if (!importPreview || !activeEvent) return;
    try {
      const matchesWithScout = (importPreview.matchScouts || []).map((m: any) => ({
        ...m,
        scoutedBy: m.scoutedBy || parseInt(currentUser.id),
      }));
      const robotsData = (importPreview.pitScouts || []).map((r: any) => ({
        ...r,
        scoutedBy: parseInt(currentUser.id),
      }));
      const result = await api.scout.importEvent(activeEvent.id, { matchScouts: matchesWithScout, pitScouts: robotsData });
      setImportResult({
        imported: result.imported || 0,
        skipped: result.skipped || 0,
        robotsImported: result.robotsImported || 0,
        robotsSkipped: result.robotsSkipped || 0,
      });
      setImportPreview(null);
      setScannedChunks(new Map());
      fetchEventData(activeEvent.id);
    } catch (err) {
      console.error('Import failed:', err);
    }
  };

  const duplicateTeamNums = useMemo(() => {
    const seen = new Set<number>();
    const dupes = new Set<number>();
    for (const ps of pitScouts) {
      if (seen.has(ps.teamNumber)) dupes.add(ps.teamNumber);
      seen.add(ps.teamNumber);
    }
    return dupes;
  }, [pitScouts]);

  // Merge duplicate robot rows for a team into the most complete one: its
  // answers win, blanks are filled from the others, tags are unioned.
  const handleMergeDuplicates = async () => {
    if (!activeEvent || duplicateTeamNums.size === 0) return;
    const groups = new Map<number, any[]>();
    for (const ps of pitScouts) {
      const arr = groups.get(ps.teamNumber) || [];
      arr.push(ps);
      groups.set(ps.teamNumber, arr);
    }
    const dupeGroups = Array.from(groups.values()).filter(g => g.length > 1);
    try {
      for (const group of dupeGroups) {
        const [primary, ...rest] = [...group].sort((a, b) => observationCount(b) - observationCount(a));
        let data = { ...(primary.data || {}) };
        for (const other of rest) data = mergeScoutData(data, other.data || {});
        await api.scout.updatePitScout(primary.id, { data, teamName: primary.teamName || rest.find(o => o.teamName)?.teamName });
        for (const o of rest) await api.scout.deletePitScout(o.id);
      }
      await fetchEventData(activeEvent.id);
    } catch (err) {
      console.error('Merge failed:', err);
      alert('Merge failed — check the console for details.');
    }
  };

  const filteredPitScouts = pitScouts.filter(ps =>
    !searchTerm ||
    ps.teamNumber.toString().includes(searchTerm) ||
    ps.teamName?.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => {
    if (robotSort === 'name') {
      return (a.teamName || '').localeCompare(b.teamName || '');
    }
    return a.teamNumber - b.teamNumber;
  });

  const sortedMatches = [...matchScoutsData].sort((a, b) => a.matchNumber - b.matchNumber);

  const matchRosters = useMemo(() => {
    const grouped = new Map<number, any[]>();
    for (const m of matchScoutsData) {
      const arr = grouped.get(m.matchNumber) || [];
      arr.push(m);
      grouped.set(m.matchNumber, arr);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([matchNumber, entries]) => ({
        matchNumber,
        red: entries.filter(e => e.alliance === 'Red'),
        blue: entries.filter(e => e.alliance === 'Blue'),
      }));
  }, [matchScoutsData]);

  const robotMatches = useMemo(() => {
    if (!selectedRobot) return [];
    const raw = matchScoutsData.filter(m => m.teamNumber === selectedRobot.teamNumber);
    const grouped = new Map<string, any[]>();
    for (const m of raw) {
      const key = `${m.matchType || 'qualification'}:${m.matchNumber}`;
      const arr = grouped.get(key) || [];
      arr.push(m);
      grouped.set(key, arr);
    }
    // Consensus-average every numeric field defined by the event's match
    // template. Averages are written to both the `data` blob and the mirrored
    // top-level key so all readers agree.
    const numericFields = (matchTemplate.fields as TemplateField[])
      .filter(f => isNumericField(f) && !f.archived);
    return Array.from(grouped.entries()).map(([_key, entries]) => {
      if (entries.length === 1) return entries[0];
      const merged: any = { ...entries[0], data: { ...(entries[0].data || {}) }, _scoutCount: entries.length };
      for (const f of numericFields) {
        const vals = entries
          .map(e => fieldValue(e, f.key))
          .filter(v => typeof v === 'number');
        if (vals.length) {
          const a = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
          merged.data[f.key] = a;
          merged[f.key] = a;
        }
      }
      return merged;
    });
  }, [selectedRobot, matchScoutsData, matchTemplate]);

  const teamNamesMap = useMemo(() => {
    const m: Record<string, string> = {};
    pitScouts.forEach((ps: any) => {
      if (ps.teamNumber && ps.teamName) m[String(ps.teamNumber)] = ps.teamName;
    });
    return m;
  }, [pitScouts]);

  // A robot's other events this season (FIRST) plus our scouting of it at
  // every event, for the robot page.
  useEffect(() => {
    if (!selectedRobot) { setTeamSeasonEvents([]); setCrossEventMatches([]); return; }
    setTeamSeasonLoading(true);
    Promise.all([
      api.first.getTeamEvents(selectedRobot.teamNumber, ftcSeasonFor(activeEvent?.startDate)).catch(() => []),
      api.scout.getTeamAllMatches(selectedRobot.teamNumber).catch(() => []),
    ]).then(([evts, allMatches]) => {
      setTeamSeasonEvents(evts || []);
      setCrossEventMatches(allMatches || []);
      setTeamSeasonLoading(false);
    });
  }, [selectedRobot]);

  if (selectedRobot && activeEvent) {
    return (
      <RobotDashboard
        selectedRobot={selectedRobot}
        activeEvent={activeEvent}
        robotMatches={robotMatches}
        matchTemplate={matchTemplate}
        pitTemplate={pitTemplate}
        crossEventMatches={crossEventMatches}
        seasonEvents={teamSeasonEvents}
        seasonEventsLoading={teamSeasonLoading}
        geminiModal={geminiModal}
        copiedGemini={copiedGemini}
        onBack={() => setSelectedRobot(null)}
        onEditPit={openEditPit}
        onDeletePit={handleDeletePitScout}
        onGenerateAIReport={generateRobotAIReport}
        onSetGeminiModal={setGeminiModal}
        onSetCopiedGemini={setCopiedGemini}
        isGuest={isGuest}
      />
    );
  }

  if (activeEvent) {
    return (
      <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500">
        {isGuest && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl text-[10px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest">
            <KeyRound size={12} />
            Guest View · Read Only — {activeEvent.name}{currentUser?.name && currentUser.name !== 'Guest' ? ` · ${currentUser.name}` : ''}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 md:gap-4">
            {!isGuest && (
              <button onClick={() => { setActiveEvent(null); fetchEvents(); }} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 transition-all">
                <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
              </button>
            )}
            <div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{activeEvent.name}</h2>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                {activeEvent.location && `${activeEvent.location} • `}
                {activeEvent.startDate && activeEvent.startDate}
                {activeEvent.endDate && ` — ${activeEvent.endDate}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 text-[10px]">
            {isCoachOrCaptain && (
              <button
                onClick={openEventSettings}
                className="flex items-center gap-1.5 px-3 py-2 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-xl border border-violet-200 dark:border-violet-700 font-black uppercase tracking-widest hover:bg-violet-100 transition-all"
              >
                <Settings size={13} /> Settings
              </button>
            )}
            <button
              onClick={() => window.open(`/api/scout/events/${activeEvent.id}/export.csv`, '_blank')}
              title="Download all pit and match scout data as CSV"
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-600 font-black uppercase tracking-widest hover:bg-slate-100 dark:hover:bg-slate-600 transition-all"
            >
              <Download size={13} /> Export
            </button>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-700">
              <Bot size={14} className="text-teamColor" />
              <span className="font-black text-slate-800">{pitScouts.length}</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">robots</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-100 dark:border-slate-700">
              <Swords size={14} className="text-teamColor" />
              <span className="font-black text-slate-800">{matchScoutsData.length}</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">matches</span>
            </div>
            {offlineQueue.length > 0 && (
              <button
                onClick={handleSync}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 rounded-xl border border-amber-200 dark:border-amber-700 hover:bg-amber-100 transition-all"
              >
                <WifiOff size={14} className="text-amber-600" />
                <span className="font-black text-amber-700">{offlineQueue.length}</span>
                <span className="text-amber-500 font-bold">pending</span>
              </button>
            )}
            <div className={`flex items-center gap-1.5 px-2 py-2 rounded-xl ${isOnline ? 'text-green-600' : 'text-red-500'}`}>
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            </div>
          </div>
        </div>

        {syncMessage && (
          <div className="bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-700 rounded-xl p-3 flex items-center gap-3 animate-in fade-in duration-300">
            <Wifi size={16} className="text-green-600 shrink-0" />
            <p className="text-xs font-black text-green-700 uppercase tracking-widest">{syncMessage}</p>
          </div>
        )}

        <div className="overflow-x-auto -mx-2 px-2">
          <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-xl border border-slate-200 shadow-inner min-w-max">
            {(['robots', 'matches', 'info', 'schedule', 'qr', 'display'] as const).filter(tab => {
              if (tab === 'schedule' && !isCoachOrCaptain) return false;
              if (tab === 'info' && isGuest) return false;
              return true;
            }).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeTab === tab ? 'bg-white dark:bg-slate-800 text-slate-900 shadow-sm dark:text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                {tab === 'robots' ? 'Robots' : tab === 'matches' ? 'Matches' : tab === 'info' ? 'Info' : tab === 'schedule' ? 'Schedule' : tab === 'qr' ? 'QR' : 'Pit Display'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">Loading...</div>
        ) : activeTab === 'robots' ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search teams..."
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-[24px] outline-none focus:border-teamColor transition-all font-bold text-sm"
                />
              </div>
              <button
                onClick={() => setRobotSort(robotSort === 'number' ? 'name' : 'number')}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-black rounded-xl hover:bg-slate-200 transition-all uppercase text-[10px] tracking-widest"
                title={`Sort by ${robotSort === 'number' ? 'name' : 'number'}`}
              >
                <ArrowUpDown size={14} /> {robotSort === 'number' ? '#' : 'A-Z'}
              </button>
              {!isGuest && activeEvent?.eventCode && (
                <button
                  onClick={refreshTeamsFromFirst}
                  disabled={tbaImporting}
                  title="Add any teams FIRST has registered for this event since it was imported"
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 dark:bg-slate-700 text-white font-black rounded-xl hover:opacity-90 shadow-lg transition-all uppercase text-[10px] tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={16} className={tbaImporting ? 'animate-spin' : ''} /> {tbaImporting ? 'Refreshing...' : 'Refresh Teams'}
                </button>
              )}
              {!isGuest && (
                <button
                  onClick={() => { resetPitForm(); setEditingPit(null); setShowPitForm(true); }}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase text-[10px] tracking-widest"
                >
                  <Plus size={16} /> Scout Robot
                </button>
              )}
            </div>

            {!isGuest && duplicateTeamNums.size > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-2xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-amber-500 text-base">⚠️</span>
                  <p className="text-[11px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest">
                    {duplicateTeamNums.size} team{duplicateTeamNums.size > 1 ? 's have' : ' has'} duplicate scouting entries
                  </p>
                </div>
                <button
                  onClick={handleMergeDuplicates}
                  className="shrink-0 px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest transition-all"
                >
                  Merge All
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {filteredPitScouts.map(ps => (
                <div
                  key={ps.id}
                  onClick={() => setSelectedRobot(ps)}
                  className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-5 md:p-6 hover:border-teamColor/30 transition-all cursor-pointer"
                >
                  {(() => {
                    const photo = fieldValue(ps, 'photoUrl');
                    return photo ? (
                      <div className="w-full h-32 rounded-xl overflow-hidden mb-3 bg-slate-100 dark:bg-slate-700">
                        <img src={photo} alt={`Team ${ps.teamNumber}`} className="w-full h-full object-cover" />
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-teamColor/10 text-teamColor rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0">
                        {ps.teamNumber}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate">{ps.teamName || `Team ${ps.teamNumber}`}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold truncate">
                          {observationCount(ps) > 0 ? (fieldValue(ps, 'drivetrain') || 'Pit scouted') : 'Not pit scouted yet'}
                        </p>
                      </div>
                    </div>
                  </div>
                  {observationCount(ps) > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {summaryFields(pitTemplate.fields, 6).filter(f => fieldValue(ps, f.key) !== undefined && fieldValue(ps, f.key) !== '').slice(0, 3).map(f => (
                        <span key={f.key} className="px-2 py-1 bg-teamColor/5 text-teamColor rounded-lg text-[9px] font-black truncate max-w-full" title={f.label}>
                          {f.label}: {formatValue(f, fieldValue(ps, f.key))}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="px-2 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-lg text-[9px] font-black">Needs pit scouting</span>
                  )}
                </div>
              ))}
            </div>

            {filteredPitScouts.length === 0 && (
              <div className="py-16 text-center">
                <Bot size={48} className="text-slate-200 mx-auto mb-4" />
                <p className="text-lg font-black text-slate-300 uppercase tracking-tight">No Robots Scouted</p>
                <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Start scouting to add robots</p>
              </div>
            )}
          </div>
        ) : activeTab === 'matches' ? (
          <div className="space-y-4">
            {(() => {
              const myId = parseInt(currentUser?.id);
              const myAssignments = assignments.filter(a => a.userId === myId);
              if (myAssignments.length === 0) return null;
              const sortedTbaQuals = tbaMatches
                .filter((m: any) => m.comp_level === 'qm')
                .sort((a: any, b: any) => (a.match_number || 0) - (b.match_number || 0));
              const nextUnplayed = sortedTbaQuals.find((m: any) => m.alliances?.red?.score === null || m.alliances?.red?.score === undefined || m.alliances?.red?.score === -1);
              const refMatchNum = nextUnplayed?.match_number ?? sortedTbaQuals[sortedTbaQuals.length - 1]?.match_number ?? 1;
              const myAssignment = myAssignments.find(a => a.fromMatch <= refMatchNum && a.toMatch >= refMatchNum) || myAssignments[0];
              if (!myAssignment) return null;
              const teammates = assignments.filter(a => a.userId !== myId && a.role === myAssignment.role && a.fromMatch <= myAssignment.toMatch && a.toMatch >= myAssignment.fromMatch);
              const badge = ROLE_COLORS[myAssignment.role] || 'bg-slate-100 text-slate-600';
              return (
                <div className={`rounded-2xl border-2 p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${myAssignment.role === 'Scout - Stands' ? 'border-teamColor/30 bg-teamColor/5' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Your Role</span>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${badge}`}>{myAssignment.role}</span>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Matches {myAssignment.fromMatch}–{myAssignment.toMatch}</span>
                    </div>
                    {myAssignment.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">{myAssignment.notes}</p>}
                    {teammates.length > 0 && (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 font-bold">
                        With: {teammates.map(t => t.userName).join(', ')}
                      </p>
                    )}
                  </div>
                  {myAssignment.role === 'Scout - Stands' && tbaMatches.length > 0 && (
                    <div className="text-[9px] font-black text-teamColor uppercase tracking-widest bg-teamColor/10 px-3 py-2 rounded-xl">
                      Scouting: M{myAssignment.fromMatch}–M{myAssignment.toMatch}
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="flex justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => setMatchViewMode('list')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${matchViewMode === 'list' ? 'bg-slate-900 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                >
                  <List size={14} /> List
                </button>
                <button
                  onClick={() => setMatchViewMode('roster')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${matchViewMode === 'roster' ? 'bg-slate-900 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200'}`}
                >
                  <Grid3X3 size={14} /> Roster
                </button>
                <button
                  onClick={handleMatchRefresh}
                  disabled={matchRefreshing}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-black rounded-xl text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-600 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={13} className={matchRefreshing ? 'animate-spin' : ''} />
                  {matchRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {!isGuest && (
                <button
                  onClick={() => { resetMatchForm(); setEditingMatch(null); setShowMatchForm(true); }}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase text-[10px] tracking-widest"
                >
                  <Plus size={16} /> Record Match
                </button>
              )}
            </div>

            {activeEvent?.eventCode && tbaLoading && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-8 text-center">
                <div className="w-6 h-6 border-2 border-teamColor border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Loading match schedule…</p>
              </div>
            )}

            {activeEvent?.eventCode && !tbaLoading && tbaMatches.length === 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-8 text-center space-y-3">
                <p className="text-sm font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">No schedule loaded yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                  The match schedule appears once FIRST posts it, usually the evening before qualifications. Try refreshing.
                </p>
                <button onClick={handleMatchRefresh} disabled={matchRefreshing}
                  className="mx-auto flex items-center gap-2 px-5 py-2.5 bg-teamColor text-white font-black rounded-xl text-[10px] uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50">
                  <RefreshCw size={13} className={matchRefreshing ? 'animate-spin' : ''} />
                  {matchRefreshing ? 'Refreshing…' : 'Refresh from FIRST'}
                </button>
              </div>
            )}

            {!activeEvent?.eventCode && isCoachOrCaptain && (
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No FIRST event code</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-medium mt-1">Open Event Settings and add the event's FIRST code to load the match schedule.</p>
              </div>
            )}

            {activeEvent?.eventCode && tbaMatches.length > 0 && (() => {
              const now = Math.floor(Date.now() / 1000);
              const isUnplayed = (m: any) => {
                const score = m.alliances?.red?.score;
                return score === null || score === undefined || score === -1;
              };
              const upcoming = tbaMatches
                .filter((m: any) => {
                  if (!isUnplayed(m)) return false;
                  const t = m.predicted_time || m.time;
                  if (t) return t > now - 3600;
                  return !m.actual_time;
                })
                .sort((a: any, b: any) => {
                  const ta = a.predicted_time || a.time || 0;
                  const tb = b.predicted_time || b.time || 0;
                  if (ta !== tb) return ta - tb;
                  return (a.match_number || 0) - (b.match_number || 0);
                });

              const renderNextMatchCard = (m: any, isOnDeck: boolean) => {
                if (!m) return null;
                const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                const compositeNum = isElim && m.set_number > 0 ? m.set_number * 10 + (m.match_number || 1) : (m.match_number || 1);
                const matchType = m.comp_level === 'pr' ? 'practice' : m.comp_level === 'qm' ? 'qualification' : 'elimination';
                const redKeys: string[] = m.alliances?.red?.team_keys || [];
                const blueKeys: string[] = m.alliances?.blue?.team_keys || [];
                const renderTeamBtn = (teamKey: string, alliance: 'Red' | 'Blue') => {
                  const teamNum = parseInt(teamKey.replace(/^ftc/, ''));
                  const isOurTeam = teamNum === teamNumber;
                  const alreadyScouted = matchScoutsData.some((ms: any) => ms.matchNumber === compositeNum && ms.matchType === matchType && ms.teamNumber === teamNum);
                  const claimKey = `${m.key}:${teamNum}`;
                  const claim = teamClaims[claimKey];
                  const isMe = claim?.userId === parseInt(currentUser?.id);
                  const isMineOpen = claim && isMe;
                  const isOthersClaim = claim && !isMe;

                  let btnClass = '';
                  let label: React.ReactNode = <span className="font-black text-sm">{teamNum}</span>;

                  if (alreadyScouted) {
                    btnClass = 'bg-green-100 dark:bg-green-900/40 border-2 border-green-400 text-green-700 dark:text-green-300 cursor-default opacity-80';
                    label = (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-black text-sm">{teamNum}</span>
                        <span className="text-[8px] font-black uppercase tracking-widest">✓ Done</span>
                      </div>
                    );
                  } else if (isOthersClaim) {
                    btnClass = 'bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 cursor-default opacity-75';
                    label = (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-black text-sm">{teamNum}</span>
                        <span className="text-[8px] font-bold truncate max-w-[60px]">📋 {claim.userName.split(' ')[0]}</span>
                      </div>
                    );
                  } else if (isMineOpen) {
                    btnClass = 'bg-amber-100 dark:bg-amber-900/40 border-2 border-amber-400 text-amber-800 dark:text-amber-200';
                    label = (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-black text-sm">{teamNum}</span>
                        <span className="text-[8px] font-black uppercase">📋 You</span>
                      </div>
                    );
                  } else if (isOurTeam) {
                    btnClass = alliance === 'Red'
                      ? 'bg-red-600 border-2 border-white text-white ring-2 ring-white/50 hover:bg-red-700'
                      : 'bg-blue-600 border-2 border-white text-white ring-2 ring-white/50 hover:bg-blue-700';
                  } else {
                    btnClass = alliance === 'Red'
                      ? 'bg-red-600 hover:bg-red-700 border-2 border-red-700 text-white hover:scale-105 active:scale-95'
                      : 'bg-blue-600 hover:bg-blue-700 border-2 border-blue-700 text-white hover:scale-105 active:scale-95';
                  }

                  const ourTeamRing = isOurTeam ? ' ring-2 ring-white ring-offset-1 ring-offset-transparent' : '';
                  if (isGuest) {
                    return (
                      <div
                        key={teamKey}
                        className={`px-3 py-2 rounded-xl text-center min-w-[64px] ${btnClass}${ourTeamRing} opacity-80 cursor-default`}
                      >
                        {label}
                      </div>
                    );
                  }
                  const canScout = !alreadyScouted && !isOthersClaim;
                  return (
                    <button
                      key={teamKey}
                      disabled={!canScout}
                      onClick={() => {
                        if (!canScout) return;
                        claimTeam(m.key, teamNum);
                        resetMatchForm();
                        setMatchForm((f: any) => ({ ...f, teamNumber: teamNum, matchNumber: compositeNum, matchType, alliance }));
                        setEditingMatch(null);
                        setShowMatchForm(true);
                      }}
                      className={`px-3 py-2 rounded-xl text-center transition-all min-w-[64px] ${btnClass}${ourTeamRing}`}
                    >
                      {label}
                    </button>
                  );
                };

                return (
                  <div key={m.key} className={`rounded-2xl border-2 p-4 ${isOnDeck ? 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60 opacity-80' : 'border-teamColor/30 bg-white dark:bg-slate-800 shadow-sm'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase text-white ${isOnDeck ? 'bg-slate-500' : 'bg-teamColor'}`}>
                          {isOnDeck ? 'On Deck' : 'Up Next'}
                        </span>
                        <span className="text-xs font-black text-slate-900 dark:text-white">{getMatchLabel(m)}</span>
                        {isElim && <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-purple-100 text-purple-700">Elim</span>}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black text-red-600 uppercase tracking-widest w-8">Red</span>
                        {redKeys.map(k => renderTeamBtn(k, 'Red'))}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest w-8">Blue</span>
                        {blueKeys.map(k => renderTeamBtn(k, 'Blue'))}
                      </div>
                    </div>
                  </div>
                );
              };

              const nextMatch = upcoming[0] || null;
              const onDeckMatch = upcoming[1] || null;

              const unscoutedMatches = tbaMatches.filter((m: any) => {
                const allTeamNums = [
                  ...(m.alliances?.red?.team_keys || []),
                  ...(m.alliances?.blue?.team_keys || []),
                ].map((k: string) => parseInt(k.replace(/^ftc/, '')));
                if (allTeamNums.length === 0) return false;
                const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                const compositeNum = isElim && m.set_number > 0
                  ? m.set_number * 10 + (m.match_number || 1)
                  : (m.match_number || 1);
                const matchType = m.comp_level === 'pr' ? 'practice' : m.comp_level === 'qm' ? 'qualification' : 'elimination';
                const scoutedTeamNums = new Set(
                  matchScoutsData
                    .filter((ms: any) => ms.matchNumber === compositeNum && ms.matchType === matchType)
                    .map((ms: any) => ms.teamNumber)
                );
                const unscoutedCount = allTeamNums.filter(n => !scoutedTeamNums.has(n)).length;
                return unscoutedCount > 0;
              }).sort((a: any, b: any) => (a.match_number || 0) - (b.match_number || 0));

              const allTBATeamNums = new Set(
                tbaMatches.flatMap((m: any) => [
                  ...(m.alliances?.red?.team_keys || []),
                  ...(m.alliances?.blue?.team_keys || []),
                ]).map((k: string) => parseInt(k.replace(/^ftc/, '')))
              );
              const pitScoutedNums = new Set(pitScouts.filter((p: any) => observationCount(p) > 0).map((p: any) => p.teamNumber));
              const unscoutedRobots = [...allTBATeamNums].filter(n => !pitScoutedNums.has(n)).sort((a, b) => a - b);

              const getMatchLabel = (m: any) => {
                const c = m.comp_level || 'qm', n = m.match_number || 0, s = m.set_number || 0;
                if (c === 'qm') return `Qual ${n}`;
                if (c === 'qf') return `QF ${s}-${n}`;
                if (c === 'sf') return `SF ${s}-${n}`;
                if (c === 'f') return `Final ${n}`;
                return `M${n}`;
              };

              return (
                <div className="space-y-4">
                  {(nextMatch || onDeckMatch) && (
                    <div className="space-y-2">
                      {nextMatch && renderNextMatchCard(nextMatch, false)}
                      {onDeckMatch && renderNextMatchCard(onDeckMatch, true)}
                    </div>
                  )}
                  {(unscoutedRobots.length > 0 || unscoutedMatches.length > 0) && (
                    <div className="space-y-4">
                      {unscoutedRobots.length > 0 && (
                        <div className="bg-rose-50 dark:bg-rose-900/30 rounded-2xl border-2 border-rose-200 dark:border-rose-700 p-5">
                          <h4 className="text-xs font-black text-rose-900 dark:text-rose-200 uppercase tracking-widest mb-1 flex items-center gap-2">
                            <AlertCircle size={14} className="text-rose-600 dark:text-rose-400" />
                            Unscouted Robots ({unscoutedRobots.length})
                          </h4>
                          <p className="text-[10px] text-rose-700 dark:text-rose-300 font-medium mb-3">These teams are on the event schedule but have no pit scout data. Visit their pit before they compete.</p>
                          <div className="flex flex-wrap gap-2">
                            {unscoutedRobots.map(n => (
                              <div key={n} className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-700 rounded-xl">
                                <span className="text-[10px] font-black text-rose-700">#{n}</span>
                                <a
                                  href={`https://ftc-events.firstinspires.org/${ftcSeasonFor(activeEvent?.startDate)}/team/${n}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[8px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-wide"
                                >FIRST</a>
                                {!isGuest && (
                                  <button
                                    onClick={() => { resetPitForm(); setEditingPit(null); setPitForm((f: any) => ({ ...f, teamNumber: n })); setShowPitForm(true); }}
                                    className="text-[8px] font-black text-rose-600 hover:text-rose-800 uppercase tracking-wide"
                                  >+ Scout</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {unscoutedMatches.length > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/30 rounded-2xl border-2 border-amber-200 dark:border-amber-700 p-5">
                          <h4 className="text-xs font-black text-amber-900 dark:text-amber-200 uppercase tracking-widest mb-1 flex items-center gap-2">
                            <AlertCircle size={14} className="text-amber-600 dark:text-amber-400" />
                            Unscouted Matches ({unscoutedMatches.length})
                          </h4>
                          <p className="text-[10px] text-amber-700 dark:text-amber-300 font-medium mb-3">Every match listed has at least one team with no match scout entry.</p>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {unscoutedMatches.map((m: any) => {
                              const allTeamNums = [...(m.alliances?.red?.team_keys || []), ...(m.alliances?.blue?.team_keys || [])].map((k: string) => parseInt(k.replace(/^ftc/, '')));
                              const _isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                              const _compositeNum = _isElim && m.set_number > 0 ? m.set_number * 10 + (m.match_number || 1) : (m.match_number || 1);
                              const _matchType = m.comp_level === 'pr' ? 'practice' : m.comp_level === 'qm' ? 'qualification' : 'elimination';
                              const scoutedNums = new Set(matchScoutsData.filter((ms: any) => ms.matchNumber === _compositeNum && ms.matchType === _matchType).map((ms: any) => ms.teamNumber));
                              const unscoutedTeams = allTeamNums.filter(n => !scoutedNums.has(n));
                              const youtubeLink = m.videos?.find((v: any) => v.type === 'youtube');
                              const isPast = (m.actual_time || m.time) && (m.actual_time || m.time) < Math.floor(Date.now() / 1000);
                              return (
                                <div key={m.key} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                                      <span className="px-2 py-1 bg-amber-600 text-white rounded-lg text-[9px] font-black uppercase">{getMatchLabel(m)}</span>
                                      {isPast && <span className="text-[7px] font-black text-slate-400 dark:text-slate-500 uppercase">Played</span>}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold text-slate-700 truncate">Missing: <span className="text-amber-700 font-black">{unscoutedTeams.join(', ')}</span></p>
                                      <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium hidden sm:block">
                                        🔴 {(m.alliances?.red?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(' ')} vs 🔵 {(m.alliances?.blue?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(' ')}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {youtubeLink && (
                                      <a href={`https://www.youtube.com/watch?v=${youtubeLink.key}`} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-1 px-2 py-1.5 bg-red-600 text-white rounded-lg text-[9px] font-black hover:bg-red-700 transition-all">
                                        <Video size={10} /> Watch
                                      </a>
                                    )}
                                    {!isGuest && (
                                      <button
                                        onClick={() => {
                                          resetMatchForm();
                                          const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                                          const matchNum = isElim && m.set_number > 0
                                            ? m.set_number * 10 + (m.match_number || 1)
                                            : (m.match_number || 1);
                                          const matchType = m.comp_level === 'pr' ? 'practice' : m.comp_level === 'qm' ? 'qualification' : 'elimination';
                                          setMatchForm(f => ({ ...f, matchNumber: matchNum, matchType }));
                                          setShowMatchForm(true);
                                        }}
                                        className="px-2 py-1.5 bg-slate-900 text-white rounded-lg text-[9px] font-black hover:bg-slate-800 transition-all"
                                      >Record</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(() => {
                    if (isGuest) return null;
                    const myId = parseInt(currentUser?.id);
                    const standAssignments = assignments.filter(a =>
                      a.userId === myId && a.role === 'Scout - Stands'
                    );
                    if (standAssignments.length === 0) return null;
                    const inAnyRange = (mn: number) => standAssignments.some(a => mn >= a.fromMatch && mn <= a.toMatch);
                    const rangeLabel = standAssignments.map(a => `M${a.fromMatch}–M${a.toMatch}`).join(', ');
                    const pitScoutedNums = new Set(pitScouts.map((ps: any) => ps.teamNumber));
                    const suggestedMatches = tbaMatches
                      .filter((m: any) => {
                        const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                        const isPractice = m.comp_level === 'pr';
                        if (isPractice) return false;
                        const mn = isElim ? 0 : m.match_number;
                        const inRange = isElim ? true : inAnyRange(mn);
                        const unplayed = m.alliances?.red?.score === null || m.alliances?.red?.score === undefined || m.alliances?.red?.score === -1;
                        const hasTeams = (m.alliances?.red?.team_keys?.length || 0) + (m.alliances?.blue?.team_keys?.length || 0) > 0;
                        return inRange && unplayed && hasTeams;
                      })
                      .sort((a: any, b: any) => {
                        const aElim = a.comp_level !== 'qm' ? 1 : 0;
                        const bElim = b.comp_level !== 'qm' ? 1 : 0;
                        if (aElim !== bElim) return aElim - bElim;
                        return (a.match_number || 0) - (b.match_number || 0);
                      });
                    const suggestedRobots = suggestedMatches.flatMap((m: any) => {
                      const redKeys: string[] = m.alliances?.red?.team_keys || [];
                      const blueKeys: string[] = m.alliances?.blue?.team_keys || [];
                      const ourAlliance = redKeys.includes(myTeamKey) ? 'red' : blueKeys.includes(myTeamKey) ? 'blue' : null;
                      const opponentKeys = ourAlliance === 'red' ? blueKeys : ourAlliance === 'blue' ? redKeys : [...redKeys, ...blueKeys];
                      const matchClaim = matchClaims[m.key];
                      const isClaimed = !!matchClaim;
                      const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                      const compositeNum = isElim && m.set_number > 0
                        ? m.set_number * 10 + (m.match_number || 1)
                        : (m.match_number || 1);
                      const matchType = m.comp_level === 'qm' ? 'qualification' : 'elimination';
                      return opponentKeys
                        .map((k: string) => parseInt(k.replace(/^ftc/, '')))
                        .filter(n => n !== teamNumber)
                        .filter(n => !pitScoutedNums.has(n))
                        .filter(n => !matchScoutsData.some((ms: any) => ms.matchNumber === compositeNum && ms.matchType === matchType && ms.teamNumber === n))
                        .map(n => ({
                          teamNumber: n,
                          matchNumber: compositeNum,
                          matchLabel: getMatchLabel(m),
                          matchKey: m.key,
                          isClaimed,
                          claimedBy: isClaimed ? matchClaim.userName : null,
                          alliance: redKeys.includes(`${teamKeyPrefix}${n}`) ? 'Red' : 'Blue',
                          isElim,
                        }));
                    });
                    if (suggestedRobots.length === 0) return null;
                    return (
                      <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-2xl p-5">
                        <h4 className="text-xs font-black text-red-700 dark:text-red-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Swords size={14} className="text-red-600" />
                          Your Scouting Targets ({rangeLabel})
                        </h4>
                        <div className="space-y-2">
                          {suggestedRobots.slice(0, 8).map((s, idx) => {
                            const robot = pitScouts.find((ps: any) => ps.teamNumber === s.teamNumber);
                            return (
                              <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-800 border border-red-200 dark:border-red-700">
                                <div className="flex items-center gap-3">
                                  <span className={`px-2 py-1 rounded-lg text-[9px] font-black text-white ${s.alliance === 'Red' ? 'bg-red-600' : 'bg-blue-600'}`}>{s.alliance}</span>
                                  {s.isElim && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-purple-100 text-purple-700">Elim</span>
                                  )}
                                  <div>
                                    <p className="text-xs font-black text-slate-900 dark:text-white">Team {s.teamNumber}{robot ? ` — ${robot.teamName}` : ''}</p>
                                    <p className="text-[9px] text-slate-400 font-bold">{s.matchLabel}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {s.isClaimed && (
                                    <span className="text-[9px] text-slate-400 font-bold hidden sm:block">Claimed by {s.claimedBy}</span>
                                  )}
                                  {!s.isClaimed && (
                                    <button
                                      onClick={() => claimMatch(s.matchKey)}
                                      className="px-3 py-1.5 bg-slate-800 dark:bg-slate-600 text-white rounded-lg text-[9px] font-black hover:bg-slate-700 transition-all"
                                    >Claim</button>
                                  )}
                                  <button
                                    onClick={() => {
                                      resetMatchForm();
                                      setMatchForm((f: any) => ({ ...f, teamNumber: s.teamNumber, matchNumber: s.matchNumber, matchType: s.isElim ? 'elimination' : 'qualification', alliance: s.alliance }));
                                      if (!s.isClaimed) claimMatch(s.matchKey);
                                      setEditingMatch(null);
                                      setShowMatchForm(true);
                                    }}
                                    className="px-3 py-1.5 bg-teamColor text-white rounded-lg text-[9px] font-black hover:opacity-90 transition-all"
                                  >Scout</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {!isGuest && upcoming.length > 0 && (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-5">
                      <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest mb-3 flex items-center gap-2">
                        <UserCheck size={14} className="text-green-600" />
                        Claim a Match to Scout
                      </h4>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mb-3">Tap a match to claim it for scouting so teammates know who's covering what.</p>
                      <div className="space-y-2">
                        {upcoming.slice(0, 8).map((m: any) => {
                          const claim = matchClaims[m.key];
                          const isMine = claim?.userId === parseInt(currentUser.id);
                          const allTeams = [...(m.alliances?.red?.team_keys || []), ...(m.alliances?.blue?.team_keys || [])].map((k: string) => parseInt(k.replace(/^ftc/, '')));
                          const time = m.predicted_time || m.time;
                          return (
                            <div key={m.key} className={`flex items-center justify-between p-3 rounded-xl border-2 ${isMine ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30' : claim ? 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700' : 'border-slate-100 dark:border-slate-600 bg-white dark:bg-slate-700 hover:border-teamColor/30 hover:bg-teamColor/5'} transition-all`}>
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="px-2 py-1 bg-slate-900 text-white rounded-lg text-[9px] font-black uppercase flex-shrink-0">{getMatchLabel(m)}</span>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold text-slate-600 truncate">
                                    🔴 {(m.alliances?.red?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(', ')} vs 🔵 {(m.alliances?.blue?.team_keys || []).map((k: string) => k.replace(/^ftc/, '')).join(', ')}
                                  </p>
                                  {claim && (
                                    <p className={`text-[9px] font-black ${isMine ? 'text-green-600' : 'text-slate-400'}`}>
                                      {isMine ? '✓ Claimed by you' : `Claimed by ${claim.userName}`}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {time && (
                                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold hidden sm:block">
                                    {fmtTime(time * 1000, { hour: 'numeric', minute: '2-digit' })}
                                  </span>
                                )}
                                {isMine ? (
                                  <button onClick={() => unclaimMatch(m.key)}
                                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-[9px] font-black hover:bg-green-700 transition-all">Unclaim</button>
                                ) : !claim ? (
                                  <button onClick={() => claimMatch(m.key)}
                                    className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[9px] font-black hover:bg-slate-800 transition-all">Claim</button>
                                ) : (
                                  <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 rounded-lg text-[9px] font-black">Taken</span>
                                )}
                                <button
                                  onClick={() => {
                                    resetMatchForm();
                                    const isElim = m.comp_level && m.comp_level !== 'qm' && m.comp_level !== 'pr';
                                    const matchNum = isElim && m.set_number > 0
                                      ? m.set_number * 10 + (m.match_number || 1)
                                      : (m.match_number || 1);
                                    const matchType = m.comp_level === 'pr' ? 'practice' : m.comp_level === 'qm' ? 'qualification' : 'elimination';
                                    setMatchForm(f => ({ ...f, matchNumber: matchNum, matchType }));
                                    setShowMatchForm(true);
                                  }}
                                  className="px-3 py-1.5 bg-teamColor text-white rounded-lg text-[9px] font-black hover:opacity-90 transition-all"
                                >Scout</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {matchViewMode === 'list' ? (
              <div className="space-y-3">
                {sortedMatches.map(m => (
                  <div
                    key={m.id}
                    className={`bg-white dark:bg-slate-800 rounded-2xl border-2 p-4 md:p-5 ${m.alliance === 'Red' ? 'border-red-200' : 'border-blue-200'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase ${
                            m.alliance === 'Red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                          }`}>
                            M{m.matchNumber}
                          </span>
                          {m.matchType && m.matchType !== 'qualification' && (
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                              m.matchType === 'practice' ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' : 'bg-purple-100 text-purple-700'
                            }`}>{m.matchType}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white">Team {m.teamNumber}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                            {summarizeRecord(m, matchTemplate.fields) || '—'}
                          </p>
                          {fieldValue(m, 'autoUsed') && <p className="text-[9px] text-blue-500 font-bold">Auto: {fieldValue(m, 'autoUsed')}</p>}
                          {isCoachOrCaptain && m.scoutedByName && (
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold mt-0.5">Scouted by <span className="text-slate-600 dark:text-slate-400">{m.scoutedByName}</span></p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isGuest && (
                          <div className="flex gap-1">
                            <button onClick={() => openEditMatch(m)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 transition-all text-slate-500 dark:text-slate-400 text-[10px] font-black">Edit</button>
                            <button onClick={() => handleDeleteMatchScout(m.id)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-red-50 transition-all text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {fieldValue(m, 'notes') && <p className="text-[10px] text-slate-500 mt-2 pl-12 font-medium">{fieldValue(m, 'notes')}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {matchRosters.map(roster => (
                  <div key={roster.matchNumber} className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 p-4 md:p-6">
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                      <Swords size={16} className="text-teamColor" />
                      Match {roster.matchNumber}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <span className="text-[9px] font-black text-red-600 uppercase tracking-widest">Red Alliance</span>
                        {roster.red.length > 0 ? roster.red.map(m => (
                          <div
                            key={m.id}
                            onClick={() => openRobotByNumber(m.teamNumber)}
                            className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/50 transition-all"
                          >
                            <p className="text-sm font-black text-slate-900 dark:text-white">Team {m.teamNumber}</p>
                            <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold truncate">{summarizeRecord(m, matchTemplate.fields, 2) || '—'}</p>
                          </div>
                        )) : (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold p-3">No robots scouted</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Blue Alliance</span>
                        {roster.blue.length > 0 ? roster.blue.map(m => (
                          <div
                            key={m.id}
                            onClick={() => openRobotByNumber(m.teamNumber)}
                            className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-xl cursor-pointer hover:bg-blue-100 transition-all"
                          >
                            <p className="text-sm font-black text-slate-900 dark:text-white">Team {m.teamNumber}</p>
                            <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold truncate">{summarizeRecord(m, matchTemplate.fields, 2) || '—'}</p>
                          </div>
                        )) : (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold p-3">No robots scouted</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sortedMatches.length === 0 && (
              <div className="py-8 text-center">
                <Swords size={48} className="text-slate-200 mx-auto mb-4" />
                <p className="text-lg font-black text-slate-300 uppercase tracking-tight">No Matches Recorded</p>
                <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Record match data to track performance</p>
              </div>
            )}

          </div>
        ) : activeTab === 'qr' ? (
          <ScoutQR
            matchScoutsData={matchScoutsData}
            pitScouts={pitScouts}
            selectedMatchIds={selectedMatchIds}
            setSelectedMatchIds={setSelectedMatchIds}
            selectedRobotIds={selectedRobotIds}
            setSelectedRobotIds={setSelectedRobotIds}
            qrData={qrData}
            qrChunkIndex={qrChunkIndex}
            setQrChunkIndex={setQrChunkIndex}
            onGenerateQR={generateQR}
            scanning={scanning}
            importPreview={importPreview}
            importResult={importResult}
            scannedChunks={scannedChunks}
            scannerContainerRef={scannerContainerRef}
            onStartScanner={startScanner}
            onStopScanner={stopScanner}
            onConfirmImport={confirmImport}
            setImportPreview={setImportPreview}
            setScannedChunks={setScannedChunks}
            setImportResult={setImportResult}
            isGuest={isGuest}
          />
        ) : activeTab === 'display' ? (
          <PitDisplay
            pitSubTab={pitSubTab}
            setPitSubTab={setPitSubTab}
            pitDisplayAlerts={pitDisplayAlerts}
            dismissedPitAlertIds={dismissedPitAlertIds}
            onDismissPitAlert={dismissPitAlert}
            onRefreshEventData={() => fetchFirstData(activeEvent)}
            matchTemplate={matchTemplate}
            tbaMatches={tbaMatches}
            tbaLoading={tbaLoading}
            tbaRecord={tbaRecord}
            tbaRankings={tbaRankings}
            pitScouts={pitScouts}
            matchScoutsData={matchScoutsData}
            activeEvent={activeEvent}
            isCoachOrCaptain={isCoachOrCaptain}
            onOpenRobotByNumber={openRobotByNumber}
            onSetSelectedRobot={setSelectedRobot}
            onGenerateGeminiReport={generateGeminiReport}
          />
        ) : activeTab === 'info' ? (
          <div className="space-y-6">
            {editingEventInfo ? (
              <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8 space-y-5">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Edit Event Info</h3>
                  <button onClick={() => setEditingEventInfo(false)} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"><X size={16} className="text-slate-500" /></button>
                </div>
                {[
                  { key: 'venueInfo', label: 'Venue Name & Address', placeholder: 'e.g. Salem Convention Center, 200 Commercial St NE' },
                  { key: 'wifiNetwork', label: 'Wi-Fi Network', placeholder: 'Network name' },
                  { key: 'wifiPassword', label: 'Wi-Fi Password', placeholder: 'Password' },
                  { key: 'parkingInfo', label: 'Parking Info', placeholder: 'Where to park, any fees, etc.' },
                  { key: 'schedule', label: 'Daily Schedule', placeholder: 'e.g. Day 1: 7am load-in, 9am practice...' },
                  { key: 'resources', label: 'Resources & Links', placeholder: 'Pit map URL, judging schedule, etc.' },
                  { key: 'notes', label: 'Notes', placeholder: 'Any other important info...' },
                ].map(field => (
                  <div key={field.key} className="space-y-2">
                    <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{field.label}</label>
                    <textarea
                      rows={field.key === 'schedule' || field.key === 'resources' || field.key === 'notes' ? 4 : 2}
                      value={(eventInfoForm as any)[field.key]}
                      onChange={e => setEventInfoForm({ ...eventInfoForm, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm resize-none dark:text-white dark:placeholder:text-slate-500"
                    />
                  </div>
                ))}
                <button
                  onClick={async () => {
                    if (!activeEvent) return;
                    try {
                      const saved = await api.eventInfo.update(activeEvent.id, { ...eventInfoForm, updatedBy: parseInt(currentUser.id) });
                      setEventInfoData(saved);
                      setEditingEventInfo(false);
                    } catch (err) {
                      console.error('Failed to save event info:', err);
                    }
                  }}
                  className="w-full py-4 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase tracking-widest text-xs"
                >Save Event Info</button>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 p-6 md:p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                    <MapPin size={18} className="text-teamColor" /> Event Info
                  </h3>
                  {isCoachOrCaptain && (
                    <button
                      onClick={() => {
                        setEventInfoForm({
                          venueInfo: eventInfoData?.venueInfo || '',
                          wifiNetwork: eventInfoData?.wifiNetwork || '',
                          wifiPassword: eventInfoData?.wifiPassword || '',
                          parkingInfo: eventInfoData?.parkingInfo || '',
                          schedule: eventInfoData?.schedule || '',
                          resources: eventInfoData?.resources || '',
                          notes: eventInfoData?.notes || '',
                        });
                        setEditingEventInfo(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
                    ><Settings size={13} /> Edit</button>
                  )}
                </div>
                {[
                  { key: 'venueInfo', label: 'Venue', icon: '📍' },
                  { key: 'wifiNetwork', label: 'Wi-Fi Network', icon: '📶' },
                  { key: 'wifiPassword', label: 'Wi-Fi Password', icon: '🔒' },
                  { key: 'parkingInfo', label: 'Parking', icon: '🅿️' },
                  { key: 'schedule', label: 'Daily Schedule', icon: '📅' },
                  { key: 'resources', label: 'Resources & Links', icon: '🔗' },
                  { key: 'notes', label: 'Notes', icon: '📝' },
                ].map(field => {
                  const val = eventInfoData?.[field.key];
                  if (!val && !isCoachOrCaptain) return null;
                  return (
                    <div key={field.key} className="mb-5 last:mb-0">
                      <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{field.icon} {field.label}</p>
                      {val ? (
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{val}</p>
                      ) : (
                        <p className="text-sm text-slate-300 dark:text-slate-600 italic">Not set</p>
                      )}
                    </div>
                  );
                })}
                {!eventInfoData?.venueInfo && !eventInfoData?.wifiNetwork && !eventInfoData?.schedule && !eventInfoData?.notes && (
                  <div className="py-10 text-center">
                    <MapPin size={40} className="text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                    <p className="text-sm font-black text-slate-300 dark:text-slate-600 uppercase tracking-tight">No Event Info Yet</p>
                    {isCoachOrCaptain && <p className="text-xs text-slate-400 mt-1">Click Edit to add venue details, Wi-Fi, parking info, and more.</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'schedule' ? (
          <div className="space-y-6">
            {isCoachOrCaptain && (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setAssignmentForm({ userId: 0, fromMatch: 1, toMatch: 10, role: 'Scout - Stands', notes: '' });
                    setEditingAssignment(null);
                    setShowAssignmentForm(true);
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase text-[10px] tracking-widest"
                ><Plus size={16} /> Add Assignment</button>
              </div>
            )}

            {assignmentsLoading ? (
              <div className="py-12 text-center text-slate-400 font-bold uppercase tracking-widest text-sm">Loading...</div>
            ) : (
              <>
                {(() => {
                  const qualNums = tbaMatches
                    .filter((m: any) => m.comp_level === 'qm')
                    .map((m: any) => m.match_number as number);
                  const totalFromTba = qualNums.length > 0 ? Math.max(...qualNums) : 0;
                  const totalFromAssign = assignments.length > 0 ? Math.max(...assignments.map((a: any) => a.toMatch as number)) : 0;
                  const totalMatches = Math.max(totalFromTba, totalFromAssign, 10);
                  const matchNums = Array.from({ length: totalMatches }, (_, i) => i + 1);

                  const byUser = new Map<number, { name: string; isMe: boolean; userAssigns: any[] }>();
                  for (const a of assignments) {
                    if (!byUser.has(a.userId)) {
                      byUser.set(a.userId, {
                        name: a.userName || `User ${a.userId}`,
                        isMe: a.userId === parseInt(currentUser?.id),
                        userAssigns: [],
                      });
                    }
                    byUser.get(a.userId)!.userAssigns.push(a);
                  }
                  const rows = Array.from(byUser.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

                  const CELL_BG: Record<string, string> = Object.fromEntries(
                    Object.entries(ROLE_CHIP_COLORS).map(([role, cls]) => [role, cls.split(' ')[0]])
                  );
                  // Build userId_matchNum → teamNumber lookup from teamClaims (active claims)
                  const claimByUserMatch = new Map<string, number>();
                  for (const [key, claim] of Object.entries(teamClaims)) {
                    const colonIdx = key.lastIndexOf(':');
                    if (colonIdx < 0) continue;
                    const matchKeyPart = key.substring(0, colonIdx);
                    const teamNum = parseInt(key.substring(colonIdx + 1));
                    const mMatch = matchKeyPart.match(/_qm(\d+)$/);
                    if (mMatch && !isNaN(teamNum)) {
                      claimByUserMatch.set(`${(claim as any).userId}_${mMatch[1]}`, teamNum);
                    }
                  }

                  // Build userId_matchNum → teamNumber lookup from submitted match scouts (permanent)
                  const scoutedByUserMatch = new Map<string, number>();
                  for (const ms of matchScoutsData) {
                    if (ms.scoutedBy && ms.matchNumber && ms.teamNumber) {
                      scoutedByUserMatch.set(`${ms.scoutedBy}_${ms.matchNumber}`, ms.teamNumber);
                    }
                  }

                  // Build set of qual match numbers where our team is competing
                  const ourMatchNums = new Set<number>();
                  for (const m of tbaMatches) {
                    if (m.comp_level !== 'qm') continue;
                    const redKeys: string[] = m.alliances?.red?.team_keys ?? [];
                    const blueKeys: string[] = m.alliances?.blue?.team_keys ?? [];
                    if (redKeys.includes(myTeamKey) || blueKeys.includes(myTeamKey)) {
                      ourMatchNums.add(m.match_number as number);
                    }
                  }

                  return (
                    <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[32px] border-2 border-slate-100 dark:border-slate-700 overflow-hidden">
                      <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                          <Grid3X3 size={15} className="text-teamColor" /> Match Schedule Grid
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {ASSIGNMENT_ROLES.map(role => (
                            <span key={role} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest text-white ${CELL_BG[role] || 'bg-slate-500'}`}>
                              {ROLE_ABBREV[role] || role}
                            </span>
                          ))}
                          <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-slate-400 text-white">Off</span>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="border-collapse" style={{ tableLayout: 'fixed', minWidth: `${140 + totalMatches * 22}px` }}>
                          <thead>
                            <tr className="border-b-2 border-slate-100 dark:border-slate-700">
                              <th
                                className="sticky left-0 z-10 bg-white dark:bg-slate-800 text-left pl-5 pr-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest border-r-2 border-slate-100 dark:border-slate-700"
                                style={{ width: 140, minWidth: 140 }}
                              >
                                Member
                              </th>
                              {matchNums.map(n => {
                                const isOur = ourMatchNums.has(n);
                                return (
                                  <th
                                    key={n}
                                    style={{ width: 22, minWidth: 22, ...(isOur ? { borderBottom: '2px solid var(--team-color)' } : {}) }}
                                    className={`text-center py-1 select-none overflow-hidden ${
                                      isOur
                                        ? 'text-teamColor font-black text-[7px] border-l-2 border-teamColor/20 bg-teamColor/10'
                                        : n % 10 === 0
                                        ? 'text-slate-600 dark:text-slate-300 font-black text-[7px] border-l-2 border-slate-200 dark:border-slate-600'
                                        : n % 5 === 0
                                        ? 'text-slate-500 dark:text-slate-400 font-bold text-[7px] border-l border-slate-100 dark:border-slate-700'
                                        : 'text-slate-400 dark:text-slate-600 font-semibold text-[6px] border-l border-slate-50 dark:border-slate-700/50'
                                    }`}
                                  >
                                    {n}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length > 0 && (
                              <tr className="border-b-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40">
                                <td
                                  style={{ width: 140, minWidth: 140 }}
                                  className="sticky left-0 z-10 pl-5 pr-3 py-1 text-[8px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest bg-slate-50 dark:bg-slate-700/40 border-r-2 border-slate-100 dark:border-slate-700 whitespace-nowrap"
                                >
                                  Scouts on duty
                                </td>
                                {matchNums.map(matchNum => {
                                  const count = rows.filter(([uid, { userAssigns }]) => {
                                    const a = userAssigns.find((ua: any) => matchNum >= ua.fromMatch && matchNum <= ua.toMatch);
                                    if (!a || a.role !== 'Scout - Stands') return false;
                                    return !matchExceptionsSet.has(`${uid}_${matchNum}`);
                                  }).length;
                                  const isTick10 = matchNum % 10 === 0;
                                  return (
                                    <td
                                      key={matchNum}
                                      style={{ width: 22, minWidth: 22 }}
                                      className={`text-center py-1 ${ourMatchNums.has(matchNum) ? 'bg-teamColor/5' : ''} ${isTick10 ? 'border-l-2 border-slate-200 dark:border-slate-600' : 'border-l border-slate-100 dark:border-slate-700/50'}`}
                                    >
                                      {(() => {
                                        const hasAnyScout = rows.some(([uid, { userAssigns }]) => {
                                          const a = userAssigns.find((ua: any) => matchNum >= ua.fromMatch && matchNum <= ua.toMatch);
                                          return !!a && a.role === 'Scout - Stands';
                                        });
                                        if (!hasAnyScout) return <span className="text-slate-200 dark:text-slate-700 text-[8px]">—</span>;
                                        if (count === 0) return <span className="text-[8px] font-black text-red-600 dark:text-red-400">0</span>;
                                        if (count === 1) return <span className="text-[8px] font-black text-amber-500 dark:text-amber-400">{count}</span>;
                                        return <span className="text-[8px] font-black text-green-600 dark:text-green-400">{count}</span>;
                                      })()}
                                    </td>
                                  );
                                })}
                              </tr>
                            )}
                            {rows.map(([userId, { name, isMe, userAssigns }]) => (
                              <tr
                                key={userId}
                                className={`border-b border-slate-50 dark:border-slate-700/40 ${isMe ? '' : 'hover:bg-slate-50/60 dark:hover:bg-slate-700/20'}`}
                              >
                                <td
                                  style={{ width: 140, minWidth: 140 }}
                                  className={`sticky left-0 z-10 pl-5 pr-3 py-1.5 text-xs font-bold whitespace-nowrap border-r-2 border-slate-100 dark:border-slate-700 ${
                                    isMe
                                      ? 'bg-teamColor/5 text-teamColor'
                                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {name}{isMe ? <span className="ml-1 text-teamColor text-[9px] opacity-70">you</span> : ''}
                                </td>
                                {matchNums.map(matchNum => {
                                  const a = userAssigns.find((ua: any) => matchNum >= ua.fromMatch && matchNum <= ua.toMatch);
                                  const isTick10 = matchNum % 10 === 0;
                                  const isTick5 = matchNum % 5 === 0;
                                  if (!a) {
                                    return (
                                      <td
                                        key={matchNum}
                                        style={{ width: 22, minWidth: 22 }}
                                        title={isCoachOrCaptain ? `Assign ${name} to match ${matchNum}` : undefined}
                                        className={`h-8 text-center ${ourMatchNums.has(matchNum) ? 'bg-teamColor/5' : ''} ${isTick10 ? 'border-l-2 border-slate-200 dark:border-slate-600' : isTick5 ? 'border-l border-slate-100 dark:border-slate-700' : 'border-l border-slate-50 dark:border-slate-700/30'} ${isCoachOrCaptain ? 'cursor-pointer hover:bg-teamColor/5' : ''}`}
                                        onClick={isCoachOrCaptain ? () => {
                                          setEditingAssignment(null);
                                          setAssignmentForm({ userId: userId as number, fromMatch: matchNum, toMatch: matchNum, role: 'Scout - Stands', notes: '' });
                                          setShowAssignmentForm(true);
                                        } : undefined}
                                      >
                                        <span className="text-slate-200 dark:text-slate-700 text-[9px] select-none">—</span>
                                      </td>
                                    );
                                  }
                                  const isFirst = matchNum === a.fromMatch;
                                  const isLast = matchNum === a.toMatch;
                                  const isOff = matchExceptionsSet.has(`${userId}_${matchNum}`);
                                  const completedTeam = a.role === 'Scout - Stands' ? scoutedByUserMatch.get(`${userId}_${matchNum}`) : undefined;
                                  const claimedTeam = a.role === 'Scout - Stands' ? (completedTeam ?? claimByUserMatch.get(`${userId}_${matchNum}`)) : undefined;
                                  const bg = isOff ? '' : (CELL_BG[a.role] || 'bg-slate-400');
                                  return (
                                    <td
                                      key={matchNum}
                                      style={{
                                        width: 22,
                                        minWidth: 22,
                                        ...(isOff ? { backgroundImage: 'repeating-linear-gradient(45deg,#94a3b8 0,#94a3b8 2px,#cbd5e1 2px,#cbd5e1 6px)' } : {}),
                                        ...(ourMatchNums.has(matchNum) && !isOff ? { boxShadow: 'inset 0 -2px 0 rgba(220,38,38,0.55)' } : {}),
                                      }}
                                      title={isOff ? `${name}: Off / Break (M${matchNum})` : `${name}: ${a.role} (M${a.fromMatch}–M${a.toMatch})${completedTeam ? ` · Scouted Team ${completedTeam}` : claimedTeam ? ` · Claiming Team ${claimedTeam}` : ''}${a.notes ? ` — ${a.notes}` : ''}`}
                                      className={`h-8 ${isOff ? 'opacity-80' : bg} ${isTick10 ? `border-l-2 ${isOff ? 'border-slate-400' : 'border-white/40'}` : `border-l ${isOff ? 'border-slate-400/50' : 'border-white/20'}`} ${isFirst && !isOff ? 'rounded-l' : ''} ${isLast && !isOff ? 'rounded-r' : ''} ${isCoachOrCaptain ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
                                      onClick={isCoachOrCaptain ? () => {
                                        setCellPopover({ userId: userId as number, matchNum, assign: a });
                                      } : undefined}
                                    >
                                      {isOff && matchNum === a.fromMatch && (
                                        <div className="w-full h-full flex items-center justify-center overflow-hidden">
                                          <span className="text-slate-600 dark:text-slate-400 text-[6px] font-black leading-none select-none">off</span>
                                        </div>
                                      )}
                                      {!isOff && isFirst && (
                                        <div className="w-full h-full flex items-center justify-center overflow-hidden">
                                          {claimedTeam ? (
                                            <span className="text-white text-[6px] font-black leading-none select-none px-px">{claimedTeam}</span>
                                          ) : (
                                            <span className="text-white text-[6px] font-black leading-none select-none truncate px-px">
                                              {ROLE_ABBREV[a.role] ?? a.role}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      {!isOff && !isFirst && claimedTeam && (
                                        <div className="w-full h-full flex items-center justify-center overflow-hidden">
                                          <span className="text-white/80 text-[5px] font-black leading-none select-none px-px">{claimedTeam}</span>
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                            {rows.length === 0 && (
                              <tr>
                                <td
                                  colSpan={totalMatches + 1}
                                  className="py-10 text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest"
                                >
                                  No assigned members yet{isCoachOrCaptain ? ' — use "Add Assignment" to get started' : ''}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="px-5 py-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">
                          {totalMatches} matches · {rows.length} members{isCoachOrCaptain ? ' · click cell to assign/off' : ''}
                        </span>
                        <span className="text-[8px] text-slate-400 font-bold">
                          tick marks every 5 / bold every 10
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {assignments.length > 0 && <div className="space-y-3">
                  <button
                    onClick={() => setShowAssignmentList(v => !v)}
                    className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    <ChevronRight size={13} className={`transition-transform duration-200 ${showAssignmentList ? 'rotate-90' : ''}`} />
                    {showAssignmentList ? 'Hide list' : 'Show assignments list'} ({assignments.length})
                  </button>
                  {showAssignmentList && (
                    <div className="space-y-3">
                      {assignments.map(a => {
                        const badge = ROLE_COLORS[a.role] || 'bg-slate-100 text-slate-600';
                        const isMe = a.userId === parseInt(currentUser?.id);
                        return (
                          <div key={a.id} className={`bg-white dark:bg-slate-800 rounded-2xl border-2 ${isMe ? 'border-teamColor/40' : 'border-slate-100 dark:border-slate-700'} p-5 flex items-center gap-4`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <p className="text-sm font-black text-slate-900 dark:text-white">{a.userName}{isMe ? ' (you)' : ''}</p>
                                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${badge}`}>{a.role}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-bold">Matches {a.fromMatch}–{a.toMatch}</p>
                              {a.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{a.notes}</p>}
                            </div>
                            {isCoachOrCaptain && (
                              <div className="flex gap-2 flex-shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingAssignment(a);
                                    setAssignmentForm({ userId: a.userId, fromMatch: a.fromMatch, toMatch: a.toMatch, role: a.role, notes: a.notes || '' });
                                    setShowAssignmentForm(true);
                                  }}
                                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 transition-all"
                                ><Settings size={14} className="text-slate-500" /></button>
                                <button
                                  onClick={async () => {
                                    if (!confirm('Delete this assignment?')) return;
                                    try {
                                      await api.competitionAssignments.delete(activeEvent.id, a.id, parseInt(currentUser.id));
                                      fetchAssignments(activeEvent.id);
                                    } catch (err) { console.error('Failed to delete assignment:', err); }
                                  }}
                                  className="p-2 rounded-xl bg-red-50 dark:bg-red-900/30 hover:bg-red-100 transition-all"
                                ><Trash2 size={14} className="text-red-500" /></button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>}
              </>
            )}

            {cellPopover && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[115] flex items-center justify-center p-4" onClick={() => setCellPopover(null)}>
                <div className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-100 dark:border-slate-700 shadow-2xl p-5 w-72" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-sm font-black text-slate-900 dark:text-white">
                      Match {cellPopover.matchNum}
                      {(() => {
                        const u = allUsers.find((u: any) => u.id === cellPopover.userId);
                        return u ? <span className="text-slate-400 font-bold"> · {u.name || u.username}</span> : null;
                      })()}
                    </span>
                    <button onClick={() => setCellPopover(null)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><X size={14} className="text-slate-400" /></button>
                  </div>
                  <div className="space-y-2">
                    {matchExceptionsSet.has(`${cellPopover.userId}_${cellPopover.matchNum}`) ? (
                      <button
                        className="w-full px-4 py-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-xl text-sm font-black hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors text-left"
                        onClick={async () => {
                          if (!activeEvent || !currentUser) return;
                          try {
                            await api.matchExceptions.delete(activeEvent.id, cellPopover.userId, cellPopover.matchNum, parseInt(currentUser.id));
                            setMatchExceptionsSet(prev => { const next = new Set(prev); next.delete(`${cellPopover.userId}_${cellPopover.matchNum}`); return next; });
                          } catch (err) { console.error('Failed to remove off mark:', err); }
                          setCellPopover(null);
                        }}
                      >
                        ✓ Remove Off / Break Mark
                      </button>
                    ) : (
                      <button
                        className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-black hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-left"
                        onClick={async () => {
                          if (!activeEvent || !currentUser) return;
                          try {
                            await api.matchExceptions.upsert(activeEvent.id, { userId: cellPopover.userId, matchNumber: cellPopover.matchNum, type: 'off', createdBy: parseInt(currentUser.id) });
                            setMatchExceptionsSet(prev => new Set(prev).add(`${cellPopover.userId}_${cellPopover.matchNum}`));
                          } catch (err) { console.error('Failed to mark off:', err); }
                          setCellPopover(null);
                        }}
                      >
                        Mark Off / Break
                      </button>
                    )}
                    <button
                      className="w-full px-4 py-3 bg-teamColor/5 text-teamColor rounded-xl text-sm font-black hover:bg-teamColor/10 transition-colors text-left"
                      onClick={() => {
                        setEditingAssignment(cellPopover.assign);
                        setAssignmentForm({ userId: cellPopover.assign.userId, fromMatch: cellPopover.assign.fromMatch, toMatch: cellPopover.assign.toMatch, role: cellPopover.assign.role, notes: cellPopover.assign.notes || '' });
                        setCellPopover(null);
                        setShowAssignmentForm(true);
                      }}
                    >
                      Edit Assignment Range
                    </button>
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Change Role</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ASSIGNMENT_ROLES.map(role => {
                          const isCurrent = cellPopover.assign.role === role;
                          const chipCls = ROLE_CHIP_COLORS[role] || 'bg-slate-500 text-white';
                          return (
                            <button
                              key={role}
                              disabled={isCurrent}
                              className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                isCurrent
                                  ? `${chipCls} ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600 cursor-default`
                                  : `${chipCls} opacity-35 hover:opacity-90 cursor-pointer`
                              }`}
                              onClick={async () => {
                                if (!activeEvent || !currentUser || isCurrent) return;
                                try {
                                  await api.competitionAssignments.update(activeEvent.id, cellPopover.assign.id, {
                                    ...cellPopover.assign,
                                    role,
                                    createdBy: parseInt(currentUser.id),
                                  });
                                  fetchAssignments(activeEvent.id);
                                } catch (err) {
                                  console.error('Failed to update role:', err);
                                }
                                setCellPopover(null);
                              }}
                            >
                              {ROLE_ABBREV[role] ?? role}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showAssignmentForm && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
                <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-md max-h-[90vh] overflow-auto p-6 md:p-10 shadow-2xl border-t-8 border-teamColor">
                  <div className="flex justify-between items-start mb-6">
                    <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">{editingAssignment ? 'Edit Assignment' : 'Add Assignment'}</h2>
                    <button onClick={() => { setShowAssignmentForm(false); setEditingAssignment(null); }} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700"><X size={18} className="text-slate-500" /></button>
                  </div>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Team Member</label>
                      <select
                        value={assignmentForm.userId}
                        onChange={e => setAssignmentForm({ ...assignmentForm, userId: parseInt(e.target.value) })}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white"
                      >
                        <option value={0}>Select member...</option>
                        {allUsers.map(u => (
                          <option key={u.id} value={u.id}>{u.name || u.username}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">From Match #</label>
                        <input type="number" min={1} value={assignmentForm.fromMatch}
                          onChange={e => setAssignmentForm({ ...assignmentForm, fromMatch: parseInt(e.target.value) || 1 })}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white" />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">To Match #</label>
                        <input type="number" min={1} value={assignmentForm.toMatch}
                          onChange={e => setAssignmentForm({ ...assignmentForm, toMatch: parseInt(e.target.value) || 1 })}
                          className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Role</label>
                      <select
                        value={assignmentForm.role}
                        onChange={e => setAssignmentForm({ ...assignmentForm, role: e.target.value })}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm dark:text-white"
                      >
                        {ASSIGNMENT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Notes (optional)</label>
                      <textarea rows={2} value={assignmentForm.notes}
                        onChange={e => setAssignmentForm({ ...assignmentForm, notes: e.target.value })}
                        placeholder="Any specific instructions..."
                        className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm resize-none dark:text-white dark:placeholder:text-slate-500" />
                    </div>
                    <button
                      disabled={!assignmentForm.userId || assignmentForm.fromMatch < 1 || assignmentForm.toMatch < assignmentForm.fromMatch}
                      onClick={async () => {
                        if (!activeEvent || !assignmentForm.userId) return;
                        try {
                          const payload = { ...assignmentForm, createdBy: parseInt(currentUser.id) };
                          if (editingAssignment) {
                            await api.competitionAssignments.update(activeEvent.id, editingAssignment.id, payload);
                          } else {
                            await api.competitionAssignments.create(activeEvent.id, payload);
                          }
                          setShowAssignmentForm(false);
                          setEditingAssignment(null);
                          fetchAssignments(activeEvent.id);
                        } catch (err) { console.error('Failed to save assignment:', err); }
                      }}
                      className="w-full py-4 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg shadow-teamColor/20 transition-all uppercase tracking-widest text-xs disabled:opacity-50"
                    >{editingAssignment ? 'Update Assignment' : 'Create Assignment'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DynamicScoutForm
          show={showPitForm}
          title={editingPit ? 'Edit Robot' : 'Scout Robot'}
          subtitle={pitTemplate.name || 'Pit scouting form'}
          fields={pitTemplate.fields}
          form={pitForm}
          setForm={setPitForm as any}
          onClose={() => { setShowPitForm(false); setEditingPit(null); }}
          onSave={handleSavePitScout}
          editing={!!editingPit}
          saveLabel={editingPit ? 'Update' : 'Save Scout'}
          compressImage={compressImage}
        />

        <DynamicScoutForm
          show={showMatchForm}
          title={editingMatch ? 'Edit Match' : 'Record Match'}
          subtitle={matchTemplate.name || 'Match scouting form'}
          fields={matchTemplate.fields}
          form={matchForm}
          setForm={setMatchForm as any}
          onClose={() => {
            if (activeTeamClaimRef.current) unclaimTeam(activeTeamClaimRef.current.matchKey, activeTeamClaimRef.current.teamNumber);
            setShowMatchForm(false); setEditingMatch(null);
          }}
          onSave={handleSaveMatchScout}
          editing={!!editingMatch}
          saveLabel={editingMatch ? 'Update Match' : 'Save Match'}
          pitScouts={pitScouts}
        />

        {showEventSettings && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 rounded-2xl md:rounded-[40px] w-full max-w-xl p-6 md:p-10 shadow-2xl border-t-8 border-teamColor">
              <div className="flex justify-between items-start mb-6 md:mb-8">
                <div>
                  <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">Event Settings</h2>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">{activeEvent?.name}</p>
                </div>
                <button onClick={() => { setShowEventSettings(false); setEventSettingsSaveError(null); }} className="p-2 bg-slate-50 dark:bg-slate-700 text-slate-400 dark:text-slate-500 hover:text-red-600 rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="block text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">FIRST Event Code</label>
                  <input value={eventSettingsForm.eventCode} onChange={(e) => setEventSettingsForm({ eventCode: e.target.value })}
                    placeholder="e.g. USCAFFFAQ"
                    className="w-full p-4 bg-slate-50 dark:bg-slate-700 border-2 border-slate-100 dark:border-slate-600 rounded-xl outline-none focus:border-teamColor transition-all font-bold text-sm uppercase dark:text-white" />
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
                    Loads the schedule, results and rankings from FIRST. Events imported with "Import FTC Event" already have this set.
                  </p>
                </div>
                {activeEvent?.calendarEventId ? (
                  <p className="text-[10px] font-bold text-green-600 dark:text-green-400 flex items-center gap-1.5">
                    <Calendar size={12} /> Linked to its calendar event — attendance is taken there.
                  </p>
                ) : (
                  <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertCircle size={12} /> Not linked to a calendar event. Re-import it from FIRST to link one.
                  </p>
                )}
                {eventSettingsSaveError && (
                  <p className="text-xs font-bold text-red-600 flex items-center gap-1.5">
                    <AlertCircle size={13} /> {eventSettingsSaveError}
                  </p>
                )}
                <button onClick={handleSaveEventSettings}
                  className="w-full py-4 bg-teamColor text-white font-black rounded-xl hover:opacity-90 shadow-lg transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2">
                  <Check size={16} /> Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {geminiModal.open && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-end sm:items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-blue-600 rounded-xl flex items-center justify-center">
                    <Brain size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="font-black text-slate-900 dark:text-white text-sm">{geminiModal.matchLabel.startsWith('Team') ? 'Team Scouting Report' : 'AI Match Analysis'}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">{geminiModal.matchLabel}</p>
                  </div>
                </div>
                <button onClick={() => setGeminiModal({ open: false, text: '', matchLabel: '' })} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-all">
                  <X size={20} className="text-slate-400 dark:text-slate-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="bg-slate-50 dark:bg-slate-700 rounded-2xl p-4">
                  <pre className="text-xs text-slate-700 dark:text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{geminiModal.text}</pre>
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 dark:border-slate-700 space-y-3">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold text-center">Copy this prompt and paste it into Google Gemini or ChatGPT for analysis</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(geminiModal.text).then(() => {
                        setCopiedGemini(true);
                        setTimeout(() => setCopiedGemini(false), 2000);
                      });
                    }}
                    className={`flex-1 py-3 font-black rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${
                      copiedGemini ? 'bg-green-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                  >
                    {copiedGemini ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy to Clipboard</>}
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([geminiModal.text], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${geminiModal.matchLabel.replace(/\s+/g, '_')}_scout_report.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="px-4 py-3 bg-slate-100 text-slate-700 dark:text-slate-300 font-black rounded-xl hover:bg-slate-200 transition-all"
                  >
                    <Download size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400 dark:text-slate-500">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-teamColor border-t-transparent" />
        <p className="text-sm font-bold uppercase tracking-widest">Connecting to event…</p>
      </div>
    );
  }

  return (
    <>
    <ScoutEventList
      events={eventSeasonFilter === 'all' ? events : events.filter((e: any) => e.seasonId === eventSeasonFilter)}
      isCoachOrCaptain={isCoachOrCaptain}
      eventCounts={eventCounts}
      showEventForm={showEventForm}
      eventForm={eventForm}
      setEventForm={setEventForm}
      seasons={seasons}
      onManageSeasons={() => setShowSeasonManager(true)}
      seasonFilter={eventSeasonFilter}
      onSeasonFilterChange={setEventSeasonFilter}
      geminiModal={geminiModal}
      copiedGemini={copiedGemini}
      onCreateEvent={() => {
        const active = seasons.find((s: any) => s.active) || seasons[0];
        setEventForm((f: any) => ({ ...f, seasonId: f.seasonId ?? active?.id }));
        setShowEventForm(true);
      }}
      onImportFirst={() => setShowImportModal(true)}
      onEnterEvent={enterEvent}
      onDeleteEvent={handleDeleteEvent}
      onCreateEventSubmit={handleCreateEvent}
      onCloseEventForm={() => setShowEventForm(false)}
      onSetGeminiModal={setGeminiModal}
      onSetCopiedGemini={setCopiedGemini}
    />
    {showImportModal && (
      <FirstEventImportModal
        onClose={() => setShowImportModal(false)}
        onImported={() => fetchEvents()}
        importedCodes={new Set(events.map((e: any) => e.eventCode).filter(Boolean))}
      />
    )}
    {showSeasonManager && (
      <SeasonManager
        onClose={() => setShowSeasonManager(false)}
        onChanged={() => { fetchSeasons(); fetchEvents(); }}
      />
    )}
    </>
  );

};

export default Scout;
