require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IANAZone } = require('luxon');

// Path to configuration files
const calendarsConfigPath = path.join(__dirname, 'calendars.json');
const settingsConfigPath = path.join(__dirname, 'settings.json');

/**
 * Generate a secure random secret
 * @returns {string} 32-character hex string
 */
function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Default settings
const DEFAULT_SETTINGS = {
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
  defaultLocation: process.env.DEFAULT_LOCATION || null,  // Location string for timezone inference (e.g., "New York, USA")
  feedSecret: process.env.FEED_SECRET || null,  // null means auto-generate
  monthsToFetch: 3,
  baseUrl: process.env.BASE_URL || ''  // Empty means use request origin
};

/**
 * Validate that a timezone string is a valid IANA timezone
 * @param {string} timezone - Timezone to validate
 * @returns {boolean}
 */
function isValidTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') return false;
  return IANAZone.isValidZone(timezone);
}

/**
 * Get list of common timezones for UI selection
 * @returns {Object[]} Array of timezone options with label and value
 */
function getCommonTimezones() {
  return [
    { label: 'US/Eastern (New York)', value: 'America/New_York' },
    { label: 'US/Central (Chicago)', value: 'America/Chicago' },
    { label: 'US/Mountain (Denver)', value: 'America/Denver' },
    { label: 'US/Pacific (Los Angeles)', value: 'America/Los_Angeles' },
    { label: 'US/Alaska', value: 'America/Anchorage' },
    { label: 'US/Hawaii', value: 'Pacific/Honolulu' },
    { label: 'UK (London)', value: 'Europe/London' },
    { label: 'Central Europe (Paris)', value: 'Europe/Paris' },
    { label: 'Eastern Europe (Helsinki)', value: 'Europe/Helsinki' },
    { label: 'Japan (Tokyo)', value: 'Asia/Tokyo' },
    { label: 'China (Shanghai)', value: 'Asia/Shanghai' },
    { label: 'India (Kolkata)', value: 'Asia/Kolkata' },
    { label: 'Australia/Sydney', value: 'Australia/Sydney' },
    { label: 'Australia/Perth', value: 'Australia/Perth' },
    { label: 'New Zealand (Auckland)', value: 'Pacific/Auckland' },
    { label: 'UTC', value: 'UTC' }
  ];
}

/**
 * Load settings from JSON config file
 * Auto-generates a secure feed secret on first run if not set
 * @returns {Object} Settings object
 */
