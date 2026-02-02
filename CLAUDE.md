# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Timezone Calendar - A calendar feed converter that ingests iCal feeds and outputs merged feeds with personal timezone logic. Events are displayed at the time originally entered (like a physical datebook), while subscribers see them adjusted based on your location.

## To-Do List (Backlog)

### Bugs
- [ ] **Slow app load**: App load time is very slow; need status indicators visible in admin UI while loading
- [ ] **Slow CRUD operations**: Deleting a calendar is slow, adding a calendar is very slow; these need to be more responsive interactions
- [ ] **Tallinn umbrella event bug**: Merged feed isn't shifting events during the Tallinn, Estonia umbrella event

### Features / Enhancements
- [x] **Simplified timezone model**: Calendar settings now only have `mode` (face-value or personal-timezone). All timezone logic uses the global Default Location setting:
  - Events are interpreted as wall-clock time for wherever you physically are
  - Default Location = where you are by default (your "local time")
  - Umbrella events override the default location during travel
  - ✅ Removed per-calendar sourceTimezone and targetTimezone fields

### Documentation
- [x] **Cloudflare tunnel restart documentation**: ✅ start.command now automatically starts cloudflared tunnel and updates settings with the tunnel URL

## Development Commands

### Backend (Express/Node.js)
```bash
cd backend
npm install        # Install dependencies
npm run dev        # Development with hot reload (port 5000)
npm start          # Production start
npm test           # Run all tests (130 tests)
npm run test:unit  # Unit tests only
npm run test:integration  # Integration tests
npm run test:watch # Tests in watch mode
```

### Frontend (React Admin UI)
```bash
cd frontend
npm install
npm start          # Dev server at http://localhost:3000
npm test           # Run tests
npm run build      # Production build
```

### Docker Deployment
```bash
cp .env.example .env   # Configure environment
docker-compose up -d   # Start service
docker-compose logs -f # View logs
docker-compose restart # Restart after config changes
```

## Architecture

```
backend/
├── server.js              # Express app entry point
├── config/
│   ├── index.js           # Configuration, calendar & settings management
│   ├── calendars.json     # Calendar config storage (gitignored)
│   ├── settings.json      # Settings storage (gitignored)
│   └── calendars.example.json  # Example config
├── services/
│   ├── ical-parser.js     # Parse iCal feeds (uses ical.js)
│   ├── feed-generator.js  # Generate output iCal with annotations
│   ├── timezone-logic.js  # Timezone reinterpretation & umbrella detection
│   └── geocoding.js       # Location → timezone (OpenStreetMap + geo-tz)
├── routes/
│   ├── feeds.js           # Feed endpoints with timezone processing
│   ├── calendars.js       # Calendar CRUD endpoints
│   └── settings.js        # Settings API (timezone, monthsToFetch)
└── tests/
    ├── unit/              # Unit tests (Jest)
    ├── integration/       # Integration tests (pipeline tests)
    └── fixtures/          # Test iCal files

frontend/                  # React admin UI (MUI)
└── src/App.js            # Calendar management & feed URLs
```

## API Endpoints

### Feeds
- `GET /feeds/full/:token` - Full merged calendar with event details
- `GET /feeds/busy/:token` - Busy-only feed (hides titles)
- `GET /feeds/urls` - Get subscribable feed URLs
- `GET /feeds/status` - Status of configured source calendars
- `GET /feeds/stats` - Statistics about merged feed
- `GET /feeds/tunnel-status` - Check if Cloudflare tunnel is connected

### Calendar Management
- `GET /calendars` - List all calendars
- `POST /calendars` - Add a new calendar
- `GET /calendars/:id` - Get calendar details
- `PATCH /calendars/:id` - Update calendar settings
- `DELETE /calendars/:id` - Remove a calendar
- `POST /calendars/:id/test` - Test fetching a calendar
- `POST /calendars/validate` - Validate a calendar URL

### Settings
- `GET /settings` - Get current settings (defaultLocation, monthsToFetch, baseUrl)
- `GET /settings/timezones` - List of common timezones for UI selection
- `PATCH /settings` - Update settings (defaultLocation, monthsToFetch, baseUrl)
- `POST /settings/validate-timezone` - Validate a timezone string
- `POST /settings/validate-location` - Validate a location string (geocodes to timezone)
- `POST /settings/feed-secret/regenerate` - Regenerate feed secret (invalidates existing feed URLs)

## Configuration

Configuration is stored in JSON files (both gitignored for security):
- `backend/config/calendars.json` - Calendar sources
- `backend/config/settings.json` - Settings (timezone, monthsToFetch, feedSecret)

