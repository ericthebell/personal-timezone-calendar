const { createEvents } = require('ics');
const { DateTime } = require('luxon');

/**
 * Generate an iCal feed from parsed events
 * @param {Object[]} events - Array of parsed events
 * @param {Object} options - Generation options
 * @param {string} options.calendarName - Name for the output calendar
 * @param {boolean} options.busyOnly - If true, hide event titles (show "Busy")
 * @returns {Promise<string>} iCal string
 */
async function generateFeed(events, options = {}) {
  const { calendarName = 'Personal Timezone Calendar', busyOnly = false } = options;

  const icsEvents = events.map(event => formatEventForIcs(event, busyOnly));

  return new Promise((resolve, reject) => {
    createEvents(icsEvents, (error, value) => {
      if (error) {
        reject(new Error(`Failed to generate iCal: ${error}`));
        return;
      }

      // Add calendar name to the output
      const icalWithName = value.replace(
        'BEGIN:VCALENDAR',
        `BEGIN:VCALENDAR\r\nX-WR-CALNAME:${calendarName}`
      );

      resolve(icalWithName);
    });
  });
}

/**
 * Format a parsed event for the ics library
 * @param {Object} event - Parsed event
 * @param {boolean} busyOnly - Whether to hide the title
 * @returns {Object} Event formatted for ics library
 */
function formatEventForIcs(event, busyOnly) {
  const start = event.start;
  const end = event.end;

  // Build description with annotations only (strip original description per requirements)
  let description = '';

  // Add annotation for all events (adjusted or not)
  if (event.adjustment) {
    description = formatAdjustmentAnnotation(event, busyOnly);
  } else if (event.sourceCalendar) {
    // Non-adjusted events get annotation based on their mode
    // Personal-timezone events that needed no adjustment (same source/target TZ)
    // should still show as personal-timezone, not face-value
    const isPersonalTimezone = event.sourceCalendarMode === 'personal-timezone';
    description = formatSourceNote(event, busyOnly, isPersonalTimezone);
  }

  // Convert to UTC for proper timezone handling in calendar apps
  const startUtc = event.isAllDay ? start : start.toUTC();
  const endUtc = event.isAllDay ? end : end.toUTC();

  const icsEvent = {
    uid: event.uid,
    title: busyOnly ? 'Busy' : event.summary,
    description,
    start: dateTimeToIcsArray(startUtc, event.isAllDay),
    end: dateTimeToIcsArray(endUtc, event.isAllDay),
    startInputType: event.isAllDay ? 'local' : 'utc',
    startOutputType: event.isAllDay ? 'local' : 'utc',
    endInputType: event.isAllDay ? 'local' : 'utc',
    endOutputType: event.isAllDay ? 'local' : 'utc'
  };

  // Add location if not in busy mode
  if (!busyOnly && event.location) {
    icsEvent.location = event.location;
  }

  return icsEvent;
}

/**
 * Convert Luxon DateTime to ics library array format
 * @param {DateTime} dt - Luxon DateTime
 * @param {boolean} isAllDay - Whether this is an all-day event
 * @returns {number[]} Array of [year, month, day, hour, minute]
 */
function dateTimeToIcsArray(dt, isAllDay) {
  if (isAllDay) {
    return [dt.year, dt.month, dt.day];
  }
  return [dt.year, dt.month, dt.day, dt.hour, dt.minute];
}

/**
 * Format a source note for non-adjusted events
 * Includes all annotation fields for consistency:
 * - Source calendar name
 * - Original time and timezone
 * - Hours adjusted (0 for non-adjusted)
 * - Basis for adjustment
 *
 * @param {Object} event - Event object
 * @param {boolean} busyOnly - Whether in busy mode (annotations still included)
 * @param {boolean} isPersonalTimezone - Whether this is a personal-timezone mode calendar
 * @returns {string} Source note text
 */
