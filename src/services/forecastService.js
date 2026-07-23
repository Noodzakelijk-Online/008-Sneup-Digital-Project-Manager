const mongoose = require('mongoose');
const Board = require('../models/Board');
const Card = require('../models/Card');
const Member = require('../models/Member');
const Performance = require('../models/Performance');
const CapacityProfile = require('../models/CapacityProfile');
const WorkSignal = require('../models/WorkSignal');
const { normalizeWorkspaceObjectId } = require('./workspaceScopeService');

const DEFAULT_WEEKLY_HOURS = 32;
const DEFAULT_FOCUS_HOURS = 4;
const DEFAULT_CARD_HOURS = 6;
const MAX_FORECAST_CARDS = 1000;
const MAX_UTILIZATION_SIGNALS = 2000;
const MAX_ALLOCATION_SIGNALS = 2000;
const MAX_CALENDAR_SIGNALS = 2000;
const UTILIZATION_WINDOW_DAYS = 28;
const ALLOCATION_WINDOW_DAYS = 28;
const CALENDAR_WINDOW_DAYS = 28;
const TIME_TRACKING_PROVIDERS = ['harvest', 'everhour', 'timeneye', 'toggl_track', 'clockify'];
const RESOURCING_PROVIDERS = ['float', 'resource_guru', 'motion'];
const CALENDAR_PROVIDERS = ['google_workspace', 'microsoft_365'];
const MAX_CALENDAR_EVENT_HOURS = 12;

