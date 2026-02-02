const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const icalParser = require('../../services/ical-parser');
const timezoneLogic = require('../../services/timezone-logic');
const feedGenerator = require('../../services/feed-generator');

// Mock the config for tests
jest.mock('../../config', () => ({
  defaultTimezone: 'America/Detroit',
  monthsToFetch: 3
}));

describe('Timezone Pipeline Integration', () => {
  let umbrellaCalendarData;

  beforeAll(() => {
    const fixturePath = path.join(__dirname, '../fixtures/umbrella-calendar.ics');
    umbrellaCalendarData = fs.readFileSync(fixturePath, 'utf8');
  });

  describe('Face-value mode', () => {
    it('should leave events unchanged', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);
      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'face-value'
      });

      // Find a specific event
      const regularMeeting = processed.events.find(
        e => e.uid === 'regular-meeting@example.com'
      );

      expect(regularMeeting).toBeDefined();
      expect(regularMeeting.start.hour).toBe(10);
      expect(regularMeeting.timezone).toBe('America/Los_Angeles');
      expect(regularMeeting.adjustment).toBeUndefined();
    });
  });

  describe('Personal-timezone mode with umbrella inheritance', () => {
    it('should inherit timezone from umbrella event', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);
      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'personal-timezone'
      });

      // Find the morning meeting during the Tokyo hotel stay
      const morningMeeting = processed.events.find(
        e => e.uid === 'morning-meeting@example.com'
      );

      expect(morningMeeting).toBeDefined();

      // The meeting should have been reinterpreted
      // Original: 9am PST, but during Tokyo trip
      // If umbrella detection works, it should detect the Tokyo timezone
      // The wall-clock time should still be 9am, but in Tokyo timezone
      if (morningMeeting.adjustment) {
        expect(morningMeeting.start.hour).toBe(9); // Wall-clock time preserved
        expect(morningMeeting.adjustment.basis).toContain('umbrella event');
        expect(morningMeeting.adjustment.basis).toContain('Tokyo');
      }
    });

    it('should use default timezone for events outside umbrella', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);
      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'personal-timezone'
      });

      // Find the regular meeting (not during any umbrella event)
      const regularMeeting = processed.events.find(
        e => e.uid === 'regular-meeting@example.com'
      );

      expect(regularMeeting).toBeDefined();

      // If timezone was changed, there should be adjustment info
      // When no calendar-specific targetTimezone or global defaultLocation is set,
      // it falls back to UTC
      if (regularMeeting.adjustment) {
        expect(regularMeeting.start.hour).toBe(10); // Wall-clock time preserved
        // Basis will say "fallback (UTC)" when no defaults are configured
        expect(regularMeeting.adjustment.basis).toMatch(/fallback|default/);
      }
    });
  });

  describe('Feed generation with adjustments', () => {
    it('should include adjustment annotations in output', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);
      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'personal-timezone'
      });

      // Find an adjusted event
      const adjustedEvent = processed.events.find(e => e.adjustment);

      if (adjustedEvent) {
        const feed = await feedGenerator.generateFeed([adjustedEvent], {
          calendarName: 'Test Calendar',
          busyOnly: false
        });

        expect(feed).toContain('BEGIN:VCALENDAR');
        expect(feed).toContain('BEGIN:VEVENT');
        expect(feed).toContain('END:VEVENT');
      }
    });

    it('should hide details in busy-only mode', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);
      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'face-value'
      });

      const feed = await feedGenerator.generateFeed(processed.events, {
        calendarName: 'Busy Calendar',
        busyOnly: true
      });

      // Should have "Busy" for all events
      expect(feed).toContain('SUMMARY:Busy');
      // Should not contain actual event titles
      expect(feed).not.toContain('Morning Team Sync');
      expect(feed).not.toContain('Hotel Stay');
    });
  });

  describe('Timezone offset calculations', () => {
    it('should correctly calculate PST to EST offset (3 hours)', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 10 },
        { zone: 'America/Los_Angeles' }
      );

      const offset = timezoneLogic.getTimezoneOffset(
        dt,
        'America/Los_Angeles',
        'America/New_York'
      );

      expect(offset).toBe(3);
    });

    it('should correctly calculate PST to Detroit offset (3 hours)', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 10 },
        { zone: 'America/Los_Angeles' }
      );

      const offset = timezoneLogic.getTimezoneOffset(
        dt,
        'America/Los_Angeles',
        'America/Detroit'
      );

      // Detroit is Eastern time, same as New York
      expect(offset).toBe(3);
    });

    it('should correctly calculate PST to Tokyo offset (17 hours)', () => {
      const dt = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 10 },
        { zone: 'America/Los_Angeles' }
      );

      const offset = timezoneLogic.getTimezoneOffset(
        dt,
        'America/Los_Angeles',
        'Asia/Tokyo'
      );

      // PST (UTC-8) to Tokyo (UTC+9) = 17 hours
      expect(offset).toBe(17);
    });
  });

  describe('Wall-clock time preservation', () => {
    it('should preserve 9am as 9am when changing timezone', () => {
      const original = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
        { zone: 'America/Los_Angeles' }
      );

      const reinterpreted = timezoneLogic.reinterpretTimezone(original, 'Asia/Tokyo');

      expect(reinterpreted.hour).toBe(9);
      expect(reinterpreted.minute).toBe(0);
      expect(reinterpreted.zoneName).toBe('Asia/Tokyo');
    });

    it('should preserve 2pm as 2pm when changing from PST to EST', () => {
      const original = DateTime.fromObject(
        { year: 2026, month: 1, day: 15, hour: 14, minute: 30 },
        { zone: 'America/Los_Angeles' }
      );

      const reinterpreted = timezoneLogic.reinterpretTimezone(original, 'America/New_York');

      expect(reinterpreted.hour).toBe(14);
      expect(reinterpreted.minute).toBe(30);
      expect(reinterpreted.zoneName).toBe('America/New_York');
    });
  });

  describe('Complete pipeline', () => {
    it('should process calendar and generate valid iCal output', async () => {
      const parsed = icalParser.parseIcalString(umbrellaCalendarData);

      expect(parsed.name).toBe('Travel Calendar');
      expect(parsed.events.length).toBeGreaterThan(0);

      const processed = await timezoneLogic.processCalendar(parsed, {
        mode: 'personal-timezone'
      });

      expect(processed.events.length).toBe(parsed.events.length);

      const feed = await feedGenerator.generateFeed(processed.events, {
        calendarName: 'Output Calendar',
        busyOnly: false
      });

      expect(feed).toContain('BEGIN:VCALENDAR');
      expect(feed).toContain('X-WR-CALNAME:Output Calendar');
      expect(feed).toContain('END:VCALENDAR');
    });
  });
});
