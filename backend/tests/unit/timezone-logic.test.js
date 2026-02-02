const { DateTime } = require('luxon');
const timezoneLogic = require('../../services/timezone-logic');

// Mock the config module for defaultLocation tests
jest.mock('../../config', () => ({
  get defaultLocation() {
    return global.__mockDefaultLocation || null;
  }
}));

// Mock geocoding module
jest.mock('../../services/geocoding', () => ({
  getTimezoneForLocation: jest.fn(async (location) => {
    // Simulate geocoding for known locations
    const locationMap = {
      'Tokyo, Japan': 'Asia/Tokyo',
      'San Francisco, CA': 'America/Los_Angeles',
      'New York, USA': 'America/New_York',
      'Detroit, Michigan': 'America/Detroit',
      'London, UK': 'Europe/London'
    };
    return locationMap[location] || null;
  })
}));

describe('timezone-logic', () => {
  describe('convertUtcToDefaultTimezone', () => {
    it('should convert UTC time to default timezone (recover intended wall-clock)', () => {
      // Event stored as 6pm UTC, but was entered as 10am PST
      const utcTime = DateTime.fromObject(
        { year: 2026, month: 1, day: 6, hour: 18, minute: 0 },
        { zone: 'UTC' }
      );

      const result = timezoneLogic.convertUtcToDefaultTimezone(utcTime, 'America/Los_Angeles');

      // 6pm UTC = 10am PST (UTC-8)
      expect(result.hour).toBe(10);
      expect(result.minute).toBe(0);
      expect(result.zoneName).toBe('America/Los_Angeles');
    });

    it('should handle different default timezones', () => {
      // Event stored as 3pm UTC, entered as 10am EST
      const utcTime = DateTime.fromObject(
        { year: 2026, month: 1, day: 6, hour: 15, minute: 0 },
        { zone: 'UTC' }
      );

      const result = timezoneLogic.convertUtcToDefaultTimezone(utcTime, 'America/New_York');

      // 3pm UTC = 10am EST (UTC-5)
      expect(result.hour).toBe(10);
      expect(result.minute).toBe(0);
      expect(result.zoneName).toBe('America/New_York');
    });
  });

  describe('getSubscriberTimeShift', () => {
    it('should return negative shift when event appears earlier (PST→EST)', () => {
      // 2pm PST reinterpreted as 2pm EST appears 3 hours earlier
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14 },
        { zone: 'America/Los_Angeles' }
      );

      const shift = timezoneLogic.getSubscriberTimeShift(dt, 'America/Los_Angeles', 'America/New_York');

      // PST→EST: event at 2pm PST (10pm UTC) becomes 2pm EST (7pm UTC)
      // The event is 3 hours EARLIER in absolute time
      expect(shift).toBe(-3);
    });

    it('should return positive shift when event appears later (EST→PST)', () => {
      // 2pm EST reinterpreted as 2pm PST appears 3 hours later
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14 },
        { zone: 'America/New_York' }
      );

      const shift = timezoneLogic.getSubscriberTimeShift(dt, 'America/New_York', 'America/Los_Angeles');

      // EST→PST: event at 2pm EST (7pm UTC) becomes 2pm PST (10pm UTC)
      // The event is 3 hours LATER in absolute time
      expect(shift).toBe(3);
    });

    it('should return 0 for same timezone', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14 },
        { zone: 'America/New_York' }
      );

      const shift = timezoneLogic.getSubscriberTimeShift(dt, 'America/New_York', 'America/New_York');

      // In JavaScript, -0 === 0 is true, but Jest's toBe/toEqual treat them differently
      // Check that we get a zero value (either 0 or -0)
      expect(Object.is(shift, 0) || Object.is(shift, -0)).toBe(true);
    });
  });

  describe('reinterpretTimezone', () => {
    it('should preserve wall-clock time when changing timezone', () => {
      // 2pm PST
      const original = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14, minute: 0 },
        { zone: 'America/Los_Angeles' }
      );

      // Reinterpret as EST (should still be 2pm, not 5pm)
      const reinterpreted = timezoneLogic.reinterpretTimezone(original, 'America/New_York');

      expect(reinterpreted.hour).toBe(14);
      expect(reinterpreted.minute).toBe(0);
      expect(reinterpreted.zoneName).toBe('America/New_York');
    });

    it('should preserve date when changing timezone', () => {
      const original = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14, minute: 30 },
        { zone: 'America/Los_Angeles' }
      );

      const reinterpreted = timezoneLogic.reinterpretTimezone(original, 'Asia/Tokyo');

      expect(reinterpreted.year).toBe(2026);
      expect(reinterpreted.month).toBe(1);
      expect(reinterpreted.day).toBe(15);
      expect(reinterpreted.hour).toBe(14);
      expect(reinterpreted.minute).toBe(30);
    });

    it('should handle midnight correctly', () => {
      const original = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 0, minute: 0 },
        { zone: 'UTC' }
      );

      const reinterpreted = timezoneLogic.reinterpretTimezone(original, 'America/New_York');

      expect(reinterpreted.hour).toBe(0);
      expect(reinterpreted.day).toBe(15);
    });
  });

  describe('getTimezoneOffset', () => {
    it('should calculate correct offset between PST and EST', () => {
      // In January, PST is UTC-8 and EST is UTC-5, so EST is 3 hours ahead
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 12 },
        { zone: 'America/Los_Angeles' }
      );

      const offset = timezoneLogic.getTimezoneOffset(dt, 'America/Los_Angeles', 'America/New_York');

      expect(offset).toBe(3);
    });

    it('should calculate correct offset between EST and PST (negative)', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 12 },
        { zone: 'America/New_York' }
      );

      const offset = timezoneLogic.getTimezoneOffset(dt, 'America/New_York', 'America/Los_Angeles');

      expect(offset).toBe(-3);
    });

    it('should calculate correct offset for Tokyo', () => {
      // PST is UTC-8, Tokyo is UTC+9, so Tokyo is 17 hours ahead
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 12 },
        { zone: 'America/Los_Angeles' }
      );

      const offset = timezoneLogic.getTimezoneOffset(dt, 'America/Los_Angeles', 'Asia/Tokyo');

      expect(offset).toBe(17);
    });

    it('should return 0 for same timezone', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 12 },
        { zone: 'America/New_York' }
      );

      const offset = timezoneLogic.getTimezoneOffset(dt, 'America/New_York', 'America/New_York');

      expect(offset).toBe(0);
    });
  });

  describe('isMultiDayEvent', () => {
    it('should return true for all-day event spanning multiple days', () => {
      const event = {
        isAllDay: true,
        start: DateTime.fromISO('2026-01-15'),
        end: DateTime.fromISO('2026-01-18')
      };

      expect(timezoneLogic.isMultiDayEvent(event)).toBe(true);
    });

    it('should return false for single all-day event', () => {
      const event = {
        isAllDay: true,
        start: DateTime.fromISO('2026-01-15'),
        end: DateTime.fromISO('2026-01-16')
      };

      expect(timezoneLogic.isMultiDayEvent(event)).toBe(false);
    });

    it('should return true for timed event spanning midnight', () => {
      const event = {
        isAllDay: false,
        start: DateTime.fromISO('2026-01-15T22:00:00'),
        end: DateTime.fromISO('2026-01-16T02:00:00')
      };

      expect(timezoneLogic.isMultiDayEvent(event)).toBe(true);
    });

    it('should return false for same-day timed event', () => {
      const event = {
        isAllDay: false,
        start: DateTime.fromISO('2026-01-15T10:00:00'),
        end: DateTime.fromISO('2026-01-15T11:00:00')
      };

      expect(timezoneLogic.isMultiDayEvent(event)).toBe(false);
    });

    it('should return false for event without start', () => {
      const event = {
        isAllDay: false,
        end: DateTime.fromISO('2026-01-15T11:00:00')
      };

      expect(timezoneLogic.isMultiDayEvent(event)).toBe(false);
    });
  });

  describe('findUmbrellaEvent', () => {
    const umbrellaEvents = [
      {
        summary: 'Tokyo Conference',
        location: 'Tokyo, Japan',
        isAllDay: true,
        start: DateTime.fromISO('2026-01-20'),
        end: DateTime.fromISO('2026-01-25')
      },
      {
        summary: 'Hotel Stay',
        location: 'San Francisco, CA',
        isAllDay: false,
        start: DateTime.fromISO('2026-02-01T14:00:00'),
        end: DateTime.fromISO('2026-02-05T11:00:00')
      },
      {
        summary: 'Single Day Event',
        location: 'New York, NY',
        isAllDay: true,
        start: DateTime.fromISO('2026-03-01'),
        end: DateTime.fromISO('2026-03-02')
      }
    ];

    it('should find umbrella event covering a time', () => {
      const targetTime = DateTime.fromISO('2026-01-22T10:00:00');
      const umbrella = timezoneLogic.findUmbrellaEvent(umbrellaEvents, targetTime);

      expect(umbrella).not.toBeNull();
      expect(umbrella.summary).toBe('Tokyo Conference');
    });

    it('should find timed umbrella event', () => {
      const targetTime = DateTime.fromISO('2026-02-03T09:00:00');
      const umbrella = timezoneLogic.findUmbrellaEvent(umbrellaEvents, targetTime);

      expect(umbrella).not.toBeNull();
      expect(umbrella.summary).toBe('Hotel Stay');
    });

    it('should not find umbrella for time outside any event', () => {
      const targetTime = DateTime.fromISO('2026-01-10T10:00:00');
      const umbrella = timezoneLogic.findUmbrellaEvent(umbrellaEvents, targetTime);

      expect(umbrella).toBeNull();
    });

    it('should not use single-day events as umbrella', () => {
      const targetTime = DateTime.fromISO('2026-03-01T12:00:00');
      const umbrella = timezoneLogic.findUmbrellaEvent(umbrellaEvents, targetTime);

      expect(umbrella).toBeNull();
    });

    it('should not use events without location as umbrella', () => {
      const eventsNoLocation = [
        {
          summary: 'Trip',
          isAllDay: true,
          start: DateTime.fromISO('2026-01-20'),
          end: DateTime.fromISO('2026-01-25')
        }
      ];

      const targetTime = DateTime.fromISO('2026-01-22T10:00:00');
      const umbrella = timezoneLogic.findUmbrellaEvent(eventsNoLocation, targetTime);

      expect(umbrella).toBeNull();
    });
  });

  describe('processEvent (face-value mode)', () => {
    it('should return event unchanged in face-value mode', async () => {
      const event = {
        uid: 'test-1',
        summary: 'Meeting',
        start: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 14 },
          { zone: 'America/Los_Angeles' }
        ),
        end: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 15 },
          { zone: 'America/Los_Angeles' }
        ),
        timezone: 'America/Los_Angeles',
        original: {
          startTime: '14:00',
          startDate: '2026-01-15',
          timezone: 'America/Los_Angeles'
        }
      };

      const result = await timezoneLogic.processEvent(event, {
        mode: 'face-value',
        calendarTimezone: 'America/Los_Angeles',
        calendarName: 'Work Calendar'
      });

      expect(result.start.hour).toBe(14);
      expect(result.timezone).toBe('America/Los_Angeles');
      expect(result.adjustment).toBeUndefined();
      expect(result.sourceCalendar).toBe('Work Calendar');
    });
  });

  describe('processEvent (personal-timezone mode)', () => {
    beforeEach(() => {
      // Set up default location for personal-timezone tests
      global.__mockDefaultLocation = 'Detroit, Michigan';
    });

    afterEach(() => {
      global.__mockDefaultLocation = null;
    });

    it('should add sourceCalendar to event', async () => {
      const event = {
        uid: 'test-1',
        summary: 'Meeting',
        start: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 14 },
          { zone: 'America/Los_Angeles' }
        ),
        end: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 15 },
          { zone: 'America/Los_Angeles' }
        ),
        timezone: 'America/Los_Angeles',
        original: {
          startTime: '14:00',
          startDate: '2026-01-15',
          timezone: 'America/Los_Angeles'
        }
      };

      const result = await timezoneLogic.processEvent(event, {
        mode: 'personal-timezone',
        calendarName: 'Personal Calendar',
        allEvents: []
      });

      expect(result.sourceCalendar).toBe('Personal Calendar');
    });

    it('should reinterpret timezone to global default location', async () => {
      const event = {
        uid: 'test-1',
        summary: 'Meeting',
        start: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 14 },
          { zone: 'America/Los_Angeles' }
        ),
        end: DateTime.fromObject(
          { year: 2026, month: 1, day: 15, hour: 15 },
          { zone: 'America/Los_Angeles' }
        ),
        timezone: 'America/Los_Angeles',
        original: {
          startTime: '14:00',
          startDate: '2026-01-15',
          timezone: 'America/Los_Angeles'
        }
      };

      const result = await timezoneLogic.processEvent(event, {
        mode: 'personal-timezone',
        calendarName: 'Personal Calendar',
        allEvents: []
      });

      // Should be reinterpreted to Detroit (America/Detroit) - wall-clock time preserved
      // 2pm stays 2pm, but now in Eastern timezone
      expect(result.timezone).toBe('America/Detroit');
      expect(result.start.hour).toBe(14); // Wall-clock time preserved
      expect(result.adjustment).toBeDefined();
      expect(result.adjustment.hoursAdjusted).toBe(-3); // Event appears 3h earlier (PST to Detroit/EST)
    });

    it('should handle UTC-stored events by first converting to calendar timezone', async () => {
      // Simulate an event stored as UTC 18:00, but calendar timezone is Pacific
      // User entered "10am Pacific" which got stored as 18:00 UTC (PST is UTC-8)
      const event = {
        uid: 'test-utc',
        summary: 'GRapids drains',
        start: DateTime.fromObject(
          { year: 2026, month: 1, day: 6, hour: 18 },
          { zone: 'UTC' }
        ),
        end: DateTime.fromObject(
          { year: 2026, month: 1, day: 6, hour: 19 },
          { zone: 'UTC' }
        ),
        timezone: 'UTC',
        wasStoredAsUtc: true,
        original: {
          startTime: '18:00',
          startDate: '2026-01-06',
          timezone: 'UTC'
        }
      };

      const result = await timezoneLogic.processEvent(event, {
        mode: 'personal-timezone',
        calendarName: 'Personal Calendar',
        calendarTimezone: 'America/Los_Angeles', // Calendar's X-WR-TIMEZONE
        allEvents: []
      });

      // Step 1: UTC 18:00 → Pacific 10:00am (recover intended wall-clock)
      // Step 2: Pacific 10:00am → Detroit 10:00am (wall-clock preserved)
      expect(result.timezone).toBe('America/Detroit');
      expect(result.start.hour).toBe(10); // Wall-clock preserved: 10am stays 10am
      expect(result.adjustment).toBeDefined();
      expect(result.adjustment.hoursAdjusted).toBe(-3); // PST→EST shift
    });
  });

  describe('determineEventTimezone with global defaultLocation', () => {
    beforeEach(() => {
      // Reset the mock default location before each test
      global.__mockDefaultLocation = null;
    });

    afterEach(() => {
      global.__mockDefaultLocation = null;
    });

    it('should use global defaultLocation when no umbrella event', async () => {
      global.__mockDefaultLocation = 'Detroit, Michigan';

      const event = {
        start: DateTime.fromISO('2026-01-15T14:00:00'),
        end: DateTime.fromISO('2026-01-15T15:00:00')
      };

      const timezone = await timezoneLogic.determineEventTimezone(event, []);

      expect(timezone).toBe('America/Detroit');
    });

    it('should prefer umbrella event over global defaultLocation', async () => {
      global.__mockDefaultLocation = 'Detroit, Michigan';

      const event = {
        start: DateTime.fromISO('2026-01-22T10:00:00'),
        end: DateTime.fromISO('2026-01-22T11:00:00')
      };

      const umbrellaEvents = [
        {
          summary: 'Tokyo Conference',
          location: 'Tokyo, Japan',
          isAllDay: true,
          start: DateTime.fromISO('2026-01-20'),
          end: DateTime.fromISO('2026-01-25')
        }
      ];

      const timezone = await timezoneLogic.determineEventTimezone(event, umbrellaEvents);

      expect(timezone).toBe('Asia/Tokyo');
    });

    it('should return null when no defaultLocation is set (no conversion)', async () => {
      global.__mockDefaultLocation = null;

      const event = {
        start: DateTime.fromISO('2026-01-15T14:00:00'),
        end: DateTime.fromISO('2026-01-15T15:00:00')
      };

      const timezone = await timezoneLogic.determineEventTimezone(event, []);

      // Returns null to indicate no conversion needed
      expect(timezone).toBeNull();
    });
  });

  describe('getAdjustmentBasis with global defaultLocation', () => {
    beforeEach(() => {
      global.__mockDefaultLocation = null;
    });

    afterEach(() => {
      global.__mockDefaultLocation = null;
    });

    it('should return default location description when used', async () => {
      global.__mockDefaultLocation = 'Detroit, Michigan';

      const event = {
        start: DateTime.fromISO('2026-01-15T14:00:00'),
        end: DateTime.fromISO('2026-01-15T15:00:00')
      };

      const basis = await timezoneLogic.getAdjustmentBasis(event, []);

      expect(basis).toBe('default location (Detroit, Michigan)');
    });

    it('should return no conversion description when no location set', async () => {
      global.__mockDefaultLocation = null;

      const event = {
        start: DateTime.fromISO('2026-01-15T14:00:00'),
        end: DateTime.fromISO('2026-01-15T15:00:00')
      };

      const basis = await timezoneLogic.getAdjustmentBasis(event, []);

      expect(basis).toBe('no conversion');
    });

    it('should return umbrella event description when inside umbrella', async () => {
      global.__mockDefaultLocation = 'Detroit, Michigan';

      const event = {
        start: DateTime.fromISO('2026-01-22T10:00:00'),
        end: DateTime.fromISO('2026-01-22T11:00:00')
      };

      const umbrellaEvents = [
        {
          summary: 'Tokyo Conference',
          location: 'Tokyo, Japan',
          isAllDay: true,
          start: DateTime.fromISO('2026-01-20'),
          end: DateTime.fromISO('2026-01-25')
        }
      ];

      const basis = await timezoneLogic.getAdjustmentBasis(event, umbrellaEvents);

      expect(basis).toBe('umbrella event: "Tokyo Conference" (Tokyo, Japan)');
    });
  });
});
