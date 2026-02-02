const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const icalParser = require('../services/ical-parser');
const feedGenerator = require('../services/feed-generator');
const timezoneLogic = require('../services/timezone-logic');

const router = express.Router();

/**
 * Middleware to restrict access to localhost only
 * Used for admin endpoints that shouldn't be publicly accessible
 *
 * Strategy: If X-Forwarded-For header is present, the request came through
 * a proxy (like Cloudflare tunnel) and should be denied.
 */
function localhostOnly(req, res, next) {
  // If X-Forwarded-For is present, request came through a proxy - deny
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) {
    return res.status(403).json({
      error: 'Admin access denied',
      message: 'Admin interface is only accessible from localhost'
    });
  }

  const isLocalhost =
    req.hostname === 'localhost' ||
    req.hostname === '127.0.0.1' ||
    req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1';

  if (isLocalhost) {
    return next();
  }

  res.status(403).json({
    error: 'Admin access denied',
    message: 'Admin interface is only accessible from localhost'
  });
}

// Stale-while-revalidate cache for fetched calendars
const calendarCache = {
  data: null,
  timestamp: 0,
  refreshing: false,
  lastError: null,
  // Cache is "fresh" for 5 minutes - serve without background refresh
  freshTtlMs: 5 * 60 * 1000,
  // Cache is "stale but usable" for 30 minutes - serve immediately, refresh in background
  staleTtlMs: 30 * 60 * 1000
};

/**
 * Get cache status for debugging/status endpoints
 */
function getCacheStatus() {
  const now = Date.now();
  const age = calendarCache.timestamp ? now - calendarCache.timestamp : null;
  return {
    hasData: !!calendarCache.data,
    ageMs: age,
    ageFormatted: age ? `${Math.round(age / 1000)}s ago` : 'never',
    isFresh: age !== null && age < calendarCache.freshTtlMs,
    isStale: age !== null && age >= calendarCache.freshTtlMs && age < calendarCache.staleTtlMs,
    isExpired: age === null || age >= calendarCache.staleTtlMs,
    isRefreshing: calendarCache.refreshing,
    lastError: calendarCache.lastError
  };
}

/**
 * Trigger background refresh of calendar cache
 * Does not block - returns immediately
 */
function triggerBackgroundRefresh() {
  if (calendarCache.refreshing) {
    return; // Already refreshing
  }

  calendarCache.refreshing = true;
  console.log('[Cache] Starting background refresh...');

  fetchAllCalendars()
    .then(calendars => {
      calendarCache.data = calendars;
      calendarCache.timestamp = Date.now();
      calendarCache.lastError = null;
      console.log(`[Cache] Background refresh complete: ${calendars.length} calendars`);
    })
    .catch(err => {
      calendarCache.lastError = err.message;
      console.error('[Cache] Background refresh failed:', err.message);
    })
    .finally(() => {
      calendarCache.refreshing = false;
    });
}

/**
 * Get cached calendars using stale-while-revalidate pattern
 * - Fresh cache: return immediately
 * - Stale cache: return immediately, trigger background refresh
 * - Expired/empty cache: fetch synchronously (blocking)
 *
 * @param {boolean} forceRefresh - Bypass cache and fetch fresh (blocking)
 * @returns {Promise<Object[]>} Processed calendars
 */
async function getCachedCalendars(forceRefresh = false) {
  const now = Date.now();
  const age = calendarCache.timestamp ? now - calendarCache.timestamp : Infinity;

  // Force refresh requested - fetch synchronously
  if (forceRefresh) {
    console.log('[Cache] Force refresh requested');
    const calendars = await fetchAllCalendars();
    calendarCache.data = calendars;
    calendarCache.timestamp = Date.now();
    calendarCache.lastError = null;
    return calendars;
  }

  // Fresh cache - return immediately
  if (calendarCache.data && age < calendarCache.freshTtlMs) {
    return calendarCache.data;
  }

  // Stale cache - return immediately but trigger background refresh
  if (calendarCache.data && age < calendarCache.staleTtlMs) {
    triggerBackgroundRefresh();
    return calendarCache.data;
  }

  // Expired or empty cache - must fetch synchronously
  console.log('[Cache] Cache expired/empty, fetching synchronously...');
  const calendars = await fetchAllCalendars();
  calendarCache.data = calendars;
  calendarCache.timestamp = Date.now();
  calendarCache.lastError = null;
  return calendars;
}

/**
 * POST /feeds/refresh
 * Force refresh the calendar cache
 */