const asId = (value) => value?._id ? String(value._id) : value ? String(value) : '';
const round = (value, precision = 1) => Number(Number(value || 0).toFixed(precision));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const businessDaysBetween = (start, end) => {
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const target = new Date(end);
  target.setHours(0, 0, 0, 0);
  let days = 0;
  while (cursor <= target) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

const addBusinessDays = (date, days) => {
  const target = new Date(date);
  target.setHours(12, 0, 0, 0);
  let remaining = Math.max(0, Math.ceil(days));
  while (remaining > 0) {
    target.setDate(target.getDate() + 1);
    if (target.getDay() !== 0 && target.getDay() !== 6) remaining -= 1;
  }
  return target;
};

const profileForMember = (member, profilesByMember = new Map()) => {
  const profile = profilesByMember.get(asId(member)) || {};
  const weeklyHours = clamp(Number(profile.weeklyHours || DEFAULT_WEEKLY_HOURS), 1, 80);
  const allocationPercent = clamp(Number(profile.allocationPercent ?? 100), 0, 100);
  const focusHoursPerWeek = clamp(Number(profile.focusHoursPerWeek ?? DEFAULT_FOCUS_HOURS), 0, weeklyHours);
  return {
    profileId: profile._id ? asId(profile) : null,
    configured: Boolean(profile._id) || profile.scenarioOverride === true,
    weeklyHours,
    allocationPercent,
    focusHoursPerWeek,
    timeOff: Array.isArray(profile.timeOff) ? profile.timeOff : [],
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    externalIdentities: Array.isArray(profile.externalIdentities) ? profile.externalIdentities : [],
    active: profile.active !== false
  };
};

// Scenario inputs are kept in the request path only. They never update a CapacityProfile.
const applyScenarioOverrides = (profiles = [], members = [], overrides = []) => {
  if (!Array.isArray(overrides) || overrides.length === 0) return profiles;
  const memberIds = new Set(members.map(asId));
  const overridesByMember = new Map(overrides
    .filter((override) => memberIds.has(String(override?.memberId || '')))
    .map((override) => [String(override.memberId), override]));
  if (overridesByMember.size === 0) return profiles;

  const profileByMember = new Map(profiles.map((profile) => [asId(profile.memberId), profile]));
  return members.map((member) => {
    const memberId = asId(member);
    const override = overridesByMember.get(memberId);
    const existing = profileByMember.get(memberId);
    if (!override) return existing || { memberId };
    const base = existing?.toObject ? existing.toObject() : (existing || { memberId });
    return {
      ...base,
      memberId,
      ...(override.weeklyHours === undefined ? {} : { weeklyHours: override.weeklyHours }),
      ...(override.allocationPercent === undefined ? {} : { allocationPercent: override.allocationPercent }),
      ...(override.focusHoursPerWeek === undefined ? {} : { focusHoursPerWeek: override.focusHoursPerWeek }),
      ...(override.timeOff === undefined ? {} : { timeOff: override.timeOff }),
      scenarioOverride: true
    };
  });
};

const timeOffHoursInWindow = (profile, now, horizonDays = 60) => {
  const windowEnd = addBusinessDays(now, horizonDays);
  const dailyHours = profile.weeklyHours * (profile.allocationPercent / 100) / 5;
  return (profile.timeOff || []).reduce((total, entry) => {
    const start = new Date(entry.startDate);
    const end = new Date(entry.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return total;
    const overlapStart = start > now ? start : now;
    const overlapEnd = end < windowEnd ? end : windowEnd;
    if (overlapEnd < overlapStart) return total;
    return total + businessDaysBetween(overlapStart, overlapEnd) * dailyHours;
  }, 0);
};

const cardMultiplier = (card, now) => {
  let multiplier = 1;
  if (!card.members || card.members.length === 0) multiplier += 0.2;
  if (['high', 'critical'].includes(card.riskLevel)) multiplier += card.riskLevel === 'critical' ? 0.35 : 0.2;
  if (card.due && new Date(card.due) < now && !card.dueComplete) multiplier += 0.15;
  if (Number(card.timeInCurrentList || 0) > 72) multiplier += 0.1;
  return multiplier;
};

const historicalHoursForMember = (member) => {
  // Member.averageCompletionTime is normalized in hours; Performance.averageCycleTime is stored in days.
  const memberHours = Number(member.averageCompletionTime || 0);
  return memberHours > 0 && memberHours <= 160 ? memberHours : null;
};

const identityKey = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const providerNameList = (providers = []) => {
  const names = providers
    .map((provider) => ({ harvest: 'Harvest', everhour: 'Everhour', timeneye: 'Lucen Track', toggl_track: 'Toggl Track', clockify: 'Clockify' }[provider] || provider));
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
};

const resourceIdentityKey = (provider, externalId) => `${String(provider || '').trim().toLowerCase()}:${String(externalId || '').trim()}`;

const trackedHoursFor = (raw = {}) => {
  const directHours = Number(raw.hours);
  if (Number.isFinite(directHours) && directHours >= 0 && directHours <= 10000) return directHours;
  const durationSeconds = Number(raw.durationSeconds);
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 && durationSeconds <= 36000000 ? durationSeconds / 3600 : undefined;
};

const utilizationSummary = ({ signals = [], members = [], profilesByMember = new Map(), now = new Date(), truncated = false }) => {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - UTILIZATION_WINDOW_DAYS);
  const memberIdByIdentity = new Map();
  const memberIdByExternalIdentity = new Map();
  const duplicateExternalIdentities = new Set();
  members.forEach((member) => {
    [member.fullName, member.username].map(identityKey).filter(Boolean).forEach((key) => {
      if (!memberIdByIdentity.has(key)) memberIdByIdentity.set(key, asId(member));
    });
    profileForMember(member, profilesByMember).externalIdentities.forEach((identity) => {
      const provider = String(identity?.provider || '').toLowerCase();
      const externalId = String(identity?.externalId || '').trim();
      if (!TIME_TRACKING_PROVIDERS.includes(provider) || !externalId) return;
      const key = resourceIdentityKey(provider, externalId);
      if (memberIdByExternalIdentity.has(key)) duplicateExternalIdentities.add(key);
      else memberIdByExternalIdentity.set(key, asId(member));
    });
  });

  const byMember = new Map();
  let entries = 0;
  let totalHours = 0;
  let matchedEntries = 0;
  let unmatchedEntries = 0;
  let unmatchedHours = 0;
  const providerSummaries = new Map();
  signals.forEach((signal) => {
    const provider = String(signal?.provider || 'harvest').toLowerCase();
    const raw = signal?.raw || {};
    const spentAt = new Date(raw.spentDate || signal.providerCreatedAt || '');
    const hours = trackedHoursFor(raw);
    if (!TIME_TRACKING_PROVIDERS.includes(provider)
      || !Number.isFinite(hours) || hours <= 0 || Number.isNaN(spentAt.getTime()) || spentAt < cutoff || spentAt > now) return;
    const providerSummary = providerSummaries.get(provider) || {
      entries: 0, hours: 0, matchedEntries: 0, matchedHours: 0, unmatchedEntries: 0, unmatchedHours: 0, members: new Set()
    };
    entries += 1;
    totalHours += hours;
    providerSummary.entries += 1;
    providerSummary.hours += hours;
    const externalIdentity = resourceIdentityKey(provider, raw.userId ?? raw.user?.id);
    const mappedMemberId = duplicateExternalIdentities.has(externalIdentity)
      ? undefined
      : memberIdByExternalIdentity.get(externalIdentity);
    const memberId = mappedMemberId || memberIdByIdentity.get(identityKey(raw.user?.name || signal.owners?.[0]));
    if (!memberId) {
      unmatchedEntries += 1;
      unmatchedHours += hours;
      providerSummary.unmatchedEntries += 1;
      providerSummary.unmatchedHours += hours;
      providerSummaries.set(provider, providerSummary);
      return;
    }
    matchedEntries += 1;
    providerSummary.matchedEntries += 1;
    providerSummary.matchedHours += hours;
    providerSummary.members.add(memberId);
    const current = byMember.get(memberId) || { entries: 0, hours: 0, providers: {} };
    current.entries += 1;
    current.hours += hours;
    const memberProvider = current.providers[provider] || { entries: 0, hours: 0 };
    memberProvider.entries += 1;
    memberProvider.hours += hours;
    current.providers[provider] = memberProvider;
    byMember.set(memberId, current);
    providerSummaries.set(provider, providerSummary);
  });

  const activeProviders = TIME_TRACKING_PROVIDERS.filter((provider) => providerSummaries.get(provider)?.entries > 0);
  const providerEvidence = Object.fromEntries(TIME_TRACKING_PROVIDERS.map((provider) => {
    const summary = providerSummaries.get(provider) || {
      entries: 0, hours: 0, matchedEntries: 0, matchedHours: 0, unmatchedEntries: 0, unmatchedHours: 0, members: new Set()
    };
    return [provider, {
      entries: summary.entries,
      hours: round(summary.hours),
      weeklyHours: round(summary.hours / (UTILIZATION_WINDOW_DAYS / 7)),
      matchedEntries: summary.matchedEntries,
      matchedHours: round(summary.matchedHours),
      unmatchedEntries: summary.unmatchedEntries,
      unmatchedHours: round(summary.unmatchedHours),
      matchedMembers: summary.members.size
    }];
  }));

  return {
    provider: activeProviders.length === 1 ? activeProviders[0] : activeProviders.length > 1 ? 'multi_provider' : null,
    providers: TIME_TRACKING_PROVIDERS,
    activeProviders,
    providerLabel: providerNameList(activeProviders),
    providerEvidence,
    windowDays: UTILIZATION_WINDOW_DAYS,
    recordsRead: signals.length,
    entries,
    totalHours: round(totalHours),
    weeklyHours: round(totalHours / (UTILIZATION_WINDOW_DAYS / 7)),
    matchedEntries,
    unmatchedEntries,
    unmatchedHours: round(unmatchedHours),
    matchedMembers: byMember.size,
    truncated,
    byMember
  };
};

const allocationSummary = ({ signals = [], boards = [], members = [], profilesByMember = new Map(), now = new Date(), truncated = false }) => {
  const windowEnd = new Date(now);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + ALLOCATION_WINDOW_DAYS);
  const memberIdByIdentity = new Map();
  const duplicateIdentities = new Set();
  members.forEach((member) => {
    const profile = profileForMember(member, profilesByMember);
    profile.externalIdentities.forEach((identity) => {
      const key = resourceIdentityKey(identity.provider, identity.externalId);
      if (!identity.provider || !identity.externalId) return;
      if (memberIdByIdentity.has(key)) duplicateIdentities.add(key);
      else memberIdByIdentity.set(key, asId(member));
    });
  });

  const boardIdByProject = new Map();
  const duplicateProjects = new Set();
  boards.forEach((board) => {
    (board.externalProjectMappings || []).forEach((mapping) => {
      const provider = String(mapping?.provider || '').trim().toLowerCase();
      const projectId = String(mapping?.projectId || '').trim();
      if (!RESOURCING_PROVIDERS.includes(provider) || !projectId) return;
      const key = resourceIdentityKey(provider, projectId);
      if (boardIdByProject.has(key)) duplicateProjects.add(key);
      else boardIdByProject.set(key, asId(board));
    });
  });

  const byMember = new Map();
  const byBoard = new Map();
  let entries = 0;
  let totalHours = 0;
  let matchedEntries = 0;
  let matchedHours = 0;
  let unmatchedEntries = 0;
  let unmatchedHours = 0;
  signals.forEach((signal) => {
    const provider = String(signal?.provider || '').toLowerCase();
    const raw = signal?.raw || {};
    const motionAssigneeIds = provider === 'motion' && Array.isArray(raw.assigneeIds)
      ? [...new Set(raw.assigneeIds.map(id => String(id || '').trim()).filter(id => /^[A-Za-z0-9_-]{1,160}$/.test(id)))]
      : [];
    const start = new Date(provider === 'motion' ? raw.scheduledStart || '' : raw.startedAt || '');
    const end = new Date(provider === 'motion' ? raw.scheduledEnd || '' : raw.dueAt || '');
    const scheduledHours = provider === 'float' ? Number(raw.scheduledHours) : provider === 'motion' ? Number(raw.durationMinutes) / 60 : Number(raw.scheduledMinutes) / 60;
    const externalIds = provider === 'motion' ? motionAssigneeIds : [provider === 'float' ? raw.assigneeId : raw.resourceId];
    if (!RESOURCING_PROVIDERS.includes(provider)
      || (provider === 'resource_guru' && raw.approvalState !== 'approved')
      || (provider === 'motion' && (signal.status === 'done' || raw.status === 'done'))
      || !Number.isFinite(scheduledHours) || scheduledHours <= 0
      || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < now || start > windowEnd) return;
    const totalBusinessDays = businessDaysBetween(start, end);
    const overlapStart = start > now ? start : now;
    const overlapEnd = end < windowEnd ? end : windowEnd;
    const overlapBusinessDays = businessDaysBetween(overlapStart, overlapEnd);
    if (totalBusinessDays <= 0 || overlapBusinessDays <= 0) return;
    const hoursInWindow = scheduledHours * overlapBusinessDays / totalBusinessDays;
    entries += 1;
    totalHours += hoursInWindow;
    if (externalIds.length === 0) {
      unmatchedEntries += 1;
      unmatchedHours += hoursInWindow;
      return;
    }
    const hoursPerAssignee = hoursInWindow / externalIds.length;
    let matchedHoursInSignal = 0;
    externalIds.forEach((externalId) => {
      const key = resourceIdentityKey(provider, externalId);
      const memberId = duplicateIdentities.has(key) ? null : memberIdByIdentity.get(key);
      if (!memberId) return;
      matchedHoursInSignal += hoursPerAssignee;
      const current = byMember.get(memberId) || { entries: 0, hours: 0, providers: {} };
      current.entries += 1;
      current.hours += hoursPerAssignee;
      const providerCurrent = current.providers[provider] || { entries: 0, hours: 0 };
      providerCurrent.entries += 1;
      providerCurrent.hours += hoursPerAssignee;
      current.providers[provider] = providerCurrent;
      byMember.set(memberId, current);
    });
    if (matchedHoursInSignal <= 0) {
      unmatchedEntries += 1;
      unmatchedHours += hoursInWindow;
      return;
    }
    matchedEntries += 1;
    matchedHours += matchedHoursInSignal;
    unmatchedHours += hoursInWindow - matchedHoursInSignal;
    const projectKey = resourceIdentityKey(provider, raw.projectId);
    const boardId = duplicateProjects.has(projectKey) ? null : boardIdByProject.get(projectKey);
    if (boardId) {
      const boardCurrent = byBoard.get(boardId) || { entries: 0, hours: 0 };
      boardCurrent.entries += 1;
      boardCurrent.hours += matchedHoursInSignal;
      byBoard.set(boardId, boardCurrent);
    }
  });

  const mappedProjectEntries = [...byBoard.values()].reduce((total, value) => total + value.entries, 0);
  const mappedProjectHours = [...byBoard.values()].reduce((total, value) => total + value.hours, 0);

  return {
    providers: RESOURCING_PROVIDERS,
    windowDays: ALLOCATION_WINDOW_DAYS,
    recordsRead: signals.length,
    entries,
    totalHours: round(totalHours),
    weeklyHours: round(totalHours / (ALLOCATION_WINDOW_DAYS / 7)),
    matchedEntries,
    matchedHours: round(matchedHours),
    matchedWeeklyHours: round(matchedHours / (ALLOCATION_WINDOW_DAYS / 7)),
    unmatchedEntries,
    unmatchedHours: round(unmatchedHours),
    matchedMembers: byMember.size,
    mappingConflicts: duplicateIdentities.size,
    mappedProjectEntries,
    mappedProjectHours: round(mappedProjectHours),
    mappedProjectWeeklyHours: round(mappedProjectHours / (ALLOCATION_WINDOW_DAYS / 7)),
    mappedBoards: byBoard.size,
    projectMappingConflicts: duplicateProjects.size,
    truncated,
    byMember,
    byBoard
  };
};

