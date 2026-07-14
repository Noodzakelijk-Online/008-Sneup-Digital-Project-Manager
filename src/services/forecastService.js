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
const UTILIZATION_WINDOW_DAYS = 28;

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
    configured: Boolean(profile._id),
    weeklyHours,
    allocationPercent,
    focusHoursPerWeek,
    timeOff: Array.isArray(profile.timeOff) ? profile.timeOff : [],
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    active: profile.active !== false
  };
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

const utilizationSummary = ({ signals = [], members = [], now = new Date(), truncated = false }) => {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - UTILIZATION_WINDOW_DAYS);
  const memberIdByIdentity = new Map();
  members.forEach((member) => {
    [member.fullName, member.username].map(identityKey).filter(Boolean).forEach((key) => {
      if (!memberIdByIdentity.has(key)) memberIdByIdentity.set(key, asId(member));
    });
  });

  const byMember = new Map();
  let entries = 0;
  let totalHours = 0;
  let matchedEntries = 0;
  let unmatchedEntries = 0;
  let unmatchedHours = 0;
  signals.forEach((signal) => {
    const raw = signal?.raw || {};
    const spentAt = new Date(raw.spentDate || signal.providerCreatedAt || '');
    const hours = Number(raw.hours);
    if (!Number.isFinite(hours) || hours <= 0 || Number.isNaN(spentAt.getTime()) || spentAt < cutoff || spentAt > now) return;
    entries += 1;
    totalHours += hours;
    const memberId = memberIdByIdentity.get(identityKey(raw.user?.name || signal.owners?.[0]));
    if (!memberId) {
      unmatchedEntries += 1;
      unmatchedHours += hours;
      return;
    }
    matchedEntries += 1;
    const current = byMember.get(memberId) || { entries: 0, hours: 0 };
    current.entries += 1;
    current.hours += hours;
    byMember.set(memberId, current);
  });

  return {
    provider: 'harvest',
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

const buildForecast = ({ boards = [], cards = [], members = [], profiles = [], performances = [], utilizationSignals = [], utilizationTruncated = false, now = new Date(), mode = 'live' }) => {
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
  const utilization = utilizationSummary({ signals: utilizationSignals, members: activeMembers, now, truncated: utilizationTruncated });

  const memberCapacity = activeMembers.map((member) => {
    const profile = profileForMember(member, profilesByMember);
    const weeklyAvailableHours = Math.max(0, profile.weeklyHours * (profile.allocationPercent / 100) - profile.focusHoursPerWeek);
    const timeOffHours = timeOffHoursInWindow(profile, now);
    const harvest = utilization.byMember.get(asId(member)) || { entries: 0, hours: 0 };
    return {
      memberId: asId(member),
      name: member.fullName || member.username || 'Unassigned',
      username: member.username || '',
      ...profile,
      historicalCardHours: round(historicalHoursForMember(member) || teamCardHours),
      weeklyAvailableHours: round(weeklyAvailableHours),
      dailyAvailableHours: round(weeklyAvailableHours / 5),
      timeOffHours: round(timeOffHours),
      harvestEntriesLast28Days: harvest.entries,
      harvestHoursLast28Days: round(harvest.hours),
      harvestWeeklyHours: round(harvest.hours / (UTILIZATION_WINDOW_DAYS / 7))
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
    const utilizationMembers = usableCapacity.filter((member) => member.harvestEntriesLast28Days > 0);
    const overCommittedMembers = utilizationMembers.filter((member) => member.harvestWeeklyHours > member.weeklyAvailableHours * 1.1);
    const utilizationCoverage = usableCapacity.length === 0 ? 0 : utilizationMembers.length / usableCapacity.length;
    const uncertaintyMultiplier = 1
      + (unassigned > 0 ? 0.12 : 0)
      + (highRisk / Math.max(1, scopeCards.length)) * 0.25
      + (overdue > 0 ? 0.1 : 0)
      + (usableCapacity.some((member) => !member.configured) ? 0.08 : 0)
      + (historicalHours.length === 0 ? 0.12 : 0)
      + (overCommittedMembers.length > 0 ? 0.08 : 0);
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
    const confidence = clamp(Math.round(38 + profileCoverage * 27 + ownershipCoverage * 20 + historyCoverage * 15 + utilizationCoverage * 7 - highRisk * 3 - overCommittedMembers.length * 5), 15, 92);
    const risks = [
      ...(unassigned ? [`${unassigned} card${unassigned === 1 ? ' has' : 's have'} no accountable owner`] : []),
      ...(overdue ? [`${overdue} card${overdue === 1 ? ' is' : 's are'} overdue`] : []),
      ...(highRisk ? [`${highRisk} high-risk card${highRisk === 1 ? '' : 's'} increase delivery uncertainty`] : []),
      ...(usableCapacity.some((member) => member.timeOffHours > 0) ? ['Planned time off reduces the available forecast window'] : []),
      ...(overCommittedMembers.length > 0 ? [`Harvest reports more tracked hours than modeled capacity for ${overCommittedMembers.length} assigned contributor${overCommittedMembers.length === 1 ? '' : 's'}`] : [])
    ];
    const assumptions = [
      `Capacity uses ${round(weeklyHours)} available team hours per week after allocation and focus time.`,
      `Open cards use ${round(teamCardHours)} hours each when a personal historical estimate is unavailable.`,
      ...(utilizationMembers.length > 0 ? [`Harvest time-entry metadata covers ${utilizationMembers.length}/${usableCapacity.length} assigned contributors over the last ${UTILIZATION_WINDOW_DAYS} days and calibrates forecast confidence only.`] : []),
      `P80 adds ${Math.round((uncertaintyMultiplier - 1) * 100)}% delivery uncertainty for ownership, risk, and evidence gaps.`
    ];
    return {
      boardId,
      boardName: boardId ? boardNames.get(boardId) || 'Untitled board' : 'Portfolio',
      openCards: scopeCards.length,
      workHours: round(workHours),
      weeklyAvailableHours: round(weeklyHours),
      utilizationPercent: weeklyHours > 0 ? round(Math.min(999, workHours / weeklyHours * 100)) : null,
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
    { memberId: 'demo-member-1', name: 'Milan', weeklyHours: 32, allocationPercent: 85, focusHoursPerWeek: 4, weeklyAvailableHours: 23.2, dailyAvailableHours: 4.6, timeOffHours: 0, configured: true, historicalCardHours: 5.4, active: true, skills: ['engineering'] },
    { memberId: 'demo-member-2', name: 'Nina', weeklyHours: 32, allocationPercent: 75, focusHoursPerWeek: 4, weeklyAvailableHours: 20, dailyAvailableHours: 4, timeOffHours: 12, configured: true, historicalCardHours: 6.2, active: true, skills: ['operations'] },
    { memberId: 'demo-member-3', name: 'Sam', weeklyHours: 24, allocationPercent: 100, focusHoursPerWeek: 4, weeklyAvailableHours: 20, dailyAvailableHours: 4, timeOffHours: 0, configured: false, historicalCardHours: 6, active: true, skills: [] }
  ],
  dataQuality: { openCards: 89, members: 3, capacityProfiles: 2, historicalPerformanceRecords: 8, truncated: false }
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
    const [boards, cards, members, profiles, performances, utilizationSignals] = await Promise.all([
      Board.find({ workspaceId, closed: false }).limit(250),
      Card.find({ workspaceId, closed: false }).limit(MAX_FORECAST_CARDS + 1),
      Member.find({ workspaceId }).limit(500),
      CapacityProfile.find({ workspaceId, active: true }).limit(500),
      Performance.find({ workspaceId, period: 'weekly' }).sort({ startDate: -1 }).limit(500),
      WorkSignal.find({
        workspaceId,
        provider: 'harvest',
        sourceType: 'time_entry',
        providerCreatedAt: { $gte: utilizationStart }
      }).select('raw owners providerCreatedAt').sort({ providerCreatedAt: -1 }).limit(MAX_UTILIZATION_SIGNALS + 1)
    ]);
    return buildForecast({
      boards,
      cards,
      members,
      profiles,
      performances,
      utilizationSignals: utilizationSignals.slice(0, MAX_UTILIZATION_SIGNALS),
      utilizationTruncated: utilizationSignals.length > MAX_UTILIZATION_SIGNALS,
      now
    });
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
