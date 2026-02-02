const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const icalParser = require('../../services/ical-parser');

describe('ical-parser', () => {
  let simpleCalendarData;

  beforeAll(() => {
    const fixturePath = path.join(__dirname, '../fixtures/simple-calendar.ics');
    simpleCalendarData = fs.readFileSync(fixturePath, 'utf8');
  });

  describe('parseIcalString', () => {
    it('should parse calendar name', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      expect(result.name).toBe('Test Calendar');
    });

    it('should parse calendar timezone', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      expect(result.timezone).toBe('America/Los_Angeles');
    });

    it('should parse all events', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      expect(result.events.length).toBe(3);
    });

    it('should parse event summary', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.summary).toBe('Team Meeting');
    });

    it('should parse event description', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.description).toBe('Weekly team sync');
    });

    it('should parse event location', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.location).toBe('San Francisco, CA');
    });

    it('should parse timed event start correctly', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.start.hour).toBe(14);
      expect(teamMeeting.start.minute).toBe(0);
    });

    it('should parse timed event end correctly', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.end.hour).toBe(15);
      expect(teamMeeting.end.minute).toBe(0);
    });

    it('should identify all-day events', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const conference = result.events.find(e => e.uid === 'test-event-3@example.com');
      expect(conference.isAllDay).toBe(true);
    });

    it('should identify timed events as not all-day', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.isAllDay).toBe(false);
    });

    it('should preserve original time info', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      const teamMeeting = result.events.find(e => e.uid === 'test-event-1@example.com');
      expect(teamMeeting.original.startTime).toBe('14:00');
      expect(teamMeeting.original.timezone).toBe('America/Los_Angeles');
    });

    it('should sort events by start time', () => {
      const result = icalParser.parseIcalString(simpleCalendarData);
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i].start.toMillis())
          .toBeGreaterThanOrEqual(result.events[i - 1].start.toMillis());
      }
    });
  });

  describe('isEventInRange', () => {
    it('should return true for events within range', () => {
      const event = {
        start: DateTime.fromISO('2025-01-15T10:00:00'),
        end: DateTime.fromISO('2025-01-15T11:00:00')
      };
      const rangeStart = DateTime.fromISO('2025-01-01');
      const rangeEnd = DateTime.fromISO('2025-01-31');

      expect(icalParser.isEventInRange(event, rangeStart, rangeEnd)).toBe(true);
    });

    it('should return false for events before range', () => {
      const event = {
        start: DateTime.fromISO('2024-12-15T10:00:00'),
        end: DateTime.fromISO('2024-12-15T11:00:00')
      };
      const rangeStart = DateTime.fromISO('2025-01-01');
      const rangeEnd = DateTime.fromISO('2025-01-31');

      expect(icalParser.isEventInRange(event, rangeStart, rangeEnd)).toBe(false);
    });

    it('should return false for events after range', () => {
      const event = {
        start: DateTime.fromISO('2025-02-15T10:00:00'),
        end: DateTime.fromISO('2025-02-15T11:00:00')
      };
      const rangeStart = DateTime.fromISO('2025-01-01');
      const rangeEnd = DateTime.fromISO('2025-01-31');

      expect(icalParser.isEventInRange(event, rangeStart, rangeEnd)).toBe(false);
    });

    it('should return true for events spanning range boundaries', () => {
      const event = {
        start: DateTime.fromISO('2024-12-28T10:00:00'),
        end: DateTime.fromISO('2025-01-05T11:00:00')
      };
      const rangeStart = DateTime.fromISO('2025-01-01');
      const rangeEnd = DateTime.fromISO('2025-01-31');

      expect(icalParser.isEventInRange(event, rangeStart, rangeEnd)).toBe(true);
    });
  });

  describe('icalDateToLuxon', () => {
    it('should convert date-only to DateTime', () => {
      const mockIcalTime = {
        year: 2025,
        month: 1,
        day: 15,
        isDate: true
      };

      const result = icalParser.icalDateToLuxon(mockIcalTime, 'America/New_York');

      expect(result.year).toBe(2025);
      expect(result.month).toBe(1);
      expect(result.day).toBe(15);
    });

    it('should convert datetime to DateTime with correct time', () => {
      const mockIcalTime = {
        year: 2025,
        month: 1,
        day: 15,
        hour: 14,
        minute: 30,
        second: 0,
        isDate: false
      };

      const result = icalParser.icalDateToLuxon(mockIcalTime, 'America/Los_Angeles');

      expect(result.year).toBe(2025);
      expect(result.month).toBe(1);
      expect(result.day).toBe(15);
      expect(result.hour).toBe(14);
      expect(result.minute).toBe(30);
      expect(result.zoneName).toBe('America/Los_Angeles');
    });
  });
});
