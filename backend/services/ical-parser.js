const ICAL = require('ical.js');
const { DateTime } = require('luxon');
const config = require('../config');

/**
 * Validate a URL for SSRF protection
 * Blocks private IPs, localhost, and non-http(s) protocols
 * @param {string} urlString - The URL to validate
 * @throws {Error} If URL is invalid or points to internal resources
 */
function validateUrlForSsrf(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  // Only allow http and https protocols
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('Localhost URLs are not allowed');
  }

  // Block private IP ranges and special addresses
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);
  if (match) {
    const [, a, b, c, d] = match.map(Number);

    // 10.0.0.0/8 - Private
    if (a === 10) {
      throw new Error('Private IP addresses are not allowed');
    }
    // 172.16.0.0/12 - Private
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error('Private IP addresses are not allowed');
    }
    // 192.168.0.0/16 - Private
    if (a === 192 && b === 168) {
      throw new Error('Private IP addresses are not allowed');
    }
    // 127.0.0.0/8 - Loopback
    if (a === 127) {
      throw new Error('Loopback addresses are not allowed');
    }
    // 169.254.0.0/16 - Link-local (includes AWS metadata 169.254.169.254)
    if (a === 169 && b === 254) {
      throw new Error('Link-local and cloud metadata addresses are not allowed');
    }
    // 0.0.0.0/8 - Current network
    if (a === 0) {
      throw new Error('Invalid IP address');
    }
  }

  return parsed;
}

/**
 * Fetch and parse an iCal feed from a URL
 * @param {string} url - The iCal feed URL
 * @returns {Promise<Object>} Parsed calendar data
 */
async function fetchAndParse(url) {
  // Validate URL before fetching (SSRF protection)
  validateUrlForSsrf(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PersonalTimezoneCalendar/1.0'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
    }

    // Limit response size (5MB max)
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
      throw new Error('Calendar file too large (max 5MB)');
    }

    const icalData = await response.text();

    // Double-check size after fetching (in case Content-Length was missing/wrong)
    if (icalData.length > 5 * 1024 * 1024) {
      throw new Error('Calendar file too large (max 5MB)');
    }

    return parseIcalString(icalData);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse an iCal string into structured event data
 * @param {string} icalString - Raw iCal data
 * @returns {Object} Parsed calendar with events
 */
function parseIcalString(icalString) {
  const jcalData = ICAL.parse(icalString);
  const vcalendar = new ICAL.Component(jcalData);

  // Get calendar timezone if specified
  const vtimezone = vcalendar.getFirstSubcomponent('vtimezone');
  const calendarTimezone = vtimezone ? vtimezone.getFirstPropertyValue('tzid') : null;

  // Get calendar name
  const calendarName = vcalendar.getFirstPropertyValue('x-wr-calname') || 'Unnamed Calendar';

  // Calculate date range for filtering
  const now = DateTime.now();
  const startDate = now.minus({ months: config.monthsToFetch });
  const endDate = now.plus({ months: config.monthsToFetch });

  // Parse events, expanding recurring events
  const events = expandRecurringEvents(vcalendar, calendarTimezone, startDate, endDate);

  return {
    name: calendarName,
    timezone: calendarTimezone,
    events: events.sort((a, b) => a.start.toMillis() - b.start.toMillis())
  };
}

/**
 * Parse a single VEVENT component into structured data
 * @param {ICAL.Component} vevent - The VEVENT component
 * @param {string|null} calendarTimezone - Default timezone from calendar
 * @returns {Object|null} Parsed event or null if invalid
 */
