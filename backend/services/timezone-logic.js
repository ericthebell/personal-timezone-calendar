const { DateTime } = require('luxon');
const geocoding = require('./geocoding');
const config = require('../config');

/**
 * Reinterpret a DateTime in a new timezone, preserving the wall-clock time.
 * For example: 2pm PST becomes 2pm EST (not 5pm EST)
 *
 * @param {DateTime} dt - Original DateTime
 * @param {string} newTimezone - Target timezone (IANA format)
 * @returns {DateTime} New DateTime with same wall-clock time but different timezone
 */
function reinterpretTimezone(dt, newTimezone) {
  // Extract the wall-clock time components
  const { year, month, day, hour, minute, second, millisecond } = dt;

  // Create new DateTime with same components but different timezone
  return DateTime.fromObject(
    { year, month, day, hour, minute, second, millisecond },
    { zone: newTimezone }
  );
}

/**
 * Convert a UTC-stored event to its intended wall-clock time in the default location timezone.
 *
 * When Google Calendar stores an event, it often encodes the local time as UTC.
 * For example: You create a 10am event, Google stores it as UTC.
 * This function recovers the intended wall-clock time by converting UTC to the default location timezone.
 *
 * In the simplified model, the user enters events as the wall-clock time for wherever they will
 * physically be. The default location represents "my local time" - the timezone used to interpret
 * stored times.
 *
 * @param {DateTime} utcDt - DateTime in UTC
 * @param {string} defaultTimezone - The default location timezone (from global settings)
 * @returns {DateTime} DateTime representing the intended wall-clock time in the default timezone
 */
function convertUtcToDefaultTimezone(utcDt, defaultTimezone) {
  // setZone converts the instant to the target timezone (changes wall-clock time)
  return utcDt.setZone(defaultTimezone);
}

/**
 * Calculate the hour difference between two timezones at a specific moment
 * @param {DateTime} dt - The moment in time
 * @param {string} fromTz - Source timezone
 * @param {string} toTz - Target timezone
 * @returns {number} Hours difference (positive = later in target)
 */
function getTimezoneOffset(dt, fromTz, toTz) {
  const inFrom = dt.setZone(fromTz);
  const inTo = dt.setZone(toTz);

  // Calculate offset difference in hours
  return (inTo.offset - inFrom.offset) / 60;
}

/**
 * Calculate the subscriber time shift - how much earlier/later the event appears
 * to someone subscribing to the output feed.
 *
 * When we reinterpret a time from one timezone to another (preserving wall-clock),
 * the event's absolute position in time changes. This function returns how that
 * affects what the subscriber sees.
 *
 * Example: 2pm PST reinterpreted as 2pm EST
 * - 2pm PST = 10pm UTC (original)
 * - 2pm EST = 7pm UTC (reinterpreted)
 * - The event now occurs 3 hours EARLIER in absolute time
 * - Returns: -3 (negative = event moved earlier)
 *
 * @param {DateTime} dt - The moment in time
 * @param {string} fromTz - Original timezone
 * @param {string} toTz - Target timezone after reinterpretation
 * @returns {number} Hours shift (negative = event appears earlier, positive = later)
 */
function getSubscriberTimeShift(dt, fromTz, toTz) {
  // The reinterpreted time has the same wall-clock but different timezone
  // The absolute time change is the negative of the offset difference
  // PST→EST: EST is 3h ahead, so reinterpreted time is 3h earlier → -3
  return -getTimezoneOffset(dt, fromTz, toTz);
}

/**
 * Find umbrella events (multi-day events with locations) that cover a given time
 * @param {Object[]} allEvents - All events from the calendar
 * @param {DateTime} targetTime - The time to check
 * @param {Object} excludeEvent - Event to exclude from umbrella candidates (to prevent self-reference)
 * @returns {Object|null} The umbrella event if found, null otherwise
 */
function findUmbrellaEvent(allEvents, targetTime, excludeEvent = null) {
  for (const event of allEvents) {
    // Skip the event being processed to prevent self-reference
    if (excludeEvent && event.uid && event.uid === excludeEvent.uid) continue;

    // Must be a multi-day event (spans more than 1 day)
    if (!isMultiDayEvent(event)) continue;

    // Must have a location
    if (!event.location) continue;

    // Check if target time falls within this event
    if (targetTime >= event.start && targetTime <= event.end) {
      return event;
    }
  }

  return null;
}

