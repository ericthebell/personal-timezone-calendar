const { DateTime } = require('luxon');
const feedGenerator = require('../../services/feed-generator');

describe('feed-generator', () => {
  describe('dateTimeToIcsArray', () => {
    it('should convert DateTime to array for timed events', () => {
      const dt = DateTime.fromObject({
        year: 2025,
        month: 1,
        day: 15,
        hour: 14,
        minute: 30
      });

      const result = feedGenerator.dateTimeToIcsArray(dt, false);

      expect(result).toEqual([2025, 1, 15, 14, 30]);
    });

    it('should convert DateTime to array for all-day events (no time)', () => {
      const dt = DateTime.fromObject({
        year: 2025,
        month: 1,
        day: 15
      });

      const result = feedGenerator.dateTimeToIcsArray(dt, true);

      expect(result).toEqual([2025, 1, 15]);
    });
  });

  describe('formatEventForIcs', () => {
    const baseEvent = {
      uid: 'test-123',
      summary: 'Test Meeting',
      description: 'A test meeting',
      start: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 14, minute: 0 }),
      end: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 15, minute: 0 }),
      isAllDay: false,
      location: 'Conference Room A',
      timezone: 'America/New_York'
    };

    it('should include event title in full mode', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, false);
      expect(result.title).toBe('Test Meeting');
    });

    it('should hide event title in busy mode', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, true);
      expect(result.title).toBe('Busy');
    });

    it('should include location in full mode', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, false);
      expect(result.location).toBe('Conference Room A');
    });

    it('should not include location in busy mode', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, true);
      expect(result.location).toBeUndefined();
    });

    it('should preserve uid', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, false);
      expect(result.uid).toBe('test-123');
    });

    it('should NOT include original description (stripped per requirements)', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, false);
      // Original descriptions are now stripped from output
      expect(result.description).not.toContain('A test meeting');
    });

    it('should not include original description in busy mode', () => {
      const result = feedGenerator.formatEventForIcs(baseEvent, true);
      expect(result.description).not.toContain('A test meeting');
    });

    it('should include source calendar annotation when present', () => {
      const eventWithSource = { ...baseEvent, sourceCalendar: 'Work Calendar' };
      const result = feedGenerator.formatEventForIcs(eventWithSource, false);
      // New format uses "Source:" on separate line
      expect(result.description).toContain('Source: Work Calendar');
    });
  });

  describe('formatSourceNote', () => {
    it('should format source note with all annotation fields', () => {
      const event = {
        sourceCalendar: 'Work Calendar',
        timezone: 'America/New_York',
        original: {
          startTime: '14:00',
          timezone: 'America/New_York'
        }
      };

      const result = feedGenerator.formatSourceNote(event, false);

      // New format includes all required annotation fields
      expect(result).toContain('[Face Value - Unchanged]');
      expect(result).toContain('Source: Work Calendar');
      expect(result).toContain('Original: 14:00 America/New_York');
      expect(result).toContain('Adjusted: +0 hours');
      expect(result).toContain('Basis: face-value (unchanged)');
    });

    it('should include full annotations in busy mode too', () => {
      const event = {
        sourceCalendar: 'Work Calendar',
        timezone: 'America/New_York',
        original: {
          startTime: '14:00',
          timezone: 'America/New_York'
        }
      };

      const result = feedGenerator.formatSourceNote(event, true);

      // Busy mode should still include all annotations
      expect(result).toContain('[Face Value - Unchanged]');
      expect(result).toContain('Source: Work Calendar');
      expect(result).toContain('Adjusted: +0 hours');
      expect(result).toContain('Basis: face-value (unchanged)');
    });
  });

  describe('formatAdjustmentAnnotation', () => {
    it('should format positive hour adjustment', () => {
      const event = {
        original: {
          startTime: '14:00',
          timezone: 'America/Los_Angeles'
        },
        timezone: 'America/New_York',
        adjustment: {
          sourceCalendar: 'Work Calendar',
          hoursAdjusted: 3,
          basis: 'umbrella event (Hotel Stay in Tokyo)'
        }
      };

      const result = feedGenerator.formatAdjustmentAnnotation(event);

      expect(result).toContain('[Timezone Adjusted]');
      expect(result).toContain('Source: Work Calendar');
      expect(result).toContain('Original: 14:00 America/Los_Angeles');
      expect(result).toContain('Subscriber shift: +3h (appears later)');
      expect(result).toContain('Basis: umbrella event (Hotel Stay in Tokyo)');
      expect(result).toContain('Current TZ: America/New_York');
    });

    it('should format negative hour adjustment', () => {
      const event = {
        original: {
          startTime: '09:00',
          timezone: 'America/New_York'
        },
        timezone: 'America/Los_Angeles',
        adjustment: {
          sourceCalendar: 'Personal',
          hoursAdjusted: -3,
          basis: 'calendar default'
        }
      };

      const result = feedGenerator.formatAdjustmentAnnotation(event);

      expect(result).toContain('Subscriber shift: -3h (appears earlier)');
    });

    it('should include current TZ even in busy mode (full annotations)', () => {
      const event = {
        original: {
          startTime: '14:00',
          timezone: 'America/Los_Angeles'
        },
        timezone: 'America/New_York',
        adjustment: {
          sourceCalendar: 'Work',
          hoursAdjusted: 3,
          basis: 'default'
        }
      };

      const result = feedGenerator.formatAdjustmentAnnotation(event, true);

      // Busy mode should still include all annotations including Current TZ
      expect(result).toContain('Current TZ: America/New_York');
    });
  });

  describe('mergeCalendars', () => {
    it('should merge events from multiple calendars', () => {
      const calendars = [
        {
          name: 'Work',
          events: [
            {
              uid: 'work-1',
              summary: 'Work Meeting',
              start: DateTime.fromISO('2025-01-15T10:00:00'),
              end: DateTime.fromISO('2025-01-15T11:00:00')
            }
          ]
        },
        {
          name: 'Personal',
          events: [
            {
              uid: 'personal-1',
              summary: 'Lunch',
              start: DateTime.fromISO('2025-01-15T12:00:00'),
              end: DateTime.fromISO('2025-01-15T13:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result.length).toBe(2);
    });

    it('should add source calendar name to events', () => {
      const calendars = [
        {
          name: 'Work',
          events: [
            {
              uid: 'work-1',
              summary: 'Work Meeting',
              start: DateTime.fromISO('2025-01-15T10:00:00'),
              end: DateTime.fromISO('2025-01-15T11:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result[0].sourceCalendar).toBe('Work');
    });

    it('should prefer configName over name', () => {
      const calendars = [
        {
          name: 'Fetched Name',
          configName: 'My Work Calendar',
          events: [
            {
              uid: 'work-1',
              summary: 'Meeting',
              start: DateTime.fromISO('2025-01-15T10:00:00'),
              end: DateTime.fromISO('2025-01-15T11:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result[0].sourceCalendar).toBe('My Work Calendar');
    });

    it('should add sourceCalendarMode to events', () => {
      const calendars = [
        {
          name: 'Work',
          mode: 'personal-timezone',
          events: [
            {
              uid: 'work-1',
              summary: 'Meeting',
              start: DateTime.fromISO('2025-01-15T10:00:00'),
              end: DateTime.fromISO('2025-01-15T11:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result[0].sourceCalendarMode).toBe('personal-timezone');
    });

    it('should sort merged events by start time', () => {
      const calendars = [
        {
          name: 'Work',
          events: [
            {
              uid: 'work-1',
              summary: 'Late Meeting',
              start: DateTime.fromISO('2025-01-15T16:00:00'),
              end: DateTime.fromISO('2025-01-15T17:00:00')
            }
          ]
        },
        {
          name: 'Personal',
          events: [
            {
              uid: 'personal-1',
              summary: 'Early Appointment',
              start: DateTime.fromISO('2025-01-15T08:00:00'),
              end: DateTime.fromISO('2025-01-15T09:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result[0].summary).toBe('Early Appointment');
      expect(result[1].summary).toBe('Late Meeting');
    });

    it('should handle empty calendars', () => {
      const calendars = [
        { name: 'Empty', events: [] },
        {
          name: 'HasEvents',
          events: [
            {
              uid: 'event-1',
              summary: 'Event',
              start: DateTime.fromISO('2025-01-15T10:00:00'),
              end: DateTime.fromISO('2025-01-15T11:00:00')
            }
          ]
        }
      ];

      const result = feedGenerator.mergeCalendars(calendars);

      expect(result.length).toBe(1);
    });
  });

  describe('deduplicateEvents', () => {
    it('should remove duplicate events by UID', () => {
      const events = [
        { uid: 'event-1', summary: 'First' },
        { uid: 'event-2', summary: 'Second' },
        { uid: 'event-1', summary: 'Duplicate' }
      ];

      const result = feedGenerator.deduplicateEvents(events);

      expect(result.length).toBe(2);
      expect(result.find(e => e.summary === 'Duplicate')).toBeUndefined();
    });

    it('should keep first occurrence of duplicate', () => {
      const events = [
        { uid: 'event-1', summary: 'First' },
        { uid: 'event-1', summary: 'Second' }
      ];

      const result = feedGenerator.deduplicateEvents(events);

      expect(result[0].summary).toBe('First');
    });
  });

  describe('getCalendarStats', () => {
    it('should count total events across calendars', () => {
      const calendars = [
        { name: 'Work', mode: 'face-value', events: [{}, {}, {}] },
        { name: 'Personal', mode: 'personal-timezone', events: [{}, {}] }
      ];

      const stats = feedGenerator.getCalendarStats(calendars);

      expect(stats.totalEvents).toBe(5);
      expect(stats.totalCalendars).toBe(2);
    });

    it('should count events by calendar', () => {
      const calendars = [
        { name: 'Work', mode: 'face-value', events: [{}, {}, {}] },
        { name: 'Personal', mode: 'personal-timezone', events: [{}, {}] }
      ];

      const stats = feedGenerator.getCalendarStats(calendars);

      expect(stats.eventsByCalendar['Work']).toBe(3);
      expect(stats.eventsByCalendar['Personal']).toBe(2);
    });

    it('should count events by mode', () => {
      const calendars = [
        { name: 'Work', mode: 'face-value', events: [{}, {}, {}] },
        { name: 'Personal', mode: 'personal-timezone', events: [{}, {}] }
      ];

      const stats = feedGenerator.getCalendarStats(calendars);

      expect(stats.eventsByMode['face-value']).toBe(3);
      expect(stats.eventsByMode['personal-timezone']).toBe(2);
    });
  });

  describe('generateFeed', () => {
    it('should generate valid iCal output', async () => {
      const events = [
        {
          uid: 'test-1',
          summary: 'Test Event',
          description: 'A test',
          start: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 14, minute: 0 }),
          end: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 15, minute: 0 }),
          isAllDay: false,
          timezone: 'America/New_York'
        }
      ];

      const result = await feedGenerator.generateFeed(events, {
        calendarName: 'Test Calendar'
      });

      expect(result).toContain('BEGIN:VCALENDAR');
      expect(result).toContain('END:VCALENDAR');
      expect(result).toContain('BEGIN:VEVENT');
      expect(result).toContain('END:VEVENT');
      expect(result).toContain('X-WR-CALNAME:Test Calendar');
    });

    it('should generate busy-only feed without titles', async () => {
      const events = [
        {
          uid: 'test-1',
          summary: 'Secret Meeting',
          description: 'Confidential',
          start: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 14, minute: 0 }),
          end: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 15, minute: 0 }),
          isAllDay: false,
          timezone: 'America/New_York'
        }
      ];

      const result = await feedGenerator.generateFeed(events, {
        calendarName: 'Busy Calendar',
        busyOnly: true
      });

      expect(result).toContain('SUMMARY:Busy');
      expect(result).not.toContain('Secret Meeting');
      expect(result).not.toContain('Confidential');
    });

    it('should include adjustment annotations', async () => {
      const events = [
        {
          uid: 'test-1',
          summary: 'Adjusted Event',
          start: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 14, minute: 0 }),
          end: DateTime.fromObject({ year: 2025, month: 1, day: 15, hour: 15, minute: 0 }),
          isAllDay: false,
          timezone: 'America/New_York',
          sourceCalendar: 'Work',
          original: {
            startTime: '11:00',
            timezone: 'America/Los_Angeles'
          },
          adjustment: {
            sourceCalendar: 'Work',
            hoursAdjusted: 3,
            basis: 'calendar default'
          }
        }
      ];

      const result = await feedGenerator.generateFeed(events, {
        calendarName: 'Test Calendar'
      });

      expect(result).toContain('Timezone Adjusted');
    });
  });
});
