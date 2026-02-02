const express = require('express');
const config = require('../config');
const icalParser = require('../services/ical-parser');

const router = express.Router();

/**
 * GET /calendars
 * List all configured calendars
 */
router.get('/', (req, res) => {
  const calendars = config.loadCalendars();

  // Don't expose full URLs in the response for security
  const safeCalendars = calendars.map(cal => ({
    id: cal.id,
    name: cal.name,
    mode: cal.mode,
    sourceTimezone: cal.sourceTimezone || null,
    enabled: cal.enabled,
    createdAt: cal.createdAt,
    urlPreview: cal.url ? cal.url.substring(0, 50) + '...' : null
  }));

  res.json({ calendars: safeCalendars });
});

/**
 * POST /calendars
 * Add a new calendar
 */
router.post('/', async (req, res) => {
  const { url, name, mode } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate the URL by trying to fetch it
  try {
    const parsed = await icalParser.fetchAndParse(url);

    const calendar = config.addCalendar({
      url,
      name: name || parsed.name || 'Unnamed Calendar',
      mode: mode || 'face-value'
    });

    res.status(201).json({
      message: 'Calendar added successfully',
      calendar: {
        id: calendar.id,
        name: calendar.name,
        mode: calendar.mode,
        enabled: calendar.enabled,
        eventCount: parsed.events.length
      }
    });
  } catch (err) {
    res.status(400).json({
      error: 'Failed to fetch calendar',
      details: err.message
    });
  }
});

/**
 * GET /calendars/:id
 * Get a specific calendar
 */
router.get('/:id', (req, res) => {
  const calendar = config.getCalendar(req.params.id);

  if (!calendar) {
    return res.status(404).json({ error: 'Calendar not found' });
  }

  res.json({
    id: calendar.id,
    name: calendar.name,
    mode: calendar.mode,
    sourceTimezone: calendar.sourceTimezone || null,
    enabled: calendar.enabled,
    createdAt: calendar.createdAt,
    urlPreview: calendar.url ? calendar.url.substring(0, 50) + '...' : null
  });
});

/**
 * PATCH /calendars/:id
 * Update a calendar's settings
 */
router.patch('/:id', (req, res) => {
  const { name, mode, sourceTimezone, enabled } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (mode !== undefined) {
    if (!['face-value', 'personal-timezone'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be "face-value" or "personal-timezone"' });
    }
    updates.mode = mode;
  }
  if (sourceTimezone !== undefined) {
    if (sourceTimezone !== null && sourceTimezone !== '') {
      if (!config.isValidTimezone(sourceTimezone)) {
        return res.status(400).json({ error: 'Invalid timezone. Must be a valid IANA timezone.' });
      }
      updates.sourceTimezone = sourceTimezone;
    } else {
      updates.sourceTimezone = null;  // Clear to auto-detect
    }
  }
  if (enabled !== undefined) updates.enabled = Boolean(enabled);

  const updated = config.updateCalendar(req.params.id, updates);

  if (!updated) {
    return res.status(404).json({ error: 'Calendar not found' });
  }

  res.json({
    message: 'Calendar updated successfully',
    calendar: {
      id: updated.id,
      name: updated.name,
      mode: updated.mode,
      sourceTimezone: updated.sourceTimezone || null,
      enabled: updated.enabled
    }
  });
});

/**
 * DELETE /calendars/:id
 * Remove a calendar
 */
router.delete('/:id', (req, res) => {
  const removed = config.removeCalendar(req.params.id);

  if (!removed) {
    return res.status(404).json({ error: 'Calendar not found' });
  }

  res.json({ message: 'Calendar removed successfully' });
});

/**
 * POST /calendars/:id/test
 * Test fetching a calendar
 */
router.post('/:id/test', async (req, res) => {
  const calendar = config.getCalendar(req.params.id);

  if (!calendar) {
    return res.status(404).json({ error: 'Calendar not found' });
  }

  try {
    const parsed = await icalParser.fetchAndParse(calendar.url);

    res.json({
      status: 'ok',
      name: parsed.name,
      timezone: parsed.timezone,
      eventCount: parsed.events.length,
      sampleEvents: parsed.events.slice(0, 3).map(e => ({
        summary: e.summary,
        start: e.start.toISO(),
        location: e.location
      }))
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

/**
 * POST /calendars/validate
 * Validate a calendar URL before adding
 */
router.post('/validate', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const parsed = await icalParser.fetchAndParse(url);

    res.json({
      valid: true,
      name: parsed.name,
      timezone: parsed.timezone,
      eventCount: parsed.events.length
    });
  } catch (err) {
    res.json({
      valid: false,
      error: err.message
    });
  }
});

module.exports = router;