function parseEvent(vevent, calendarTimezone) {
  try {
    const icalEvent = new ICAL.Event(vevent);

    // Get start and end times
    const startDate = icalEvent.startDate;
    const endDate = icalEvent.endDate;

    if (!startDate) return null;

    // Determine the timezone for this event
    // Priority: 1. Event's explicit TZID, 2. Zone tzid (for UTC times), 3. Calendar default, 4. UTC
    // Note: startDate.timezone is undefined for UTC times, but startDate.zone.tzid is "UTC"
    // Note: "floating" means local time (no timezone) - use calendar default for these
    const zoneTzid = startDate.zone?.tzid;
    const effectiveZoneTzid = (zoneTzid && zoneTzid !== 'floating') ? zoneTzid : null;
    const eventTimezone = startDate.timezone || effectiveZoneTzid || calendarTimezone || 'UTC';

    // Track if event was stored as UTC (important for timezone reinterpretation)
    // Events stored as UTC (e.g., DTSTART:20260106T180000Z) need special handling
    // because the UTC time is an encoding of the intended local time, not literal UTC
    const wasStoredAsUtc = zoneTzid === 'UTC' && !startDate.timezone;

    // Convert to Luxon DateTime for easier manipulation
    const start = icalDateToLuxon(startDate, eventTimezone);
    const end = endDate ? icalDateToLuxon(endDate, eventTimezone) : start.plus({ hours: 1 });

    // Check if this is an all-day event
    const isAllDay = startDate.isDate;

    // Get location if present
    const location = icalEvent.location || null;

    // Get recurrence info
    const isRecurring = icalEvent.isRecurring();
    const recurrenceId = vevent.getFirstPropertyValue('recurrence-id');

    return {
      uid: icalEvent.uid,
      summary: icalEvent.summary || 'Untitled Event',
      description: icalEvent.description || '',
      start,
      end,
      isAllDay,
      location,
      timezone: eventTimezone,
      wasStoredAsUtc,  // Flag for UTC-stored events needing special timezone handling
      isRecurring,
      recurrenceId: recurrenceId ? recurrenceId.toString() : null,
      // Store original values for annotation later
      original: {
        startTime: start.toFormat('HH:mm'),
        startDate: start.toFormat('yyyy-MM-dd'),
        timezone: eventTimezone
      }
    };
  } catch (err) {
    console.error('Error parsing event:', err.message);
    return null;
  }
}

/**
 * Convert an ICAL.Time to a Luxon DateTime
 * @param {ICAL.Time} icalTime - The ICAL time object
 * @param {string} timezone - The timezone to use
 * @returns {DateTime} Luxon DateTime
 */
function icalDateToLuxon(icalTime, timezone) {
  if (icalTime.isDate) {
    // All-day event - no time component
    return DateTime.fromObject(
      {
        year: icalTime.year,
        month: icalTime.month,
        day: icalTime.day
      },
      { zone: timezone }
    );
  }

  return DateTime.fromObject(
    {
      year: icalTime.year,
      month: icalTime.month,
      day: icalTime.day,
      hour: icalTime.hour,
      minute: icalTime.minute,
      second: icalTime.second
    },
    { zone: timezone }
  );
}

/**
 * Check if an event falls within a date range
 * @param {Object} event - Parsed event object
 * @param {DateTime} startDate - Range start
 * @param {DateTime} endDate - Range end
 * @returns {boolean}
 */
function isEventInRange(event, startDate, endDate) {
  // Event is in range if it ends after range start and starts before range end
  return event.end >= startDate && event.start <= endDate;
}

/**
 * Expand recurring events into individual occurrences within a date range
 * @param {ICAL.Component} vcalendar - The VCALENDAR component
 * @param {string|null} calendarTimezone - Default timezone from calendar
 * @param {DateTime} startDate - Range start (Luxon)
 * @param {DateTime} endDate - Range end (Luxon)
 * @returns {Object[]} Array of parsed events including expanded occurrences
 */