const calendarSummary = ({ signals = [], members = [], profilesByMember = new Map(), now = new Date(), truncated = false }) => {
  const windowEnd = new Date(now);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + CALENDAR_WINDOW_DAYS);
  const memberIdByIdentity = new Map();
  const duplicateIdentities = new Set();
  members.forEach((member) => {
    const profile = profileForMember(member, profilesByMember);
    profile.externalIdentities.forEach((identity) => {
      if (!CALENDAR_PROVIDERS.includes(String(identity.provider || '').toLowerCase()) || !identity.externalId) return;
      const key = resourceIdentityKey(identity.provider, identity.externalId);
      if (memberIdByIdentity.has(key)) duplicateIdentities.add(key);
      else memberIdByIdentity.set(key, asId(member));
    });
  });

  const intervalsByMember = new Map();
  let entries = 0;
  let matchedEntries = 0;
  let unmatchedEntries = 0;
  signals.forEach((signal) => {
    const provider = String(signal?.provider || '').toLowerCase();
    const raw = signal?.raw || {};
    const start = new Date(raw.start?.dateTime || '');
    const end = new Date(raw.end?.dateTime || '');
    if (!CALENDAR_PROVIDERS.includes(provider) || signal.status === 'archived'
      || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start
      || end <= now || start >= windowEnd || end.getTime() - start.getTime() > MAX_CALENDAR_EVENT_HOURS * 60 * 60 * 1000) return;
    const clippedStart = start > now ? start : now;
    const clippedEnd = end < windowEnd ? end : windowEnd;
    const ownerMemberIds = new Set((signal.owners || [])
      .map((owner) => resourceIdentityKey(provider, owner))
      .filter((key) => !duplicateIdentities.has(key))
      .map((key) => memberIdByIdentity.get(key))
      .filter(Boolean));
    entries += 1;
    if (ownerMemberIds.size !== 1) {
      unmatchedEntries += 1;
      return;
    }
    matchedEntries += 1;
    const memberId = [...ownerMemberIds][0];
    const intervals = intervalsByMember.get(memberId) || [];
    intervals.push({ start: clippedStart.getTime(), end: clippedEnd.getTime() });
    intervalsByMember.set(memberId, intervals);
  });

  const byMember = new Map();
  let matchedHours = 0;
  intervalsByMember.forEach((intervals, memberId) => {
    const merged = intervals.sort((left, right) => left.start - right.start).reduce((items, interval) => {
      const previous = items[items.length - 1];
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else items.push({ ...interval });
      return items;
    }, []);
    const hours = merged.reduce((total, interval) => total + (interval.end - interval.start) / (60 * 60 * 1000), 0);
    matchedHours += hours;
    byMember.set(memberId, { entries: intervals.length, hours });
  });

  return {
    providers: CALENDAR_PROVIDERS,
    windowDays: CALENDAR_WINDOW_DAYS,
    recordsRead: signals.length,
    entries,
    matchedEntries,
    unmatchedEntries,
    matchedHours: round(matchedHours),
    matchedWeeklyHours: round(matchedHours / (CALENDAR_WINDOW_DAYS / 7)),
    matchedMembers: byMember.size,
    mappingConflicts: duplicateIdentities.size,
    truncated,
    byMember
  };
};

