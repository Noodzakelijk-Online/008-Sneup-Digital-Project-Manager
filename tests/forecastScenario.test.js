const { buildForecast, applyScenarioOverrides } = require('../src/services/forecastService');
const forecastRoutes = require('../src/routes/forecasts');

const member = { _id: '507f1f77bcf86cd799439011', username: 'milan', fullName: 'Milan' };
const board = { _id: '507f1f77bcf86cd799439012', name: 'Launch' };
const card = {
  _id: '507f1f77bcf86cd799439013',
  boardId: board._id,
  name: 'Ship launch',
  closed: false,
  members: [member._id]
};

describe('capacity forecast scenarios', () => {
  test('applies temporary capacity inputs without mutating a stored profile', () => {
    const profiles = [{
      _id: '507f1f77bcf86cd799439014',
      memberId: member._id,
      weeklyHours: 40,
      allocationPercent: 100,
      focusHoursPerWeek: 0,
      timeOff: []
    }];
    const effectiveProfiles = applyScenarioOverrides(profiles, [member], [{
      memberId: member._id,
      weeklyHours: 8,
      allocationPercent: 100,
      focusHoursPerWeek: 0,
      timeOff: [{ startDate: '2026-07-13', endDate: '2026-07-13', label: 'Leave' }]
    }]);

    expect(profiles[0]).toMatchObject({ weeklyHours: 40, timeOff: [] });
    expect(effectiveProfiles[0]).toMatchObject({ weeklyHours: 8, scenarioOverride: true });
    expect(effectiveProfiles[0]).not.toBe(profiles[0]);

    const baseline = buildForecast({
      now: new Date('2026-07-06T08:00:00.000Z'), boards: [board], cards: [card], members: [member], profiles
    });
    const scenario = buildForecast({
      now: new Date('2026-07-06T08:00:00.000Z'), boards: [board], cards: [card], members: [member], profiles: effectiveProfiles
    });

    expect(baseline.portfolio.weeklyAvailableHours).toBe(40);
    expect(scenario.portfolio.weeklyAvailableHours).toBeLessThan(8);
    expect(scenario.portfolio.p50.businessDays).toBeGreaterThan(baseline.portfolio.p50.businessDays);
    expect(scenario.memberCapacity[0]).toMatchObject({ configured: true, weeklyHours: 8, timeOffHours: expect.any(Number) });
  });

  test('keeps profiles for unaffected members and ignores overrides outside the loaded workspace member set', () => {
    const otherMember = { _id: '507f1f77bcf86cd799439015', username: 'nina', fullName: 'Nina' };
    const profiles = [{ _id: '507f1f77bcf86cd799439016', memberId: member._id, weeklyHours: 32 }];
    const effectiveProfiles = applyScenarioOverrides(profiles, [member, otherMember], [{
      memberId: '507f1f77bcf86cd799439099', weeklyHours: 10
    }]);

    expect(effectiveProfiles).toBe(profiles);
  });

  test('honors a disabled stored capacity profile instead of treating that member as an active default', () => {
    const forecast = buildForecast({
      now: new Date('2026-07-06T08:00:00.000Z'),
      boards: [board],
      cards: [card],
      members: [member],
      profiles: [{ _id: '507f1f77bcf86cd799439016', memberId: member._id, active: false }]
    });

    expect(forecast.memberCapacity).toEqual([]);
    expect(forecast.portfolio.p50).toBeNull();
  });

  test('rejects malformed, duplicate, empty, and oversized scenario requests', () => {
    const normalize = forecastRoutes.normalizeScenarioOverrides;
    expect(() => normalize([])).toThrow('capacity scenario');
    expect(() => normalize([{ memberId: 'not-an-object-id', weeklyHours: 20 }])).toThrow('valid and unique');
    expect(() => normalize([{ memberId: member._id }])).toThrow('temporary capacity change');
    expect(() => normalize([{ memberId: member._id, weeklyHours: 81 }])).toThrow('weeklyHours');
    expect(() => normalize([{ memberId: member._id, weeklyHours: 20 }, { memberId: member._id, allocationPercent: 80 }])).toThrow('valid and unique');
    expect(() => normalize(Array.from({ length: 11 }, (_, index) => ({
      memberId: `507f1f77bcf86cd7994390${String(index + 20).padStart(2, '0')}`,
      weeklyHours: 20
    })))).toThrow('1 to 10');
  });
});