function loadSettings() {
  let settings = { ...DEFAULT_SETTINGS };

  if (fs.existsSync(settingsConfigPath)) {
    try {
      const data = fs.readFileSync(settingsConfigPath, 'utf8');
      const parsed = JSON.parse(data);
      // Merge with defaults to ensure all keys exist
      settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (err) {
      console.error('Error loading settings.json:', err.message);
    }
  }

  // Auto-generate feed secret if not set OR if using the weak default
  const WEAK_DEFAULT_SECRET = 'change-me-in-production';
  if (!settings.feedSecret || settings.feedSecret === WEAK_DEFAULT_SECRET) {
    settings.feedSecret = generateSecureSecret();
    console.log('Generated new secure feed secret (replaced weak/missing secret)');
    saveSettings(settings);
  }

  return settings;
}

/**
 * Save settings to JSON config file
 * @param {Object} settings - Settings to save
 */
function saveSettings(settings) {
  const data = JSON.stringify(settings, null, 2);
  fs.writeFileSync(settingsConfigPath, data, 'utf8');
}

/**
 * Update settings
 * @param {Object} updates - Settings to update
 * @returns {Object} Updated settings
 * @throws {Error} If validation fails
 */
function updateSettings(updates) {
  const current = loadSettings();

  // Validate timezone if being updated
  if (updates.defaultTimezone !== undefined) {
    if (!isValidTimezone(updates.defaultTimezone)) {
      throw new Error(`Invalid timezone: ${updates.defaultTimezone}`);
    }
  }

  // Validate monthsToFetch if being updated
  if (updates.monthsToFetch !== undefined) {
    const months = parseInt(updates.monthsToFetch, 10);
    if (isNaN(months) || months < 1 || months > 24) {
      throw new Error('monthsToFetch must be between 1 and 24');
    }
    updates.monthsToFetch = months;
  }

  // Validate baseUrl if being updated
  if (updates.baseUrl !== undefined) {
    // Allow empty string (means use request origin) or valid URL
    if (updates.baseUrl && typeof updates.baseUrl === 'string') {
      updates.baseUrl = updates.baseUrl.trim();
      // Remove trailing slash if present
      if (updates.baseUrl.endsWith('/')) {
        updates.baseUrl = updates.baseUrl.slice(0, -1);
      }
      // Basic URL validation
      if (updates.baseUrl && !updates.baseUrl.match(/^https?:\/\/.+/)) {
        throw new Error('baseUrl must be a valid HTTP/HTTPS URL');
      }
    } else {
      updates.baseUrl = '';
    }
  }

  // Validate defaultLocation if being updated
  if (updates.defaultLocation !== undefined) {
    // Allow null/empty to clear the setting, or a non-empty string
    if (updates.defaultLocation === null || updates.defaultLocation === '') {
      updates.defaultLocation = null;
    } else if (typeof updates.defaultLocation !== 'string') {
      throw new Error('defaultLocation must be a string');
    } else {
      updates.defaultLocation = updates.defaultLocation.trim();
      if (updates.defaultLocation.length < 2) {
        throw new Error('defaultLocation must be at least 2 characters');
      }
    }
  }

  const updated = { ...current, ...updates };
  saveSettings(updated);
  return updated;
}

/**
 * Migrate calendar from old schema (timezone/sourceTimezone/targetTimezone) to simplified schema
 * The simplified schema has no per-calendar timezone fields - all timezone logic uses global defaultLocation
 * @param {Object} calendar - Calendar configuration
 * @returns {Object} Migrated calendar
 */
function migrateCalendarSchema(calendar) {
  // Remove old timezone fields - they're no longer used
  const { timezone, sourceTimezone, targetTimezone, ...rest } = calendar;
  return rest;
}

/**
 * Load calendars from JSON config file, falling back to env var
 * Automatically migrates old schema to new schema
 * @returns {Object[]} Array of calendar configurations
 */
function loadCalendars() {
  // Try loading from JSON file first
  if (fs.existsSync(calendarsConfigPath)) {
    try {
      const data = fs.readFileSync(calendarsConfigPath, 'utf8');
      const parsed = JSON.parse(data);
      const calendars = parsed.calendars || [];
      // Migrate any calendars using old schema
      return calendars.map(migrateCalendarSchema);
    } catch (err) {
      console.error('Error loading calendars.json:', err.message);
    }
  }

  // Fall back to environment variable (legacy support)
  if (process.env.GOOGLE_CALENDAR_URLS) {
    return process.env.GOOGLE_CALENDAR_URLS.split(',').map((url, index) => ({
      id: `calendar-${index + 1}`,
      url: url.trim(),
      name: `Calendar ${index + 1}`,
      mode: 'face-value',
      enabled: true
    }));
  }

  return [];
}

/**
 * Save calendars to JSON config file
 * @param {Object[]} calendars - Array of calendar configurations
 */
function saveCalendars(calendars) {
  const data = JSON.stringify({ calendars }, null, 2);
  fs.writeFileSync(calendarsConfigPath, data, 'utf8');
}

/**
 * Generate a unique calendar ID
 * @returns {string}
 */
function generateCalendarId() {
  return `cal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const config = {
  port: process.env.PORT || 5001,

  // Dynamic settings from JSON file
  get defaultTimezone() {
    return loadSettings().defaultTimezone;
  },
  get defaultLocation() {
    return loadSettings().defaultLocation;
  },
  get feedSecret() {
    return loadSettings().feedSecret;
  },
  get monthsToFetch() {
    return loadSettings().monthsToFetch;
  },
  get baseUrl() {
    return loadSettings().baseUrl;
  },

  // Dynamic calendar loading
  get sourceCalendars() {
    return loadCalendars().filter(cal => cal.enabled !== false);
  },

  // Settings management functions
  loadSettings,
  saveSettings,
  updateSettings,
  isValidTimezone,
  getCommonTimezones,
  generateSecureSecret,

  /**
   * Regenerate the feed secret (invalidates existing feed URLs)
   * @returns {string} The new secret
   */
  regenerateFeedSecret() {
    const settings = loadSettings();
    settings.feedSecret = generateSecureSecret();
    saveSettings(settings);
    return settings.feedSecret;
  },

  // Calendar management functions
  loadCalendars,
  saveCalendars,
  generateCalendarId,

  /**
   * Add a new calendar
   * @param {Object} calendar - Calendar config (url, name, mode)
   * @returns {Object} The added calendar with generated ID
   */
  addCalendar(calendar) {
    const calendars = loadCalendars();
    const newCalendar = {
      id: generateCalendarId(),
      url: calendar.url,
      name: calendar.name || 'Unnamed Calendar',
      mode: calendar.mode || 'face-value',
      sourceTimezone: calendar.sourceTimezone || null,  // Override for detected X-WR-TIMEZONE
      enabled: true,
      createdAt: new Date().toISOString()
    };
    calendars.push(newCalendar);
    saveCalendars(calendars);
    return newCalendar;
  },

  /**
   * Update an existing calendar
   * @param {string} id - Calendar ID
   * @param {Object} updates - Fields to update
   * @returns {Object|null} Updated calendar or null if not found
   */
  updateCalendar(id, updates) {
    const calendars = loadCalendars();
    const index = calendars.findIndex(cal => cal.id === id);
    if (index === -1) return null;

    // Don't allow changing the ID
    delete updates.id;

    calendars[index] = { ...calendars[index], ...updates };
    saveCalendars(calendars);
    return calendars[index];
  },

  /**
   * Remove a calendar
   * @param {string} id - Calendar ID
   * @returns {boolean} True if removed, false if not found
   */
  removeCalendar(id) {
    const calendars = loadCalendars();
    const index = calendars.findIndex(cal => cal.id === id);
    if (index === -1) return false;

    calendars.splice(index, 1);
    saveCalendars(calendars);
    return true;
  },

  /**
   * Get a calendar by ID
   * @param {string} id - Calendar ID
   * @returns {Object|null}
   */
  getCalendar(id) {
    return loadCalendars().find(cal => cal.id === id) || null;
  }
};

module.exports = config;