function expandRecurringEvents(vcalendar, calendarTimezone, startDate, endDate) {
  const events = [];
  const vevents = vcalendar.getAllSubcomponents('vevent');

  // Convert Luxon dates to ICAL.Time for comparison
  const rangeStart = ICAL.Time.fromJSDate(startDate.toJSDate());
  const rangeEnd = ICAL.Time.fromJSDate(endDate.toJSDate());

  // Track exception dates (EXDATE) and modified occurrences (RECURRENCE-ID)
  const exceptionMap = new Map(); // uid -> Set of excluded date strings
  const modifiedOccurrences = new Map(); // uid+date -> vevent

  // First pass: collect exceptions and modified occurrences
  for (const vevent of vevents) {
    const uid = vevent.getFirstPropertyValue('uid');
    const recurrenceId = vevent.getFirstPropertyValue('recurrence-id');

    if (recurrenceId) {
      // This is a modified occurrence of a recurring event
      const key = `${uid}|${recurrenceId.toString()}`;
      modifiedOccurrences.set(key, vevent);
    }
  }

  // Second pass: process events
  for (const vevent of vevents) {
    const recurrenceId = vevent.getFirstPropertyValue('recurrence-id');

    // Skip modified occurrences in this pass (they'll replace generated ones)
    if (recurrenceId) continue;

    try {
      const icalEvent = new ICAL.Event(vevent);
      const uid = icalEvent.uid;

      if (icalEvent.isRecurring()) {
        // Expand recurring event
        const iterator = icalEvent.iterator();
        let next;
        let count = 0;
        const maxOccurrences = 500; // Safety limit

        while ((next = iterator.next()) && count < maxOccurrences) {
          // Stop if we're past the range
          if (next.compare(rangeEnd) > 0) break;

          // Skip if before range
          if (next.compare(rangeStart) < 0) continue;

          count++;

          // Check if this occurrence has been modified
          const occurrenceKey = `${uid}|${next.toString()}`;
          const modifiedVevent = modifiedOccurrences.get(occurrenceKey);

          if (modifiedVevent) {
            // Use the modified version
            const event = parseEvent(modifiedVevent, calendarTimezone);
            if (event) {
              event.isRecurringInstance = true;
              event.masterUid = uid;
              events.push(event);
            }
          } else {
            // Generate occurrence from master event
            const occurrence = icalEvent.getOccurrenceDetails(next);
            const event = parseOccurrence(occurrence, calendarTimezone, icalEvent);
            if (event) {
              events.push(event);
            }
          }
        }
      } else {
        // Non-recurring event
        const event = parseEvent(vevent, calendarTimezone);
        if (event && isEventInRange(event, startDate, endDate)) {
          events.push(event);
        }
      }
    } catch (err) {
      console.error('Error processing event:', err.message);
    }
  }

  return events;
}

/**
 * Parse an occurrence of a recurring event
 * @param {Object} occurrence - Occurrence details from ical.js
 * @param {string|null} calendarTimezone - Default timezone
 * @param {ICAL.Event} masterEvent - The master recurring event
 * @returns {Object|null} Parsed event
 */
function parseOccurrence(occurrence, calendarTimezone, masterEvent) {
  try {
    const startDate = occurrence.startDate;
    const endDate = occurrence.endDate;

    if (!startDate) return null;

    // Same fix as parseEvent: check zone.tzid for UTC times, skip "floating"
    const zoneTzid = startDate.zone?.tzid;
    const effectiveZoneTzid = (zoneTzid && zoneTzid !== 'floating') ? zoneTzid : null;
    const eventTimezone = startDate.timezone || effectiveZoneTzid || calendarTimezone || 'UTC';

    // Track if event was stored as UTC (same as parseEvent)
    const wasStoredAsUtc = zoneTzid === 'UTC' && !startDate.timezone;

    const start = icalDateToLuxon(startDate, eventTimezone);
    const end = endDate ? icalDateToLuxon(endDate, eventTimezone) : start.plus({ hours: 1 });

    const isAllDay = startDate.isDate;
    const location = masterEvent.location || null;

    return {
      uid: `${masterEvent.uid}_${startDate.toString()}`,
      summary: masterEvent.summary || 'Untitled Event',
      description: masterEvent.description || '',
      start,
      end,
      isAllDay,
      location,
      timezone: eventTimezone,
      wasStoredAsUtc,  // Flag for UTC-stored events needing special timezone handling
      isRecurring: true,
      isRecurringInstance: true,
      masterUid: masterEvent.uid,
      original: {
        startTime: start.toFormat('HH:mm'),
        startDate: start.toFormat('yyyy-MM-dd'),
        timezone: eventTimezone
      }
    };
  } catch (err) {
    console.error('Error parsing occurrence:', err.message);
    return null;
  }
}

module.exports = {
  fetchAndParse,
  parseIcalString,
  parseEvent,
  parseOccurrence,
  icalDateToLuxon,
  isEventInRange,
  expandRecurringEvents
};