### Calendar Schema
```json
{
  "calendars": [
    {
      "id": "cal-123",
      "url": "https://calendar.google.com/...",
      "name": "Personal Calendar",
      "mode": "personal-timezone",
      "enabled": true
    }
  ]
}
```

- `mode`: Either "face-value" (no adjustment) or "personal-timezone" (adjusts based on location)
- For personal-timezone mode, events are adjusted based on the global Default Location setting and umbrella events

Settings can be managed via the admin UI or API. Environment variables provide defaults:
- `PORT` - Server port (default 5001)
- `DEFAULT_TIMEZONE` - Default home timezone (IANA format, e.g., America/Detroit)
- `DEFAULT_LOCATION` - Default location for timezone inference (e.g., "Detroit, Michigan")
- `FEED_SECRET` - Secret for generating secure feed tokens

## Cloudflare Tunnel Integration

The `start.command` script automatically manages a Cloudflare Quick Tunnel for external access:

1. **Automatic startup**: When you run `./start.command`, it:
   - Starts the Express server
   - Waits for the health check to pass
   - Starts `cloudflared tunnel` if installed
   - Parses the tunnel URL from cloudflared output
   - Auto-updates the `baseUrl` setting via API

2. **Graceful shutdown**: Pressing Ctrl+C or closing the terminal cleanly shuts down both the server and tunnel.

3. **UI status**: The admin UI shows a "Tunnel connected" or "Tunnel disconnected" chip in the Feed URLs section.

4. **Installation**: If cloudflared is not installed, the script shows instructions:
   ```bash
   brew install cloudflared
   ```

5. **Tunnel status endpoint**: `GET /feeds/tunnel-status` returns:
   - `connected`: Tunnel is working
   - `disconnected`: Tunnel URL is configured but unreachable
   - `not-configured`: No external URL set

## Key Libraries

- Backend: express, ical.js (parsing), ics (generation), luxon (timezone), geo-tz (coords→timezone)
- Frontend: @mui/material, React

## Core Concepts

**The Problem**: You use your calendar like a paper datebook - when you write "10am dentist", you mean 10am wherever you are. But Google Calendar encodes timezones, so if you created the event in PST and later move to EST, calendars may show it at the wrong time.

**Face Value Mode**: Events used as-is from source calendar, no timezone adjustment.

**Personal Timezone Mode**: Events are displayed at the wall-clock time for wherever you physically are. You enter events as the local time where you'll be, and the system interprets them based on:
1. **Umbrella events**: If you're inside a multi-day event with a location (hotel, conference), events use that location's timezone
2. **Default Location**: Your normal location (set in Settings), used when no umbrella event applies

The system preserves wall-clock time: 10am stays 10am, just in the correct timezone for your actual location.

**UTC-Stored Events**: Google Calendar often stores events as UTC internally (e.g., `DTSTART:20260106T180000Z`). The system detects these and converts UTC → Default Location timezone to recover the intended wall-clock time.

**Umbrella Inheritance**: Events occurring during multi-day events with locations (hotel stays, conferences) inherit that event's timezone. Uses OpenStreetMap Nominatim for geocoding.

**Timezone Reinterpretation**: The key function `reinterpretTimezone(dt, newTz)` in `timezone-logic.js` preserves wall-clock time while changing the timezone. This is the opposite of normal timezone conversion.

**Subscriber Time Shift**: Annotations show how much earlier/later events appear to subscribers:
- PST → EST: Events appear 3 hours EARLIER (shown as "-3h")
- EST → PST: Events appear 3 hours LATER (shown as "+3h")

**Event Annotations**: Each event in the output feed includes:
- Source calendar name
- Original time and timezone
- Subscriber shift (how much earlier/later the event appears)
- Basis for adjustment (umbrella event or target timezone)

## Test Scenarios (from README)

| Case | Status |
|------|--------|
| Face-value calendar | ✅ Implemented |
| Busy mirror feed | ✅ Implemented |
| Location shift (PST→Michigan) | ✅ Implemented |
| Umbrella inheritance | ✅ Implemented |
| Multiple calendars | ✅ Implemented |
| Settings admin UI | ✅ Implemented |
| Docker deployment | ✅ Implemented |
| UTC-stored events (source→target) | ✅ Implemented |
| Subscriber time shift annotations | ✅ Implemented |
| Global default location fallback | ✅ Implemented |
| Recurring events | ⏳ Not yet implemented |
| Date boundary handling | ⏳ Not yet implemented |