const buildForecast = ({ boards = [], cards = [], members = [], profiles = [], performances = [], utilizationSignals = [], utilizationTruncated = false, allocationSignals = [], allocationTruncated = false, calendarSignals = [], calendarTruncated = false, now = new Date(), mode = 'live' }) => {
  const profilesByMember = new Map(profiles.map((profile) => [asId(profile.memberId), profile]));
  const boardNames = new Map(boards.map((board) => [asId(board), board.name || 'Untitled board']));
  const activeMembers = members.filter((member) => profileForMember(member, profilesByMember).active);
  const historicalHours = activeMembers
    .map((member) => historicalHoursForMember(member))
    .filter(Boolean);
  const teamCardHours = historicalHours.length
    ? historicalHours.reduce((sum, value) => sum + value, 0) / historicalHours.length
    : DEFAULT_CARD_HOURS;
  const hasThroughputEvidence = performances.some((record) => Number(record.metrics?.cardsCompleted || 0) > 0);
  const utilization = utilizationSummary({ signals: utilizationSignals, members: activeMembers, profilesByMember, now, truncated: utilizationTruncated });
  const allocation = allocationSummary({ signals: allocationSignals, boards, members: activeMembers, profilesByMember, now, truncated: allocationTruncated });
  const calendar = calendarSummary({ signals: calendarSignals, members: activeMembers, profilesByMember, now, truncated: calendarTruncated });

  const memberCapacity = activeMembers.map((member) => {
    const profile = profileForMember(member, profilesByMember);
    const weeklyAvailableHours = Math.max(0, profile.weeklyHours * (profile.allocationPercent / 100) - profile.focusHoursPerWeek);
    const timeOffHours = timeOffHoursInWindow(profile, now);
    const trackedTime = utilization.byMember.get(asId(member)) || { entries: 0, hours: 0, providers: {} };
    const harvest = trackedTime.providers.harvest || { entries: 0, hours: 0 };
    const scheduled = allocation.byMember.get(asId(member)) || { entries: 0, hours: 0 };
    const meetings = calendar.byMember.get(asId(member)) || { entries: 0, hours: 0 };
    return {
      memberId: asId(member),
      name: member.fullName || member.username || 'Unassigned',
      username: member.username || '',
      ...profile,
      historicalCardHours: round(historicalHoursForMember(member) || teamCardHours),
      weeklyAvailableHours: round(weeklyAvailableHours),
      dailyAvailableHours: round(weeklyAvailableHours / 5),
      timeOffHours: round(timeOffHours),
      trackedTimeEntriesLast28Days: trackedTime.entries,
      trackedTimeHoursLast28Days: round(trackedTime.hours),
      trackedTimeWeeklyHours: round(trackedTime.hours / (UTILIZATION_WINDOW_DAYS / 7)),
      trackedTimeProvidersLast28Days: Object.keys(trackedTime.providers),
      harvestEntriesLast28Days: harvest.entries,
      harvestHoursLast28Days: round(harvest.hours),
      harvestWeeklyHours: round(harvest.hours / (UTILIZATION_WINDOW_DAYS / 7)),
      scheduledAllocationEntriesNext28Days: scheduled.entries,
      scheduledAllocationHoursNext28Days: round(scheduled.hours),
      scheduledAllocationWeeklyHours: round(scheduled.hours / (ALLOCATION_WINDOW_DAYS / 7)),
      scheduledAllocationProvidersNext28Days: Object.keys(scheduled.providers || {}),
      calendarEventsNext28Days: meetings.entries,
      calendarBusyHoursNext28Days: round(meetings.hours),
      calendarBusyWeeklyHours: round(meetings.hours / (CALENDAR_WINDOW_DAYS / 7))
    };
  });

  const capacityByMember = new Map(memberCapacity.map((member) => [member.memberId, member]));
  const openCards = cards.filter((card) => !card.closed).slice(0, MAX_FORECAST_CARDS);
  const forecastForCards = (scopeCards, boardId = null) => {
    const assignedMemberIds = new Set(scopeCards.flatMap((card) => (card.members || []).map(asId).filter(Boolean)));
    const assignedCapacity = memberCapacity.filter((member) => assignedMemberIds.has(member.memberId));
    const usableCapacity = assignedCapacity.length > 0 ? assignedCapacity : memberCapacity;
    const workHours = scopeCards.reduce((total, card) => {
      const owner = (card.members || []).map(asId).find((memberId) => capacityByMember.has(memberId));
      const estimatedHours = owner ? capacityByMember.get(owner).historicalCardHours : teamCardHours;
      return total + estimatedHours * cardMultiplier(card, now);
    }, 0);
    const weeklyHours = usableCapacity.reduce((sum, member) => {
      // Spread planned time off across the 60-business-day forecast window (roughly 12 weeks).
      return sum + Math.max(0, member.weeklyAvailableHours - member.timeOffHours / 12);
    }, 0);
    const dailyHours = weeklyHours / 5;
    const unassigned = scopeCards.filter((card) => !card.members || card.members.length === 0).length;
    const highRisk = scopeCards.filter((card) => ['high', 'critical'].includes(card.riskLevel)).length;
    const overdue = scopeCards.filter((card) => card.due && new Date(card.due) < now && !card.dueComplete).length;
    const capacityDays = dailyHours > 0 ? workHours / dailyHours : null;
    const utilizationMembers = usableCapacity.filter((member) => member.trackedTimeEntriesLast28Days > 0);
    const overCommittedMembers = utilizationMembers.filter((member) => member.trackedTimeWeeklyHours > member.weeklyAvailableHours * 1.1);
    const utilizationCoverage = usableCapacity.length === 0 ? 0 : utilizationMembers.length / usableCapacity.length;
    const allocationMembers = usableCapacity.filter((member) => member.scheduledAllocationEntriesNext28Days > 0);
    const overAllocatedMembers = allocationMembers.filter((member) => member.scheduledAllocationWeeklyHours > member.weeklyAvailableHours * 1.1);
    const allocationCoverage = usableCapacity.length === 0 ? 0 : allocationMembers.length / usableCapacity.length;
    const calendarMembers = usableCapacity.filter((member) => member.calendarEventsNext28Days > 0);
    const meetingHeavyMembers = calendarMembers.filter((member) => member.calendarBusyWeeklyHours > member.weeklyAvailableHours * 0.75);
    const calendarCoverage = usableCapacity.length === 0 ? 0 : calendarMembers.length / usableCapacity.length;
    const boardSchedule = boardId ? allocation.byBoard.get(boardId) || { entries: 0, hours: 0 } : { entries: allocation.mappedProjectEntries, hours: allocation.mappedProjectHours };
    const uncertaintyMultiplier = 1
      + (unassigned > 0 ? 0.12 : 0)
      + (highRisk / Math.max(1, scopeCards.length)) * 0.25
      + (overdue > 0 ? 0.1 : 0)
      + (usableCapacity.some((member) => !member.configured) ? 0.08 : 0)
      + (historicalHours.length === 0 ? 0.12 : 0)
      + (overCommittedMembers.length > 0 ? 0.08 : 0)
      + (overAllocatedMembers.length > 0 ? 0.08 : 0)
      + (meetingHeavyMembers.length > 0 ? 0.06 : 0);
    const p50BusinessDays = capacityDays === null ? null : Math.max(1, Math.ceil(capacityDays));
    const p80BusinessDays = capacityDays === null ? null : Math.max(p50BusinessDays, Math.ceil(capacityDays * uncertaintyMultiplier));
    const nearestDueDate = scopeCards
      .map((card) => card.due && new Date(card.due))
      .filter((date) => date && !Number.isNaN(date.getTime()))
      .sort((left, right) => left - right)[0] || null;
    const p80Date = p80BusinessDays === null ? null : addBusinessDays(now, p80BusinessDays);
    const profileCoverage = usableCapacity.length === 0 ? 0 : usableCapacity.filter((member) => member.configured).length / usableCapacity.length;
    const ownershipCoverage = scopeCards.length === 0 ? 1 : 1 - unassigned / scopeCards.length;
    const historyCoverage = historicalHours.length > 0 || hasThroughputEvidence ? 1 : 0;
    const confidence = clamp(Math.round(38 + profileCoverage * 27 + ownershipCoverage * 20 + historyCoverage * 15 + utilizationCoverage * 7 + allocationCoverage * 4 + calendarCoverage * 3 - highRisk * 3 - overCommittedMembers.length * 5 - overAllocatedMembers.length * 5 - meetingHeavyMembers.length * 4), 15, 92);
    const risks = [
      ...(unassigned ? [`${unassigned} card${unassigned === 1 ? ' has' : 's have'} no accountable owner`] : []),
      ...(overdue ? [`${overdue} card${overdue === 1 ? ' is' : 's are'} overdue`] : []),
      ...(highRisk ? [`${highRisk} high-risk card${highRisk === 1 ? '' : 's'} increase delivery uncertainty`] : []),
      ...(usableCapacity.some((member) => member.timeOffHours > 0) ? ['Planned time off reduces the available forecast window'] : []),
      ...(overCommittedMembers.length > 0 ? [`Tracked-time evidence reports more hours than modeled capacity for ${overCommittedMembers.length} assigned contributor${overCommittedMembers.length === 1 ? '' : 's'}`] : []),
      ...(overAllocatedMembers.length > 0 ? [`Mapped resourcing allocations exceed modeled capacity for ${overAllocatedMembers.length} assigned contributor${overAllocatedMembers.length === 1 ? '' : 's'}`] : []),
      ...(meetingHeavyMembers.length > 0 ? [`Mapped calendars show high meeting load for ${meetingHeavyMembers.length} assigned contributor${meetingHeavyMembers.length === 1 ? '' : 's'}`] : [])
    ];
    const assumptions = [
      `Capacity uses ${round(weeklyHours)} available team hours per week after allocation and focus time.`,
      `Open cards use ${round(teamCardHours)} hours each when a personal historical estimate is unavailable.`,
      ...(utilizationMembers.length > 0 ? [`Bounded ${utilization.providerLabel || 'tracked-time'} metadata covers ${utilizationMembers.length}/${usableCapacity.length} assigned contributors over the last ${UTILIZATION_WINDOW_DAYS} days and calibrates forecast confidence only.`] : []),
      ...(allocationMembers.length > 0 ? [`Explicit Float, Resource Guru, or Motion member mappings cover ${allocationMembers.length}/${usableCapacity.length} assigned contributors over the next ${ALLOCATION_WINDOW_DAYS} days and calibrate forecast confidence only.`] : []),
      ...(boardId && boardSchedule.entries > 0 ? [`${round(boardSchedule.hours / (ALLOCATION_WINDOW_DAYS / 7))} scheduled hours per week map explicitly to this board and remain confidence-only evidence.`] : []),
      ...(calendarMembers.length > 0 ? [`Explicit Google Workspace or Microsoft 365 organizer mappings cover ${calendarMembers.length}/${usableCapacity.length} assigned contributors over the next ${CALENDAR_WINDOW_DAYS} days and calibrate forecast confidence only.`] : []),
      `P80 adds ${Math.round((uncertaintyMultiplier - 1) * 100)}% delivery uncertainty for ownership, risk, and evidence gaps.`
    ];
    return {
      boardId,
      boardName: boardId ? boardNames.get(boardId) || 'Untitled board' : 'Portfolio',
      openCards: scopeCards.length,
      workHours: round(workHours),
      weeklyAvailableHours: round(weeklyHours),
      utilizationPercent: weeklyHours > 0 ? round(Math.min(999, workHours / weeklyHours * 100)) : null,
      mappedProjectScheduleEntriesNext28Days: boardSchedule.entries,
      mappedProjectScheduleHoursNext28Days: round(boardSchedule.hours),
      mappedProjectScheduleWeeklyHours: round(boardSchedule.hours / (ALLOCATION_WINDOW_DAYS / 7)),
      externalProjectMappings: boardId ? (boards.find((board) => asId(board) === boardId)?.externalProjectMappings || []) : [],
      p50: p50BusinessDays === null ? null : { businessDays: p50BusinessDays, date: addBusinessDays(now, p50BusinessDays) },
      p80: p80BusinessDays === null ? null : { businessDays: p80BusinessDays, date: p80Date },
      nearestDueDate,
      confidence,
      confidenceLabel: confidence >= 75 ? 'supported' : confidence >= 50 ? 'directional' : 'low evidence',
      health: capacityDays === null
        ? 'watch'
        : p80Date && nearestDueDate && p80Date > nearestDueDate
          ? 'at_risk'
          : overdue > 0 || highRisk > 2
            ? 'watch'
            : 'on_track',
      assumptions,
      risks,
      members: usableCapacity.map((member) => ({
        memberId: member.memberId,
        name: member.name,
        dailyAvailableHours: member.dailyAvailableHours,
        timeOffHours: member.timeOffHours,
        configured: member.configured
      }))
    };
  };

  const boardForecasts = boards.map((board) => forecastForCards(openCards.filter((card) => asId(card.boardId) === asId(board)), asId(board)));
  return {
    mode,
    generatedAt: new Date(now),
    portfolio: forecastForCards(openCards),
    boards: boardForecasts.filter((forecast) => forecast.openCards > 0),
    memberCapacity,
    dataQuality: {
      openCards: openCards.length,
      members: activeMembers.length,
      capacityProfiles: profiles.length,
      historicalPerformanceRecords: performances.length,
      utilization: {
        provider: utilization.provider,
        providers: utilization.providers,
        activeProviders: utilization.activeProviders,
        providerLabel: utilization.providerLabel,
        providerEvidence: utilization.providerEvidence,
        windowDays: utilization.windowDays,
        recordsRead: utilization.recordsRead,
        entries: utilization.entries,
        totalHours: utilization.totalHours,
        weeklyHours: utilization.weeklyHours,
        matchedEntries: utilization.matchedEntries,
        unmatchedEntries: utilization.unmatchedEntries,
        unmatchedHours: utilization.unmatchedHours,
        matchedMembers: utilization.matchedMembers,
        truncated: utilization.truncated
      },
      allocations: {
        providers: allocation.providers,
        windowDays: allocation.windowDays,
        recordsRead: allocation.recordsRead,
        entries: allocation.entries,
        totalHours: allocation.totalHours,
        weeklyHours: allocation.weeklyHours,
        matchedEntries: allocation.matchedEntries,
        matchedHours: allocation.matchedHours,
        matchedWeeklyHours: allocation.matchedWeeklyHours,
        unmatchedEntries: allocation.unmatchedEntries,
        unmatchedHours: allocation.unmatchedHours,
        matchedMembers: allocation.matchedMembers,
        mappingConflicts: allocation.mappingConflicts,
        mappedProjectEntries: allocation.mappedProjectEntries,
        mappedProjectHours: allocation.mappedProjectHours,
        mappedProjectWeeklyHours: allocation.mappedProjectWeeklyHours,
        mappedBoards: allocation.mappedBoards,
        projectMappingConflicts: allocation.projectMappingConflicts,
        truncated: allocation.truncated
      },
      calendar: {
        providers: calendar.providers,
        windowDays: calendar.windowDays,
        recordsRead: calendar.recordsRead,
        entries: calendar.entries,
        matchedEntries: calendar.matchedEntries,
        unmatchedEntries: calendar.unmatchedEntries,
        matchedHours: calendar.matchedHours,
        matchedWeeklyHours: calendar.matchedWeeklyHours,
        matchedMembers: calendar.matchedMembers,
        mappingConflicts: calendar.mappingConflicts,
        truncated: calendar.truncated
      },
      truncated: cards.length > MAX_FORECAST_CARDS
    }
  };
};