/**
 * Check if an event spans multiple days
 * @param {Object} event - Event object
 * @returns {boolean}
 */
function isMultiDayEvent(event) {
  if (!event.start || !event.end) return false;

  // For all-day events, check if more than 1 day
  if (event.isAllDay) {
    const days = event.end.diff(event.start, 'days').days;
    return days > 1;
  }

  // For timed events, check if end is on a different day
  return event.start.toISODate() !== event.end.toISODate();
}

/**
 * Apply timezone logic to an event based on mode and location
 *
 * In personal-timezone mode, events are REINTERPRETED from their stored timezone
 * to the target timezone (Default Location or umbrella event location).
 * This preserves wall-clock time while changing the timezone.
 *
 * Example: 3pm Pacific → 3pm Eastern (wall-clock preserved, timezone changes)
 *
 * The calendar's timezone is a placeholder for "my local time wherever I am".
 * When you write "3pm" on your calendar, you mean "3pm wherever I physically am".
 *
 * @param {Object} event - The event to process
 * @param {Object} options - Processing options
 * @param {string} options.mode - 'face-value' or 'personal-timezone'
 * @param {string} options.calendarTimezone - iCal timezone from the source calendar
 * @param {string} options.calendarName - Name of the source calendar
 * @param {Object[]} options.allEvents - All events (for umbrella detection)
 * @returns {Promise<Object>} Processed event with potential timezone adjustment
 */
async function processEvent(event, options) {
  const { mode, calendarName, calendarTimezone, allEvents = [] } = options;

  // Face-value mode: no adjustment
  if (mode === 'face-value') {
    return {
      ...event,
      sourceCalendar: calendarName
    };
  }

  // Personal-timezone mode: reinterpret to target timezone (wall-clock preserved)
  let workingEvent = { ...event };

  // Step 1: For UTC-stored events, first convert to calendar timezone
  // This recovers the intended wall-clock time that was entered
  // Example: Event stored as UTC 16:00, calendar TZ is Pacific → becomes 8am Pacific
  if (workingEvent.wasStoredAsUtc && calendarTimezone && calendarTimezone !== 'UTC') {
    // Convert UTC → calendar timezone (absolute time preserved, wall-clock changes)
    workingEvent.start = workingEvent.start.setZone(calendarTimezone);
    workingEvent.end = workingEvent.end.setZone(calendarTimezone);
    workingEvent.timezone = calendarTimezone;
  }

  // Step 2: Determine target timezone: umbrella event > global default location > event's own timezone
  // Pass the event to exclude it from umbrella candidates (prevent self-reference)
  const targetTimezone = await determineEventTimezone(workingEvent, allEvents, workingEvent);

  // If no target timezone determined (no default location set), keep event as-is
  if (!targetTimezone || targetTimezone === 'UTC') {
    return {
      ...workingEvent,
      sourceCalendar: calendarName
    };
  }

  // If source and target are same, no conversion needed
  if (targetTimezone === workingEvent.timezone) {
    return {
      ...workingEvent,
      sourceCalendar: calendarName
    };
  }

  // Reinterpret to target timezone (preserves wall-clock time, changes timezone)
  // e.g., 3pm Pacific → 3pm Eastern (wall-clock preserved)
  const convertedStart = reinterpretTimezone(workingEvent.start, targetTimezone);
  const convertedEnd = reinterpretTimezone(workingEvent.end, targetTimezone);

  // Calculate the subscriber time shift (how much earlier/later the event appears in absolute time)
  const shiftHours = getSubscriberTimeShift(workingEvent.start, workingEvent.timezone, targetTimezone);
  const basis = await getAdjustmentBasis(workingEvent, allEvents, workingEvent);

  return {
    ...workingEvent,
    start: convertedStart,
    end: convertedEnd,
    timezone: targetTimezone,
    sourceCalendar: calendarName,
    adjustment: {
      sourceCalendar: calendarName,
      hoursAdjusted: shiftHours,
      basis,
      originalTimezone: workingEvent.original?.timezone || workingEvent.timezone,
      sourceTimezone: workingEvent.timezone,
      targetTimezone
    }
  };
}

/**
 * Get the timezone for the global default location setting
 * @returns {Promise<string|null>} Timezone string or null if not configured
 */
