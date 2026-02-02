const geocoding = require('../../services/geocoding');

describe('geocoding', () => {
  beforeEach(() => {
    geocoding.clearCache();
  });

  describe('simplifyLocation', () => {
    it('should return null for null input', () => {
      expect(geocoding.simplifyLocation(null)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(geocoding.simplifyLocation('')).toBeNull();
    });

    it('should keep simple city, state, country', () => {
      expect(geocoding.simplifyLocation('San Francisco, CA, USA'))
        .toBe('San Francisco, CA, USA');
    });

    it('should keep city, country', () => {
      expect(geocoding.simplifyLocation('Tokyo, Japan'))
        .toBe('Tokyo, Japan');
    });

    it('should strip street address, keep city/state/country', () => {
      expect(geocoding.simplifyLocation('123 Main St, San Francisco, CA, USA'))
        .toBe('San Francisco, CA, USA');
    });

    it('should strip venue name and address', () => {
      expect(geocoding.simplifyLocation('Hilton Hotel, 123 Market St, San Francisco, CA, USA'))
        .toBe('San Francisco, CA, USA');
    });

    it('should strip venue name from 3-part location', () => {
      expect(geocoding.simplifyLocation('CraftFlat Kalamaja, Tallinn, Estonia'))
        .toBe('Tallinn, Estonia');
    });

    it('should strip hotel names', () => {
      expect(geocoding.simplifyLocation('Marriott Hotel, Atlanta, Georgia'))
        .toBe('Atlanta, Georgia');
    });

    it('should strip conference center names', () => {
      expect(geocoding.simplifyLocation('Conference Center, Berlin, Germany'))
        .toBe('Berlin, Germany');
    });

    it('should handle extra whitespace', () => {
      expect(geocoding.simplifyLocation('  San Francisco ,  CA ,  USA  '))
        .toBe('San Francisco, CA, USA');
    });
  });

  describe('getTimezoneFromCoords', () => {
    it('should return timezone for San Francisco coordinates', () => {
      // San Francisco: 37.7749, -122.4194
      const tz = geocoding.getTimezoneFromCoords(37.7749, -122.4194);
      expect(tz).toBe('America/Los_Angeles');
    });

    it('should return timezone for New York coordinates', () => {
      // New York: 40.7128, -74.0060
      const tz = geocoding.getTimezoneFromCoords(40.7128, -74.0060);
      expect(tz).toBe('America/New_York');
    });

    it('should return timezone for Tokyo coordinates', () => {
      // Tokyo: 35.6762, 139.6503
      const tz = geocoding.getTimezoneFromCoords(35.6762, 139.6503);
      expect(tz).toBe('Asia/Tokyo');
    });

    it('should return timezone for London coordinates', () => {
      // London: 51.5074, -0.1278
      const tz = geocoding.getTimezoneFromCoords(51.5074, -0.1278);
      expect(tz).toBe('Europe/London');
    });

    it('should return timezone for Detroit/Michigan coordinates', () => {
      // Detroit: 42.3314, -83.0458
      const tz = geocoding.getTimezoneFromCoords(42.3314, -83.0458);
      expect(tz).toBe('America/Detroit');
    });
  });

  describe('getCacheStats', () => {
    it('should return empty cache initially', () => {
      const stats = geocoding.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });
  });

  // Note: geocodeLocation and getTimezoneForLocation tests would require
  // mocking the fetch API or making real network calls. We'll test these
  // in integration tests instead.
});
