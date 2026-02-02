const path = require('path');

describe('settings configuration', () => {
  let config;
  let mockFs;
  const settingsPath = path.join(__dirname, '../../config/settings.json');
  const calendarsPath = path.join(__dirname, '../../config/calendars.json');

  beforeEach(() => {
    // Clear all module cache
    jest.resetModules();

    // Create mock for fs
    mockFs = {
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn().mockReturnValue('{}'),
      writeFileSync: jest.fn()
    };

    // Mock fs before requiring config
    jest.doMock('fs', () => mockFs);
  });

  afterEach(() => {
    jest.unmock('fs');
  });

  describe('isValidTimezone', () => {
    beforeEach(() => {
      config = require('../../config');
    });

    it('should return true for valid IANA timezone', () => {
      expect(config.isValidTimezone('America/New_York')).toBe(true);
      expect(config.isValidTimezone('Europe/London')).toBe(true);
      expect(config.isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(config.isValidTimezone('UTC')).toBe(true);
    });

    it('should return false for invalid timezone', () => {
      expect(config.isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(config.isValidTimezone('Not_A_Zone')).toBe(false);
      expect(config.isValidTimezone('Fake/City')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(config.isValidTimezone(null)).toBe(false);
      expect(config.isValidTimezone(undefined)).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(config.isValidTimezone(123)).toBe(false);
      expect(config.isValidTimezone({})).toBe(false);
    });
  });

  describe('getCommonTimezones', () => {
    beforeEach(() => {
      config = require('../../config');
    });

    it('should return an array of timezone options', () => {
      const timezones = config.getCommonTimezones();
      expect(Array.isArray(timezones)).toBe(true);
      expect(timezones.length).toBeGreaterThan(0);
    });

    it('should have label and value for each timezone', () => {
      const timezones = config.getCommonTimezones();
      timezones.forEach(tz => {
        expect(tz).toHaveProperty('label');
        expect(tz).toHaveProperty('value');
        expect(typeof tz.label).toBe('string');
        expect(typeof tz.value).toBe('string');
      });
    });

    it('should include common US timezones', () => {
      const timezones = config.getCommonTimezones();
      const values = timezones.map(tz => tz.value);
      expect(values).toContain('America/New_York');
      expect(values).toContain('America/Los_Angeles');
      expect(values).toContain('America/Chicago');
    });

    it('should only contain valid IANA timezones', () => {
      const timezones = config.getCommonTimezones();
      timezones.forEach(tz => {
        expect(config.isValidTimezone(tz.value)).toBe(true);
      });
    });
  });

  describe('loadSettings', () => {
    it('should return default settings when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      config = require('../../config');

      const settings = config.loadSettings();
      expect(settings).toHaveProperty('defaultTimezone');
      expect(settings).toHaveProperty('feedSecret');
      expect(settings).toHaveProperty('monthsToFetch');
    });

    it('should load settings from file when it exists', () => {
      mockFs.existsSync.mockImplementation((p) => p === settingsPath);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        defaultTimezone: 'Europe/London',
        monthsToFetch: 6
      }));
      config = require('../../config');

      const settings = config.loadSettings();
      expect(settings.defaultTimezone).toBe('Europe/London');
      expect(settings.monthsToFetch).toBe(6);
    });

    it('should merge file settings with defaults', () => {
      mockFs.existsSync.mockImplementation((p) => p === settingsPath);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        defaultTimezone: 'Asia/Tokyo'
        // monthsToFetch not set
      }));
      config = require('../../config');

      const settings = config.loadSettings();
      expect(settings.defaultTimezone).toBe('Asia/Tokyo');
      expect(settings.monthsToFetch).toBe(3); // default
    });
  });

  describe('updateSettings', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      config = require('../../config');
    });

    it('should update timezone when valid', () => {
      const result = config.updateSettings({ defaultTimezone: 'Europe/Paris' });
      expect(result.defaultTimezone).toBe('Europe/Paris');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should throw error for invalid timezone', () => {
      expect(() => {
        config.updateSettings({ defaultTimezone: 'Invalid/Zone' });
      }).toThrow('Invalid timezone');
    });

    it('should update monthsToFetch when valid', () => {
      const result = config.updateSettings({ monthsToFetch: 6 });
      expect(result.monthsToFetch).toBe(6);
    });

    it('should throw error for invalid monthsToFetch', () => {
      expect(() => {
        config.updateSettings({ monthsToFetch: 0 });
      }).toThrow('monthsToFetch must be between 1 and 24');

      expect(() => {
        config.updateSettings({ monthsToFetch: 25 });
      }).toThrow('monthsToFetch must be between 1 and 24');
    });

    it('should parse string monthsToFetch to number', () => {
      const result = config.updateSettings({ monthsToFetch: '12' });
      expect(result.monthsToFetch).toBe(12);
    });

    it('should update defaultLocation when valid', () => {
      const result = config.updateSettings({ defaultLocation: 'New York, USA' });
      expect(result.defaultLocation).toBe('New York, USA');
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should trim whitespace from defaultLocation', () => {
      const result = config.updateSettings({ defaultLocation: '  Detroit, Michigan  ' });
      expect(result.defaultLocation).toBe('Detroit, Michigan');
    });

    it('should allow null to clear defaultLocation', () => {
      const result = config.updateSettings({ defaultLocation: null });
      expect(result.defaultLocation).toBeNull();
    });

    it('should allow empty string to clear defaultLocation', () => {
      const result = config.updateSettings({ defaultLocation: '' });
      expect(result.defaultLocation).toBeNull();
    });

    it('should throw error for defaultLocation that is too short', () => {
      expect(() => {
        config.updateSettings({ defaultLocation: 'A' });
      }).toThrow('defaultLocation must be at least 2 characters');
    });

    it('should throw error for non-string defaultLocation', () => {
      expect(() => {
        config.updateSettings({ defaultLocation: 123 });
      }).toThrow('defaultLocation must be a string');
    });
  });

  describe('dynamic config getters', () => {
    it('should return defaultTimezone from settings', () => {
      mockFs.existsSync.mockImplementation((p) => p === settingsPath);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        defaultTimezone: 'Pacific/Auckland'
      }));
      config = require('../../config');

      expect(config.defaultTimezone).toBe('Pacific/Auckland');
    });

    it('should return monthsToFetch from settings', () => {
      mockFs.existsSync.mockImplementation((p) => p === settingsPath);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        monthsToFetch: 12
      }));
      config = require('../../config');

      expect(config.monthsToFetch).toBe(12);
    });
  });
});