router.post('/refresh', localhostOnly, async (req, res) => {
  try {
    const startTime = Date.now();
    await getCachedCalendars(true);
    const fetchTime = Date.now() - startTime;
    res.json({
      message: 'Cache refreshed',
      fetchTimeMs: fetchTime,
      cachedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh', details: err.message });
  }
});

/**
 * Generate a token for feed URLs
 * @param {string} feedType - 'full' or 'busy'
 * @returns {string} Token
 */
function generateToken(feedType) {
  const data = `${feedType}:${config.feedSecret}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Validate a feed token
 * @param {string} token - Token to validate
 * @param {string} feedType - Expected feed type
 * @returns {boolean}
 */
function validateToken(token, feedType) {
  // Prevent timing attack via length mismatch
  if (!token || typeof token !== 'string' || token.length !== 32) {
    return false;
  }
  try {
    const expected = generateToken(feedType);
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * GET /feeds/full/:token
 * Returns the full merged calendar feed with all event details
 */
router.get('/full/:token', async (req, res) => {
  try {
    if (!validateToken(req.params.token, 'full')) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const calendars = await getCachedCalendars();
    const mergedEvents = feedGenerator.mergeCalendars(calendars);
    const icalString = await feedGenerator.generateFeed(mergedEvents, {
      calendarName: 'Personal Calendar (Full)',
      busyOnly: false
    });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(icalString);
  } catch (err) {
    console.error('Error generating full feed:', err);
    res.status(500).json({ error: 'Failed to generate feed', details: err.message });
  }
});

/**
 * GET /feeds/busy/:token
 * Returns the merged calendar feed with only busy/free status (no titles)
 */
router.get('/busy/:token', async (req, res) => {
  try {
    if (!validateToken(req.params.token, 'busy')) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const calendars = await getCachedCalendars();
    const mergedEvents = feedGenerator.mergeCalendars(calendars);
    const icalString = await feedGenerator.generateFeed(mergedEvents, {
      calendarName: 'Personal Calendar (Busy)',
      busyOnly: true
    });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="calendar-busy.ics"');
    res.send(icalString);
  } catch (err) {
    console.error('Error generating busy feed:', err);
    res.status(500).json({ error: 'Failed to generate feed', details: err.message });
  }
});

/**
 * GET /feeds/urls
 * Returns the feed URLs (for admin UI)
 */
router.get('/urls', localhostOnly, (req, res) => {
  // Use configured baseUrl if set, otherwise use request origin
  const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;
  res.json({
    full: `${baseUrl}/feeds/full/${generateToken('full')}`,
    busy: `${baseUrl}/feeds/busy/${generateToken('busy')}`,
    baseUrl: config.baseUrl || null,  // Let UI know if custom URL is configured
    isConfigured: !!config.baseUrl
  });
});

/**
 * GET /feeds/cache-status
 * Fast endpoint - returns cache status without fetching calendars
 * Used by frontend for quick loading state
 */
router.get('/cache-status', localhostOnly, (req, res) => {
  const cache = getCacheStatus();
  res.json({
    cache,
    calendarsConfigured: config.sourceCalendars.length,
    message: cache.hasData
      ? (cache.isRefreshing ? 'Refreshing in background...' : 'Ready')
      : 'No cached data - first load may be slow'
  });
});

/**
 * GET /feeds/tunnel-status
 * Test if the configured external URL (Cloudflare tunnel) is reachable
 */
router.get('/tunnel-status', localhostOnly, async (req, res) => {
  const baseUrl = config.baseUrl;

  if (!baseUrl) {
    return res.json({
      status: 'not-configured',
      message: 'No external URL configured',
      url: null
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      return res.json({
        status: 'connected',
        message: 'Tunnel is working',
        url: baseUrl
      });
    } else {
      return res.json({
        status: 'error',
        message: `Tunnel returned HTTP ${response.status}`,
        url: baseUrl
      });
    }
  } catch (err) {
    return res.json({
      status: 'disconnected',
      message: err.name === 'AbortError' ? 'Connection timeout' : err.message,
      url: baseUrl
    });
  }
});

/**
 * GET /feeds/status
 * Returns status of configured calendars with health check info
 * Uses stale-while-revalidate caching for fast responses
 */
router.get('/status', localhostOnly, async (req, res) => {
  try {
    const cacheStatus = getCacheStatus();

    // Use cached calendars (stale-while-revalidate)
    const calendars = await getCachedCalendars();

    // Build status from cached calendar data
    const statuses = config.sourceCalendars.map(calConfig => {
      const cal = calendars.find(c => c.configName === calConfig.name);
      if (cal) {
        return {
          id: calConfig.id,
          name: cal.name || calConfig.name,
          configName: calConfig.name,
          mode: calConfig.mode,
          status: 'ok',
          eventCount: cal.events.length,
          enabled: calConfig.enabled
        };
      } else {
        return {
          id: calConfig.id,
          name: calConfig.name,
          configName: calConfig.name,
          mode: calConfig.mode,
          status: 'error',
          error: 'Calendar not found in cache',
          enabled: calConfig.enabled
        };
      }
    });

    // Health check using same cached data
    const mergedEvents = feedGenerator.mergeCalendars(calendars);
    const feedHealth = {
      status: 'ok',
      message: 'Feed generation working',
      eventCount: mergedEvents.length,
      adjustedCount: mergedEvents.filter(e => e.adjustment).length
    };

    res.json({
      calendars: statuses,
      summary: {
        total: statuses.length,
        ok: statuses.filter(s => s.status === 'ok').length,
        error: statuses.filter(s => s.status === 'error').length
      },
      health: {
        feedGeneration: feedHealth,
        checkedAt: new Date().toISOString(),
        cache: cacheStatus
      }
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to get status',
      details: err.message
    });
  }
});

/**
 * GET /feeds/stats
 * Returns statistics about the merged feed
 */
router.get('/stats', localhostOnly, async (req, res) => {
  try {
    const calendars = await getCachedCalendars();
    const stats = feedGenerator.getCalendarStats(calendars);
    const mergedEvents = feedGenerator.mergeCalendars(calendars);

    res.json({
      ...stats,
      mergedEventCount: mergedEvents.length,
      defaultTimezone: config.defaultTimezone
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});

/**
 * GET /feeds/preview
 * Returns a preview of upcoming events with adjustment details
 */
router.get('/preview', localhostOnly, async (req, res) => {
  try {
    const calendars = await getCachedCalendars();
    const mergedEvents = feedGenerator.mergeCalendars(calendars);

    const now = Date.now();

    // Filter for upcoming events (starting from now), sort by start time
    const upcomingEvents = mergedEvents
      .filter(e => e.start && e.start.toJSDate && e.start.toMillis() >= now)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis())
      .slice(0, 20);

    // Count adjusted events
    const adjustedCount = mergedEvents.filter(e => e.adjustment).length;

    const preview = upcomingEvents.map(event => ({
      summary: event.summary,
      start: event.start.toISO(),
      end: event.end.toISO(),
      isAllDay: event.isAllDay,
      timezone: event.timezone,
      location: event.location,
      sourceCalendar: event.sourceCalendar,
      sourceCalendarMode: event.sourceCalendarMode,
      adjustment: event.adjustment ? {
        hoursAdjusted: event.adjustment.hoursAdjusted,
        basis: event.adjustment.basis,
        originalTimezone: event.adjustment.originalTimezone
      } : null
    }));

    res.json({
      events: preview,
      total: mergedEvents.length,
      upcomingCount: upcomingEvents.length,
      adjustedCount,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error generating preview:', err);
    res.status(500).json({ error: 'Failed to generate preview', details: err.message });
  }
});

/**
 * Fetch, parse, and process all configured calendars with timezone logic
 * Fetches all calendars in parallel for speed
 * @returns {Promise<Object[]>} Array of processed calendars
 */
async function fetchAllCalendars() {
  const startTime = Date.now();
  // Cache the calendars array to avoid re-reading the file during iteration
  const calendarsToFetch = config.sourceCalendars;
  console.log(`[Fetch] Fetching ${calendarsToFetch.length} calendars in parallel...`);

  // Fetch all calendars in parallel
  const results = await Promise.allSettled(
    calendarsToFetch.map(async (calendarConfig) => {
      const calStart = Date.now();
      try {
        const parsed = await icalParser.fetchAndParse(calendarConfig.url);

        // Use configured name for the calendar (not the iCal file's name)
        parsed.name = calendarConfig.name;

        // Apply timezone logic based on calendar mode
        // sourceTimezone overrides the detected X-WR-TIMEZONE if set
        const processed = await timezoneLogic.processCalendar(parsed, {
          mode: calendarConfig.mode,
          sourceTimezone: calendarConfig.sourceTimezone  // Override for UTC event handling
        });

        processed.mode = calendarConfig.mode;
        processed.configName = calendarConfig.name;
        processed.fetchTimeMs = Date.now() - calStart;

        console.log(`[Fetch] ✓ ${calendarConfig.name}: ${processed.events.length} events in ${processed.fetchTimeMs}ms`);
        return processed;
      } catch (err) {
        console.error(`[Fetch] ✗ ${calendarConfig.name}: ${err.message}`);
        throw err;
      }
    })
  );

  // Collect successful results
  const calendars = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const failedCount = results.filter(r => r.status === 'rejected').length;
  const totalTime = Date.now() - startTime;

  console.log(`[Fetch] Complete: ${calendars.length} calendars fetched, ${failedCount} failed, ${totalTime}ms total`);

  return calendars;
}

module.exports = router;
module.exports.generateToken = generateToken;