const demoForecast = () => ({
  mode: 'demo',
  generatedAt: new Date(),
  portfolio: {
    boardName: 'Portfolio', openCards: 89, workHours: 620, weeklyAvailableHours: 74, utilizationPercent: 838,
    p50: { businessDays: 42, date: addBusinessDays(new Date(), 42) },
    p80: { businessDays: 58, date: addBusinessDays(new Date(), 58) },
    nearestDueDate: addBusinessDays(new Date(), 18), confidence: 68, confidenceLabel: 'directional', health: 'at_risk',
    assumptions: ['Capacity reflects three active contributors after focus time.', 'P80 includes dependency and ownership uncertainty.'],
    risks: ['7 cards have no accountable owner', '8 cards are overdue', 'Planned time off reduces the available forecast window'], members: []
  },
  boards: [
    { boardId: 'demo-board-1', boardName: 'Growth Experiments', openCards: 34, workHours: 238, weeklyAvailableHours: 46, utilizationPercent: 517, p50: { businessDays: 26, date: addBusinessDays(new Date(), 26) }, p80: { businessDays: 38, date: addBusinessDays(new Date(), 38) }, nearestDueDate: addBusinessDays(new Date(), 14), confidence: 71, confidenceLabel: 'supported', health: 'at_risk', assumptions: ['Two delivery owners contribute 46 hours per week.'], risks: ['4 high-risk cards increase delivery uncertainty'], members: [] },
    { boardId: 'demo-board-2', boardName: 'Client Launches', openCards: 27, workHours: 184, weeklyAvailableHours: 28, utilizationPercent: 657, p50: { businessDays: 33, date: addBusinessDays(new Date(), 33) }, p80: { businessDays: 44, date: addBusinessDays(new Date(), 44) }, nearestDueDate: addBusinessDays(new Date(), 18), confidence: 62, confidenceLabel: 'directional', health: 'at_risk', assumptions: ['One contributor is unavailable for part of the window.'], risks: ['3 cards are overdue'], members: [] }
  ],
  memberCapacity: [
    { memberId: 'demo-member-1', name: 'Milan', weeklyHours: 32, allocationPercent: 85, focusHoursPerWeek: 4, weeklyAvailableHours: 23.2, dailyAvailableHours: 4.6, timeOffHours: 0, configured: true, historicalCardHours: 5.4, trackedTimeEntriesLast28Days: 4, trackedTimeHoursLast28Days: 16, trackedTimeWeeklyHours: 4, trackedTimeProvidersLast28Days: ['harvest', 'everhour', 'toggl_track'], active: true, skills: ['engineering'] },
    { memberId: 'demo-member-2', name: 'Nina', weeklyHours: 32, allocationPercent: 75, focusHoursPerWeek: 4, weeklyAvailableHours: 20, dailyAvailableHours: 4, timeOffHours: 12, configured: true, historicalCardHours: 6.2, trackedTimeEntriesLast28Days: 3, trackedTimeHoursLast28Days: 10, trackedTimeWeeklyHours: 2.5, trackedTimeProvidersLast28Days: ['everhour', 'clockify'], active: true, skills: ['operations'] },
    { memberId: 'demo-member-3', name: 'Sam', weeklyHours: 24, allocationPercent: 100, focusHoursPerWeek: 4, weeklyAvailableHours: 20, dailyAvailableHours: 4, timeOffHours: 0, configured: false, historicalCardHours: 6, trackedTimeEntriesLast28Days: 1, trackedTimeHoursLast28Days: 4, trackedTimeWeeklyHours: 1, trackedTimeProvidersLast28Days: ['harvest'], active: true, skills: [] }
  ],
  dataQuality: {
    openCards: 89,
    members: 3,
    capacityProfiles: 2,
    historicalPerformanceRecords: 8,
    utilization: {
      provider: 'multi_provider',
      providers: TIME_TRACKING_PROVIDERS,
      activeProviders: TIME_TRACKING_PROVIDERS,
      providerLabel: 'Harvest, Everhour, Lucen Track, Toggl Track, and Clockify',
      entries: 8,
      totalHours: 30,
      weeklyHours: 7.5,
      matchedEntries: 8,
      unmatchedEntries: 0,
      unmatchedHours: 0,
      matchedMembers: 3,
      truncated: false
    },
    truncated: false
  }
});

