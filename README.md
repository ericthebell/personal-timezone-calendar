# Personal Timezone Calendar

A calendar feed converter that makes your calendar behave like a physical datebook - events stay at the time you experienced them, while subscribers see them adjusted to your actual location.

## Quick Start (macOS)

1. Open the project folder in Finder
2. Double-click **`start.command`** to start the server and open your browser
3. Double-click **`stop.command`** to stop the server

The server runs at http://localhost:5001

## Problem

When you travel and create calendar events, most calendars either:
- Shift all your events when you change timezone (confusing)
- Keep events in their original timezone (wrong availability for subscribers)

## Solution

A feed converter service that:
1. Ingests your Google Calendar feeds
2. Tracks your location (default timezone + inferred from multi-day events like hotel stays)
3. Outputs subscribable feeds with events adjusted to reflect where you actually were

**Your view:** Events always show at the time you entered them (like a paper datebook)
**Subscriber view:** Events adjusted based on your location, so availability is accurate

## Architecture

```
┌──────────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│ Google Calendar  │────▶│  Converter Service      │────▶│ Output Feeds     │
│ (iCal feeds)     │     │                         │     │                  │
└──────────────────┘     │  • Parse source feeds   │     │ /feed/full/:token│
                         │  • Infer location from  │     │ /feed/busy/:token│
┌──────────────────┐     │    multi-day events     │     └──────────────────┘
│ Admin UI         │────▶│  • Apply TZ logic       │
│ (set defaults)   │     │  • Merge calendars      │
└──────────────────┘     │  • Generate output iCal │
                         └─────────────────────────┘
```

## Timezone Behavior Modes (per source calendar)

**Face Value:** Events used as-is, no timezone adjustment. Use for shared calendars or calendars already in "absolute" time.

**Personal Timezone:** Events reinterpreted based on your location. The original wall-clock time is preserved, but the timezone changes based on where you are.

## Location Inference

Location is determined in priority order:
1. **Umbrella event:** If an event occurs during a multi-day event with a location (e.g., hotel stay, conference), inherit that timezone
2. **Default timezone:** Fall back to your configured default (set via admin UI)

Location fields are geocoded using city/state/country only (street addresses ignored).

## Output Feed Annotations

Each adjusted event includes in its description:
- Source calendar name
- Original local time
- Hours adjusted (+/- from original)
- Basis for adjustment (umbrella event location, calendar default, etc.)

## Requirements

- Only ingest most recent 3 months of events
- Two output feeds: full details and busy-only (hides titles, keeps TZ notes)
- Secure feed URLs with tokens
- Handle date shifts from timezone changes (e.g., late-night events crossing midnight)
- Recurring events: per-occurrence timezone logic

## Test Cases

| Case | Description |
|------|-------------|
| Face-value | Event from face-value calendar appears unchanged |
| Busy mirror | Every event appears in busy feed with title hidden |
| Location shift | PST event with PST location appears 3h earlier from Michigan |
| Umbrella inheritance | Event during hotel stay inherits hotel's timezone |
| Recurring events | Same recurring event shows different times when in different locations |
| Date boundary | Japan event from Pacific time correctly shifts date |

## Development

```bash
# Backend
cd backend
npm install
npm run dev        # Development with hot reload

# Run tests
npm test           # All tests
npm run test:unit  # Unit tests only
npm run test:integration  # Integration tests

# Admin UI
cd frontend
npm install
npm start          # Dev server at localhost:3000
```

## Deployment (Docker)

### Quick Start

```bash
# 1. Clone and configure
git clone <repo-url>
cd personal-timezone-calendar
cp .env.example .env

# 2. Edit .env with your settings
#    - Set DEFAULT_TIMEZONE to your home timezone
#    - Set FEED_SECRET to a random 16+ character string

# 3. Start the service
docker-compose up -d

# 4. View logs
docker-compose logs -f
```

The API runs on port 5000. Access `http://localhost:5001/` to verify it's running.

### Managing the Service

```bash
# Restart after config changes
docker-compose restart

# Stop the service
docker-compose down

# Update to latest version
docker-compose pull && docker-compose up -d

# Rebuild after code changes
docker-compose up --build -d
```

### Persistent Configuration

Calendar and settings are stored in the `data/` directory and persist across container restarts:
- `data/calendars.json` - Your configured calendar sources
- `data/settings.json` - Settings (timezone, months to fetch)

### Production Notes

For production deployment:
1. Use a reverse proxy (nginx/caddy) for HTTPS
2. Set a strong `FEED_SECRET` in `.env`
3. Consider firewall rules to restrict access to admin endpoints

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 5000 | Server port |
| `DEFAULT_TIMEZONE` | America/New_York | Your home timezone (IANA format) |
| `FEED_SECRET` | (required) | Secret for generating secure feed URLs |

### Adding Calendars

1. Get your Google Calendar's private iCal URL:
   - Google Calendar Settings → [Calendar Name] → Integrate calendar
   - Copy "Secret address in iCal format"

2. Add via the admin UI at `http://localhost:5001` (or use the API)

3. Choose the mode:
   - **Face Value**: Events appear exactly as entered
   - **Personal Timezone**: Events adjust based on your location