async function getDefaultLocationTimezone() {
  const globalDefaultLocation = config.defaultLocation;
  if (globalDefaultLocation) {
    const locationTimezone = await geocoding.getTimezoneForLocation(globalDefaultLocation);
    if (locationTimezone) {
      return locationTimezone;
    }
  }
  return null;
}

/**
 * Determine what timezone an event should be in
 * Priority: 1. Umbrella event location, 2. Global default location, 3. null (no conversion)
 *
 * In the simplified model, there are no per-calendar timezone settings.
 * All timezone logic is based on umbrella events (travel) and the global default location.
 *
 * @param {Object} event - The event
 * @param {Object[]} allEvents - All events for umbrella detection
 * @param {Object} excludeEvent - Event to exclude from umbrella detection (prevent self-reference)
 * @returns {Promise<string|null>} Target timezone or null if no conversion needed
 */
async function determineEventTimezone(event, allEvents, excludeEvent = null) {
  // Check for umbrella event (travel/location override)
  const umbrella = findUmbrellaEvent(allEvents, event.start, excludeEvent);
  if (umbrella && umbrella.location) {
    const umbrellaTimezone = await geocoding.getTimezoneForLocation(umbrella.location);
    if (umbrellaTimezone) {
      return umbrellaTimezone;
    }
  }

  // Fall back to global default location setting
  const globalDefaultLocation = config.defaultLocation;
  if (globalDefaultLocation) {
    const locationTimezone = await geocoding.getTimezoneForLocation(globalDefaultLocation);
    if (locationTimezone) {
      return locationTimezone;
    }
  }

  // No target timezone - will keep event in original timezone
  return null;
}

/**
 * Get a human-readable description of why the timezone was adjusted
 * @param {Object} event - The event
 * @param {Object[]} allEvents - All events for umbrella detection
 * @param {Object} excludeEvent - Event to exclude from umbrella detection
 * @returns {Promise<string>} Adjustment basis description
 */
async function getAdjustmentBasis(event, allEvents, excludeEvent = null) {
  // Check for umbrella event first
  const umbrella = findUmbrellaEvent(allEvents, event.start, excludeEvent);
  if (umbrella && umbrella.location) {
    const umbrellaTimezone = await geocoding.getTimezoneForLocation(umbrella.location);
    if (umbrellaTimezone) {
      return `umbrella event: "${umbrella.summary}" (${umbrella.location})`;
    }
  }

  // Check for global default location
  const globalDefaultLocation = config.defaultLocation;
  if (globalDefaultLocation) {
    const locationTimezone = await geocoding.getTimezoneForLocation(globalDefaultLocation);
    if (locationTimezone) {
      return `default location (${globalDefaultLocation})`;
    }
  }

  return `no conversion`;
}

/**
 * Process all events from a calendar with timezone logic
 * @param {Object} calendar - Parsed calendar object
 * @param {Object} options - Processing options
 * @param {string} options.mode - 'face-value' or 'personal-timezone'
 * @param {string} options.sourceTimezone - Optional override for calendar's X-WR-TIMEZONE
 * @returns {Promise<Object>} Calendar with processed events
 */
async function processCalendar(calendar, options) {
  // Check once per calendar if default location is missing for personal-timezone mode
  if (options.mode === 'personal-timezone' && !config.defaultLocation) {
    console.warn(`[${calendar.name}] Personal-timezone mode but no Default Location set - using UTC fallback`);
  }

  // Use sourceTimezone override if provided, otherwise use detected calendar timezone
  const effectiveCalendarTimezone = options.sourceTimezone || calendar.timezone;

  const processedEvents = [];

  for (const event of calendar.events) {
    const processed = await processEvent(event, {
      ...options,
      calendarTimezone: effectiveCalendarTimezone,
      calendarName: calendar.name,
      allEvents: calendar.events
    });
    processedEvents.push(processed);
  }

  return {
    ...calendar,
    events: processedEvents
  };
}

module.exports = {
  reinterpretTimezone,
  getTimezoneOffset,
  getSubscriberTimeShift,
  convertUtcToDefaultTimezone,
  findUmbrellaEvent,
  isMultiDayEvent,
  processEvent,
  determineEventTimezone,
  getAdjustmentBasis,
  getDefaultLocationTimezone,
  processCalendar
};
