const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const feedsRouter = require('./routes/feeds');
const calendarsRouter = require('./routes/calendars');
const settingsRouter = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Middleware to restrict access to localhost only
 * Used for admin endpoints that shouldn't be publicly accessible
 *
 * Strategy: If X-Forwarded-For header is present, the request came through
 * a proxy (like Cloudflare tunnel) and should be denied. Direct localhost
 * connections don't have this header.
 */
function localhostOnly(req, res, next) {
  // If X-Forwarded-For is present, request came through a proxy - deny
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) {
    return res.status(403).json({
      error: 'Admin access denied',
      message: 'Admin interface is only accessible from localhost'
    });
  }

  // Check if request is from localhost
  const isLocalhost =
    req.hostname === 'localhost' ||
    req.hostname === '127.0.0.1' ||
    req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1';

  if (isLocalhost) {
    return next();
  }

  // Not localhost - deny access
  res.status(403).json({
    error: 'Admin access denied',
    message: 'Admin interface is only accessible from localhost'
  });
}

// Public feed endpoints (token-protected, accessible via Cloudflare tunnel)
app.use('/feeds', feedsRouter);

// Admin-only routes (localhost only)
app.use('/calendars', localhostOnly, calendarsRouter);
app.use('/settings', localhostOnly, settingsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    name: 'Personal Timezone Calendar API',
    version: '1.0.0',
    status: 'running',
    calendars: config.sourceCalendars.length,
    defaultTimezone: config.defaultTimezone
  });
});

// Serve static frontend files (built React app) - localhost only
const frontendBuildPath = path.join(__dirname, '../frontend/build');

// Static assets with hashes can be cached (JS, CSS with hash in filename)
// Admin UI is localhost only
app.use(localhostOnly, express.static(frontendBuildPath, {
  maxAge: '1y',
  setHeaders: (res, filePath) => {
    // HTML files should never be cached
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Fallback to index.html for client-side routing (with no-cache)
// Also localhost only to protect admin UI
app.get('*', localhostOnly, (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Personal Timezone Calendar API running on port ${config.port}`);
  console.log(`Configured calendars: ${config.sourceCalendars.length}`);
});

module.exports = app;
