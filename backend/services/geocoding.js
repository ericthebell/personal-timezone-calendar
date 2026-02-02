const { find: findTimezone } = require('geo-tz');

// Simple in-memory cache for geocoding results
const geocodeCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Remove postal code prefix from a string
 * @param {string} part - Location part that may have a postal code prefix
 * @returns {string} Part with postal code removed
 */
function stripPostalCode(part) {
  // Remove leading postal codes like "10413 Tallinn" -> "Tallinn"
  return part.replace(/^\d{4,6}\s+/, '').trim();
}

/**
 * Check if a string looks like a street address component
 * @param {string} part - Location part to check
 * @returns {boolean} True if it looks like a street address
 */
function looksLikeStreetAddress(part) {
  // First strip any postal code prefix
  const cleaned = stripPostalCode(part);

  // If after stripping postal code we have a valid city name, it's not a street
  if (cleaned !== part && cleaned.length > 2 && !/\d/.test(cleaned)) {
    return false;
  }

  // Starts with numbers followed by street content (like "123 Main St", "11А Ghazar")
  if (/^\d+[A-Za-zА-Яа-я\s]/.test(part) && part.split(/\s+/).length > 1) return true;
  // Just a postal code
  if (/^\d{4,6}$/.test(part)) return true;
  // Contains street type words
  if (/\b(st|street|ave|avenue|road|rd|blvd|boulevard|lane|ln|drive|dr|way|place|pl|tn|strasse|straße|ulica|prospekt)\b/i.test(part)) return true;
  // Contains building/apartment indicators
  if (/\b(apt|suite|floor|bldg|building|unit)\b/i.test(part)) return true;
  return false;
}

/**
 * Check if a string looks like a venue/business name (not a city/region)
 * @param {string} part - Location part to check
 * @returns {boolean} True if it looks like a venue name
 */
function looksLikeVenueName(part) {
  // Common venue/business indicators
  if (/\b(hotel|inn|motel|resort|hostel|airbnb|flat|apartment|house|lodge|villa|craftflat|marriott|hilton|hyatt|sheraton|radisson|ibis)\b/i.test(part)) return true;
  // Conference/event venues
  if (/\b(center|centre|conference|convention|hall|arena|stadium|theater|theatre|museum|gallery)\b/i.test(part)) return true;
  // Restaurants/bars
  if (/\b(restaurant|cafe|café|coffee|bar|pub|grill|bistro|diner|kitchen)\b/i.test(part)) return true;
  // Office/business
  if (/\b(office|tower|plaza|campus|headquarters|hq)\b/i.test(part)) return true;
  return false;
}

/**
 * Extract city/state/country from a location string
 * Strips street addresses, postal codes, and specific venue names
 * @param {string} location - Full location string
 * @returns {string} Simplified location for geocoding
 */
function simplifyLocation(location) {
  if (!location) return null;

  // Split by comma
  let parts = location.split(',').map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length === 0) return null;

  // Filter out street addresses and venue names, and clean postal codes from remaining
  const filtered = parts
    .filter(part => !looksLikeStreetAddress(part) && !looksLikeVenueName(part))
    .map(part => stripPostalCode(part))
    .filter(part => part.length > 0);

  if (filtered.length === 0) {
    // Fallback: try to extract city from postal code parts, then country
    for (let i = parts.length - 1; i >= 0; i--) {
      const cleaned = stripPostalCode(parts[i]);
      if (cleaned.length > 2 && !/\d/.test(cleaned) && !looksLikeVenueName(cleaned)) {
        return cleaned + (parts[i + 1] ? ', ' + parts[parts.length - 1] : '');
      }
    }
    return parts[parts.length - 1];
  }

  // Take last 3 filtered parts (city, state/region, country)
  if (filtered.length > 3) {
    return filtered.slice(-3).join(', ');
  }

  return filtered.join(', ');
}

/**
 * Geocode a location string to coordinates using OpenStreetMap Nominatim
 * @param {string} location - Location string (city, state, country)
 * @returns {Promise<{lat: number, lon: number}|null>} Coordinates or null if not found
 */
async function geocodeLocation(location) {
  if (!location) return null;

  const simplified = simplifyLocation(location);
  if (!simplified) return null;

  // Check cache
  const cacheKey = simplified.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.coords;
  }

  // Retry logic with exponential backoff
  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Use OpenStreetMap Nominatim API
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', simplified);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'PersonalTimezoneCalendar/1.0'
        }
      });

      if (!response.ok) {
        // Rate limiting - wait and retry
        if (response.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`Geocoding rate limited, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error(`Geocoding failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const results = await response.json();

      if (results.length === 0) {
        // Cache negative result
        geocodeCache.set(cacheKey, { coords: null, timestamp: Date.now() });
        return null;
      }

      const coords = {
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon)
      };

      // Cache result
      geocodeCache.set(cacheKey, { coords, timestamp: Date.now() });

      return coords;
    } catch (err) {
      lastError = err;
      // Network error - wait and retry
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500;
        console.warn(`Geocoding network error for "${simplified}", retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Geocoding failed for "${simplified}" after ${maxRetries} attempts:`, lastError?.message);
  return null;
}

/**
 * Get timezone for a location string
 * @param {string} location - Location string
 * @returns {Promise<string|null>} IANA timezone identifier or null
 */
async function getTimezoneForLocation(location) {
  const coords = await geocodeLocation(location);
  if (!coords) return null;

  const timezones = findTimezone(coords.lat, coords.lon);
  return timezones.length > 0 ? timezones[0] : null;
}

/**
 * Get timezone from coordinates (synchronous, uses geo-tz)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string|null} IANA timezone identifier or null
 */
function getTimezoneFromCoords(lat, lon) {
  const timezones = findTimezone(lat, lon);
  return timezones.length > 0 ? timezones[0] : null;
}

/**
 * Clear the geocoding cache
 */
function clearCache() {
  geocodeCache.clear();
}

/**
 * Get cache statistics
 * @returns {{size: number, entries: string[]}}
 */
function getCacheStats() {
  return {
    size: geocodeCache.size,
    entries: Array.from(geocodeCache.keys())
  };
}

module.exports = {
  simplifyLocation,
  geocodeLocation,
  getTimezoneForLocation,
  getTimezoneFromCoords,
  clearCache,
  getCacheStats
};
