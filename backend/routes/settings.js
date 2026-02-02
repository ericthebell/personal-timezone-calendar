const express = require('express');
const config = require('../config');
const geocoding = require('../services/geocoding');

const router = express.Router();

/**
 * GET /settings
 * Returns current settings
 */
router.get('/', (req, res) => {
  const settings = config.loadSettings();

  // Don't expose feedSecret or defaultTimezone (timezone is per-calendar)
  const { feedSecret, defaultTimezone, ...safeSettings } = settings;

  res.json({
    ...safeSettings,
    // Include defaultLocation explicitly (it's already in safeSettings, but be explicit)
    defaultLocation: settings.defaultLocation || null,
    hasFeedSecret: !!feedSecret && feedSecret !== 'change-me-in-production'
  });
});

/**
 * GET /settings/timezones
 * Returns list of common timezones for selection
 */
router.get('/timezones', (req, res) => {
  res.json({
    timezones: config.getCommonTimezones()
  });
});

/**
 * GET /settings/locations
 * Returns list of common locations with their timezones for Default Location selection
 */
router.get('/locations', (req, res) => {
  // Common cities organized by timezone
  const locations = [
    // US - Pacific
    { location: 'Los Angeles, California', timezone: 'America/Los_Angeles' },
    { location: 'San Francisco, California', timezone: 'America/Los_Angeles' },
    { location: 'Seattle, Washington', timezone: 'America/Los_Angeles' },
    // US - Mountain
    { location: 'Denver, Colorado', timezone: 'America/Denver' },
    { location: 'Phoenix, Arizona', timezone: 'America/Phoenix' },
    // US - Central
    { location: 'Chicago, Illinois', timezone: 'America/Chicago' },
    { location: 'Dallas, Texas', timezone: 'America/Chicago' },
    { location: 'Austin, Texas', timezone: 'America/Chicago' },
    // US - Eastern
    { location: 'New York, New York', timezone: 'America/New_York' },
    { location: 'Boston, Massachusetts', timezone: 'America/New_York' },
    { location: 'Miami, Florida', timezone: 'America/New_York' },
    { location: 'Detroit, Michigan', timezone: 'America/Detroit' },
    { location: 'Atlanta, Georgia', timezone: 'America/New_York' },
    // Europe
    { location: 'London, UK', timezone: 'Europe/London' },
    { location: 'Paris, France', timezone: 'Europe/Paris' },
    { location: 'Berlin, Germany', timezone: 'Europe/Berlin' },
    { location: 'Amsterdam, Netherlands', timezone: 'Europe/Amsterdam' },
    // Asia
    { location: 'Tokyo, Japan', timezone: 'Asia/Tokyo' },
    { location: 'Singapore', timezone: 'Asia/Singapore' },
    { location: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
    { location: 'Sydney, Australia', timezone: 'Australia/Sydney' },
  ];

  res.json({ locations });
});

/**
 * POST /settings/validate-timezone
 * Validates a timezone string
 */
router.post('/validate-timezone', (req, res) => {
  const { timezone } = req.body;

  if (!timezone) {
    return res.status(400).json({ error: 'Timezone is required' });
  }

  const isValid = config.isValidTimezone(timezone);

  res.json({
    timezone,
    valid: isValid,
    message: isValid ? 'Valid IANA timezone' : 'Invalid timezone identifier'
  });
});

/**
 * PATCH /settings
 * Update settings
 */
router.patch('/', (req, res) => {
  try {
    const allowedUpdates = ['monthsToFetch', 'baseUrl', 'defaultLocation'];
    const updates = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'No valid settings provided',
        allowedSettings: allowedUpdates
      });
    }

    const updated = config.updateSettings(updates);

    // Don't expose feedSecret
    const { feedSecret, ...safeSettings } = updated;

    res.json({
      message: 'Settings updated successfully',
      settings: safeSettings
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /settings/validate-location
 * Validates a location string by attempting to geocode it
 * Returns the inferred timezone if successful
 */
router.post('/validate-location', async (req, res) => {
  const { location } = req.body;

  if (!location) {
    return res.status(400).json({ error: 'Location is required' });
  }

  if (typeof location !== 'string' || location.trim().length < 2) {
    return res.status(400).json({
      location,
      valid: false,
      message: 'Location must be at least 2 characters'
    });
  }

  try {
    const timezone = await geocoding.getTimezoneForLocation(location.trim());

    if (timezone) {
      res.json({
        location: location.trim(),
        valid: true,
        timezone,
        message: `Location resolved to timezone: ${timezone}`
      });
    } else {
      res.json({
        location: location.trim(),
        valid: false,
        timezone: null,
        message: 'Could not determine timezone for this location'
      });
    }
  } catch (err) {
    res.status(500).json({
      location: location.trim(),
      valid: false,
      error: err.message
    });
  }
});

/**
 * POST /settings/feed-secret/regenerate
 * Regenerate the feed secret with a new secure random value
 * This invalidates all existing feed URLs
 */
router.post('/feed-secret/regenerate', (req, res) => {
  try {
    config.regenerateFeedSecret();

    res.json({
      message: 'Feed secret regenerated. Your feed URLs have changed.',
      warning: 'You will need to re-subscribe to your calendar feeds with the new URLs.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