class ForecastService {
  isDatabaseReady() {
    return mongoose.connection.readyState === 1;
  }

  async getForecast(options = {}) {
    if (!this.isDatabaseReady()) return demoForecast();
    const workspaceId = normalizeWorkspaceObjectId(options.workspaceId);
    const now = new Date();
    const utilizationStart = new Date(now);
    utilizationStart.setUTCDate(utilizationStart.getUTCDate() - UTILIZATION_WINDOW_DAYS);
    const [boards, cards, members, profiles, performances, utilizationSignals, allocationSignals, calendarSignals] = await Promise.all([
      Board.find({ workspaceId, closed: false }).limit(250),
      Card.find({ workspaceId, closed: false }).limit(MAX_FORECAST_CARDS + 1),
      Member.find({ workspaceId }).limit(500),
      CapacityProfile.find({ workspaceId }).limit(500),
      Performance.find({ workspaceId, period: 'weekly' }).sort({ startDate: -1 }).limit(500),
      WorkSignal.find({
        workspaceId,
        provider: { $in: TIME_TRACKING_PROVIDERS },
        sourceType: 'time_entry',
        providerCreatedAt: { $gte: utilizationStart }
      }).select('provider raw owners providerCreatedAt').sort({ providerCreatedAt: -1 }).limit(MAX_UTILIZATION_SIGNALS + 1),
      WorkSignal.find({
        workspaceId,
        provider: { $in: RESOURCING_PROVIDERS },
        sourceType: { $in: ['allocation', 'booking', 'task'] }
      }).select('provider status raw lastSeenAt').sort({ lastSeenAt: -1 }).limit(MAX_ALLOCATION_SIGNALS + 1),
      WorkSignal.find({
        workspaceId,
        provider: { $in: CALENDAR_PROVIDERS },
        sourceType: 'event'
      }).select('provider status owners raw lastSeenAt').sort({ lastSeenAt: -1 }).limit(MAX_CALENDAR_SIGNALS + 1)
    ]);
    const scenarioOverrides = Array.isArray(options.scenarioOverrides) ? options.scenarioOverrides : [];
    const forecast = buildForecast({
      boards,
      cards,
      members,
      profiles: applyScenarioOverrides(profiles, members, scenarioOverrides),
      performances,
      utilizationSignals: utilizationSignals.slice(0, MAX_UTILIZATION_SIGNALS),
      utilizationTruncated: utilizationSignals.length > MAX_UTILIZATION_SIGNALS,
      allocationSignals: allocationSignals.slice(0, MAX_ALLOCATION_SIGNALS),
      allocationTruncated: allocationSignals.length > MAX_ALLOCATION_SIGNALS,
      calendarSignals: calendarSignals.slice(0, MAX_CALENDAR_SIGNALS),
      calendarTruncated: calendarSignals.length > MAX_CALENDAR_SIGNALS,
      now
    });
    if (scenarioOverrides.length > 0) {
      forecast.scenario = {
        active: true,
        overrideCount: scenarioOverrides.length,
        memberIds: scenarioOverrides.map((override) => String(override.memberId)),
        appliedAt: now
      };
    }
    return forecast;
  }

  async getBoardForecast(boardId, options = {}) {
    const forecast = await this.getForecast(options);
    const board = forecast.boards.find((item) => item.boardId === String(boardId));
    if (!board && forecast.mode !== 'demo') {
      const error = new Error('Board forecast not found');
      error.statusCode = 404;
      throw error;
    }
    return { mode: forecast.mode, generatedAt: forecast.generatedAt, board: board || forecast.boards[0], dataQuality: forecast.dataQuality };
  }
}

const forecastService = new ForecastService();

module.exports = forecastService;
module.exports.ForecastService = ForecastService;
module.exports.buildForecast = buildForecast;
module.exports.applyScenarioOverrides = applyScenarioOverrides;