function formatSourceNote(event, busyOnly, isPersonalTimezone = false) {
  const modeLabel = isPersonalTimezone ? 'Personal Timezone - No Shift' : 'Face Value - Unchanged';
  const basisLabel = isPersonalTimezone ? 'personal-timezone (no shift needed)' : 'face-value (unchanged)';

  const lines = [
    `[${modeLabel}]`,
    `Source: ${event.sourceCalendar}`
  ];

  // Include original time info if available
  if (event.original) {
    lines.push(`Original: ${event.original.startTime} ${event.original.timezone}`);
  } else if (event.timezone) {
    lines.push(`Timezone: ${event.timezone}`);
  }

  // Hours adjusted is always 0 for non-adjusted events
  lines.push(`Adjusted: +0 hours`);
  lines.push(`Basis: ${basisLabel}`);

  return lines.join('\n');
}

/**
 * Format the adjustment annotation for an event description
 * Per README requirements:
 * - Source calendar name
 * - Original local time
 * - Subscriber shift (how much earlier/later the event appears)
 * - Basis for adjustment
 *
 * @param {Object} event - Event with adjustment info
 * @param {boolean} busyOnly - Whether in busy mode
 * @returns {string} Annotation text
 */
function formatAdjustmentAnnotation(event, busyOnly = false) {
  const adj = event.adjustment;

  // Format subscriber shift with direction indicator
  // Negative = event appears earlier to subscriber, Positive = later
  const shiftHours = adj.hoursAdjusted;
  let shiftStr;
  if (shiftHours === 0) {
    shiftStr = 'no change';
  } else if (shiftHours < 0) {
    shiftStr = `${shiftHours}h (appears earlier)`;
  } else {
    shiftStr = `+${shiftHours}h (appears later)`;
  }

  const lines = [
    `[Timezone Adjusted]`,
    `Source: ${adj.sourceCalendar || event.sourceCalendar || 'Unknown'}`,
    `Original: ${event.original.startTime} ${event.original.timezone}`,
    `Subscriber shift: ${shiftStr}`,
    `Basis: ${adj.basis}`,
    `Current TZ: ${event.timezone}`
  ];

  return lines.join('\n');
}

/**
 * Merge multiple calendars into a single event list
 * Preserves source calendar info and mode for each event
 *
 * @param {Object[]} calendars - Array of parsed/processed calendars
 * @returns {Object[]} Merged and sorted events
 */
function mergeCalendars(calendars) {
  const allEvents = [];

  for (const calendar of calendars) {
    const calendarName = calendar.configName || calendar.name || 'Unknown Calendar';
    const calendarMode = calendar.mode || 'face-value';

    for (const event of calendar.events) {
      // Only add sourceCalendar if not already set (from timezone processing)
      const mergedEvent = {
        ...event,
        sourceCalendar: event.sourceCalendar || calendarName,
        sourceCalendarMode: calendarMode
      };

      allEvents.push(mergedEvent);
    }
  }

  // Sort by start time
  return allEvents.sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

/**
 * Deduplicate events that appear in multiple calendars
 * Uses UID to identify duplicates, keeps the first occurrence
 *
 * @param {Object[]} events - Array of events
 * @returns {Object[]} Deduplicated events
 */
function deduplicateEvents(events) {
  const seen = new Map();

  return events.filter(event => {
    if (seen.has(event.uid)) {
      return false;
    }
    seen.set(event.uid, true);
    return true;
  });
}

/**
 * Get statistics about merged calendars
 * @param {Object[]} calendars - Array of calendars
 * @returns {Object} Statistics
 */
function getCalendarStats(calendars) {
  const stats = {
    totalCalendars: calendars.length,
    totalEvents: 0,
    eventsByCalendar: {},
    eventsByMode: {
      'face-value': 0,
      'personal-timezone': 0
    }
  };

  for (const calendar of calendars) {
    const name = calendar.configName || calendar.name || 'Unknown';
    const mode = calendar.mode || 'face-value';
    const count = calendar.events.length;

    stats.totalEvents += count;
    stats.eventsByCalendar[name] = count;
    stats.eventsByMode[mode] = (stats.eventsByMode[mode] || 0) + count;
  }

  return stats;
}

module.exports = {
  generateFeed,
  formatEventForIcs,
  dateTimeToIcsArray,
  formatSourceNote,
  formatAdjustmentAnnotation,
  mergeCalendars,
  deduplicateEvents,
  getCalendarStats
};
