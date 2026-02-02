import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  CssBaseline,
  ThemeProvider,
  createTheme,
  Typography,
  Paper,
  Box,
  Alert,
  CircularProgress,
  Link,
  Chip,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Switch,
  FormControlLabel,
  Snackbar
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CloudIcon from '@mui/icons-material/Cloud';

const theme = createTheme();
const API_URL = process.env.REACT_APP_API_URL || '';

function App() {
  const [feedUrls, setFeedUrls] = useState(null);
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cacheStatus, setCacheStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState(''); // What's currently loading
  const [error, setError] = useState(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [editingSettings, setEditingSettings] = useState({});
  const [commonLocations, setCommonLocations] = useState([]);
  const [commonTimezones, setCommonTimezones] = useState([]);
  const [regenerating, setRegenerating] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState(null);

  // Form state for adding calendar
  const [newCalendar, setNewCalendar] = useState({
    url: '',
    name: '',
    mode: 'face-value'
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Stage 1: Load fast endpoints first (no calendar fetching)
      setLoadingStage('Loading configuration...');
      const [urlsRes, settingsRes, cacheRes] = await Promise.all([
        fetch(`${API_URL}/feeds/urls`),
        fetch(`${API_URL}/settings`),
        fetch(`${API_URL}/feeds/cache-status`)
      ]);

      if (!urlsRes.ok || !settingsRes.ok) {
        throw new Error('Failed to fetch configuration from API');
      }

      setFeedUrls(await urlsRes.json());
      setSettings(await settingsRes.json());
      if (cacheRes.ok) {
        setCacheStatus(await cacheRes.json());
      }

      // Stage 2: Load calendar data (may be slow if cache is cold)
      setLoadingStage('Loading calendar data...');
      const [statusRes, previewRes, tunnelRes] = await Promise.all([
        fetch(`${API_URL}/feeds/status`),
        fetch(`${API_URL}/feeds/preview`),
        fetch(`${API_URL}/feeds/tunnel-status`)
      ]);

      if (!statusRes.ok) {
        throw new Error('Failed to fetch calendar status');
      }

      setStatus(await statusRes.json());
      if (previewRes.ok) {
        setPreview(await previewRes.json());
      }
      if (tunnelRes.ok) {
        setTunnelStatus(await tunnelRes.json());
      }

      setLoadingStage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Force refresh - clears server cache then reloads data
  const handleRefresh = async () => {
    try {
      setLoading(true);
      // First, tell server to refresh its cache
      await fetch(`${API_URL}/feeds/refresh`, { method: 'POST' });
      // Then fetch fresh data
      await fetchData();
      setSnackbar({ open: true, message: 'Data refreshed', severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: 'Refresh failed', severity: 'error' });
    }
  };

  const handleAddCalendar = async () => {
    try {
      const res = await fetch(`${API_URL}/calendars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newCalendar.url,
          name: newCalendar.name,
          mode: newCalendar.mode
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add calendar');
      }

      setSnackbar({ open: true, message: 'Calendar added successfully', severity: 'success' });
      setAddDialogOpen(false);
      setNewCalendar({ url: '', name: '', mode: 'face-value' });
      fetchData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleUpdateCalendar = async () => {
    try {
      const res = await fetch(`${API_URL}/calendars/${editingCalendar.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingCalendar.name,
          mode: editingCalendar.mode,
          sourceTimezone: editingCalendar.sourceTimezone || null,
          enabled: editingCalendar.enabled
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update calendar');
      }

      setSnackbar({ open: true, message: 'Calendar updated successfully', severity: 'success' });
      setEditDialogOpen(false);
      fetchData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const handleRegenerateFeed = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`${API_URL}/feeds/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh feed');
      const data = await res.json();
      setSnackbar({
        open: true,
        message: `Feed regenerated in ${data.fetchTimeMs}ms`,
        severity: 'success'
      });
      fetchData();  // Refresh all data including cache status
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    } finally {
      setRegenerating(false);
    }
  };

  const handleDeleteCalendar = async (id) => {
    if (!window.confirm('Are you sure you want to remove this calendar?')) return;

    try {
      const res = await fetch(`${API_URL}/calendars/${id}`, { method: 'DELETE' });

      if (!res.ok) {
        throw new Error('Failed to delete calendar');
      }

      setSnackbar({ open: true, message: 'Calendar removed', severity: 'success' });
      fetchData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  const openEditDialog = async (cal) => {
    setEditingCalendar({ ...cal, detectedTimezone: null, loadingTimezone: true });
    setEditDialogOpen(true);

    // Load common timezones if not already loaded
    if (commonTimezones.length === 0) {
      try {
        const res = await fetch(`${API_URL}/settings/timezones`);
        if (res.ok) {
          const data = await res.json();
          setCommonTimezones(data.timezones);
        }
      } catch (err) {
        console.error('Failed to load timezones:', err);
      }
    }

    // Fetch full calendar details (includes sourceTimezone) and detected timezone in parallel
    try {
      const [calRes, testRes] = await Promise.all([
        fetch(`${API_URL}/calendars/${cal.id}`),
        fetch(`${API_URL}/calendars/${cal.id}/test`, { method: 'POST' })
      ]);

      let calendarData = {};
      let detectedTimezone = null;

      if (calRes.ok) {
        calendarData = await calRes.json();
      }
      if (testRes.ok) {
        const testData = await testRes.json();
        detectedTimezone = testData.timezone;
      }

      setEditingCalendar(prev => ({
        ...prev,
        ...calendarData,
        detectedTimezone,
        loadingTimezone: false
      }));
    } catch (err) {
      console.error('Failed to fetch calendar details:', err);
      setEditingCalendar(prev => ({ ...prev, loadingTimezone: false }));
    }
  };

  const openSettingsDialog = async () => {
    setEditingSettings({ ...settings });
    setSettingsDialogOpen(true);

    // Load common locations if not already loaded
    if (commonLocations.length === 0) {
      try {
        const res = await fetch(`${API_URL}/settings/locations`);
        if (res.ok) {
          const data = await res.json();
          setCommonLocations(data.locations);
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    }
  };

  const handleUpdateSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthsToFetch: editingSettings.monthsToFetch,
          baseUrl: editingSettings.baseUrl || '',
          defaultLocation: editingSettings.defaultLocation || null
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update settings');
      }

      setSnackbar({ open: true, message: 'Settings updated successfully', severity: 'success' });
      setSettingsDialogOpen(false);
      fetchData();
    } catch (err) {
      setSnackbar({ open: true, message: err.message, severity: 'error' });
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h4" component="h1">
              Personal Timezone Calendar
            </Typography>
            <Typography variant="subtitle1" color="text.secondary">
              Calendar feed converter with personal timezone support
            </Typography>
          </Box>
          <Box>
            <IconButton onClick={openSettingsDialog} disabled={loading}>
              <SettingsIcon />
            </IconButton>
            <IconButton onClick={handleRefresh} disabled={loading} title="Refresh (fetches from source calendars)">
              <RefreshIcon />
            </IconButton>
          </Box>
        </Box>

        {loading && (
          <Paper sx={{ p: 3, my: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={24} />
              <Box>
                <Typography variant="subtitle1">
                  {loadingStage || 'Loading...'}
                </Typography>
                {cacheStatus && (
                  <Typography variant="body2" color="text.secondary">
                    {cacheStatus.message}
                    {cacheStatus.cache?.ageFormatted && ` (cached ${cacheStatus.cache.ageFormatted})`}
                  </Typography>
                )}
              </Box>
            </Box>
          </Paper>
        )}

        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}. Make sure the backend is running on {API_URL}
          </Alert>
        )}

        {feedUrls && (
          <Paper sx={{ p: 3, my: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Feed URLs
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {(status?.health?.cache?.ageFormatted || cacheStatus?.cache?.ageFormatted)
                    ? `Last updated: ${status?.health?.cache?.ageFormatted || cacheStatus?.cache?.ageFormatted}`
                    : 'Cache status unknown'}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={regenerating ? <CircularProgress size={16} /> : <RefreshIcon />}
                  onClick={handleRegenerateFeed}
                  disabled={regenerating}
                >
                  {regenerating ? 'Updating...' : 'Update'}
                </Button>
              </Box>
            </Box>
            {!feedUrls.isConfigured && feedUrls.full.includes('localhost') && (
              <Alert severity="warning" sx={{ my: 2 }}>
                <strong>External subscriptions require a public URL.</strong> These localhost URLs only work for local import.
                <Box sx={{ mt: 1 }}>
                  To enable external subscriptions (Apple Calendar, Google Calendar, etc.):
                  <ol style={{ margin: '8px 0 0 0', paddingLeft: '1.5rem' }}>
                    <li>Install Cloudflare Tunnel: <code>brew install cloudflared</code></li>
                    <li>Run: <code>cloudflared tunnel --url http://localhost:5001</code></li>
                    <li>Copy the generated URL (e.g., https://xyz.trycloudflare.com)</li>
                    <li>Enter it in Settings → External URL</li>
                  </ol>
                </Box>
              </Alert>
            )}
            {feedUrls.isConfigured && (
              <Box sx={{ my: 2 }}>
                <Alert severity="success">
                  External URL configured. These URLs can be used for calendar subscriptions.
                </Alert>
                {tunnelStatus && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      size="small"
                      icon={tunnelStatus.status === 'connected' ? <CheckCircleIcon /> :
                            tunnelStatus.status === 'not-configured' ? <CloudIcon /> : <ErrorIcon />}
                      label={tunnelStatus.status === 'connected' ? 'Tunnel connected' :
                             tunnelStatus.status === 'not-configured' ? 'No tunnel' : 'Tunnel disconnected'}
                      color={tunnelStatus.status === 'connected' ? 'success' :
                             tunnelStatus.status === 'not-configured' ? 'default' : 'error'}
                    />
                    {tunnelStatus.status !== 'connected' && tunnelStatus.status !== 'not-configured' && (
                      <Typography variant="caption" color="error">
                        {tunnelStatus.message}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">Full Feed (with event details):</Typography>
              <Link href={feedUrls.full} sx={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>
                {feedUrls.full}
              </Link>
            </Box>
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2">Busy Feed (availability only):</Typography>
              <Link href={feedUrls.busy} sx={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>
                {feedUrls.busy}
              </Link>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Feed URLs contain a secure token. Click "Regenerate Secret" in Settings to invalidate old URLs.
            </Typography>
          </Paper>
        )}

        {status && status.health && (
          <Paper sx={{ p: 3, my: 2 }}>
            <Typography variant="h6" gutterBottom>
              System Health
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Alert
                severity={status.health.feedGeneration.status === 'ok' ? 'success' : 'error'}
                sx={{ flex: 1, minWidth: 200 }}
              >
                <strong>Feed Generation:</strong> {status.health.feedGeneration.message}
                {status.health.feedGeneration.eventCount !== undefined && (
                  <Box component="span" sx={{ ml: 1 }}>
                    ({status.health.feedGeneration.eventCount} events, {status.health.feedGeneration.adjustedCount} adjusted)
                  </Box>
                )}
              </Alert>
              <Alert
                severity={status.summary.error === 0 ? 'success' : 'warning'}
                sx={{ flex: 1, minWidth: 200 }}
              >
                <strong>Calendar Fetch:</strong> {status.summary.ok}/{status.summary.total} calendars OK
                {status.summary.error > 0 && ` (${status.summary.error} failed)`}
              </Alert>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 2 }}>
              {status.health.cache && (
                <Alert
                  severity={status.health.cache.isFresh ? 'success' : (status.health.cache.isStale ? 'info' : 'warning')}
                  sx={{ flex: 1, minWidth: 200 }}
                >
                  <strong>Cache:</strong>{' '}
                  {status.health.cache.isFresh && 'Fresh'}
                  {status.health.cache.isStale && 'Stale (refreshing in background)'}
                  {status.health.cache.isExpired && 'Expired'}
                  {status.health.cache.isRefreshing && ' ⟳'}
                  {status.health.cache.ageFormatted && (
                    <Box component="span" sx={{ ml: 1 }}>
                      ({status.health.cache.ageFormatted})
                    </Box>
                  )}
                </Alert>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Last checked: {new Date(status.health.checkedAt).toLocaleString()}
            </Typography>
          </Paper>
        )}

        {status && (
          <Paper sx={{ p: 3, my: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Source Calendars
              </Typography>
              <Button
                startIcon={<AddIcon />}
                variant="contained"
                size="small"
                onClick={() => setAddDialogOpen(true)}
              >
                Add Calendar
              </Button>
            </Box>

            {status.calendars.length === 0 ? (
              <Alert severity="info">
                No calendars configured. Click "Add Calendar" to add your first calendar.
              </Alert>
            ) : (
              status.calendars.map((cal) => (
                <Box
                  key={cal.id}
                  sx={{
                    py: 1.5,
                    px: 1,
                    borderBottom: '1px solid #eee',
                    '&:hover': { bgcolor: '#f9f9f9' },
                    opacity: cal.enabled === false ? 0.5 : 1
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                      {cal.configName || cal.name}
                    </Typography>
                    <Chip
                      label={cal.status}
                      color={cal.status === 'ok' ? 'success' : 'error'}
                      size="small"
                    />
                    <Chip
                      label={cal.mode}
                      variant="outlined"
                      size="small"
                      color={cal.mode === 'personal-timezone' ? 'primary' : 'default'}
                    />
                    <IconButton size="small" onClick={() => openEditDialog(cal)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDeleteCalendar(cal.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  {cal.status === 'ok' && (
                    <Typography variant="body2" color="text.secondary">
                      {cal.eventCount} events
                      {cal.fetchTimeMs && <> · Fetched in {cal.fetchTimeMs}ms</>}
                    </Typography>
                  )}
                  {cal.error && (
                    <Typography variant="body2" color="error">
                      Error: {cal.error}
                    </Typography>
                  )}
                </Box>
              ))
            )}
          </Paper>
        )}

        {preview && (
          <Paper sx={{ p: 3, my: 2 }}>
            <Typography variant="h6" gutterBottom>
              Event Preview
              <Chip
                label={`${preview.total} total`}
                size="small"
                color="primary"
                sx={{ ml: 1 }}
              />
              {preview.adjustedCount > 0 && (
                <Chip
                  label={`${preview.adjustedCount} adjusted`}
                  size="small"
                  color="warning"
                  sx={{ ml: 0.5 }}
                />
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {preview.events.length > 0
                ? `Showing next ${preview.events.length} upcoming events from merged feed.`
                : 'No upcoming events found in the configured date range.'}
            </Typography>
            <Box sx={{ maxHeight: 400, overflow: 'auto', mt: 2 }}>
              {preview.events.map((event, idx) => (
                <Box
                  key={idx}
                  sx={{
                    py: 1,
                    px: 1,
                    borderBottom: '1px solid #eee',
                    bgcolor: event.adjustment ? '#fff8e1' : 'transparent'
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                      {event.summary || '(No title)'}
                    </Typography>
                    {event.adjustment && (
                      <Chip
                        label={`${event.adjustment.hoursAdjusted > 0 ? '+' : ''}${event.adjustment.hoursAdjusted}h`}
                        size="small"
                        color="warning"
                      />
                    )}
                    <Chip
                      label={event.sourceCalendarMode}
                      size="small"
                      variant="outlined"
                      color={event.sourceCalendarMode === 'personal-timezone' ? 'primary' : 'default'}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(event.start).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {event.timezone}
                    {event.sourceCalendar && ` · ${event.sourceCalendar}`}
                  </Typography>
                  {event.adjustment && (
                    <Typography variant="caption" color="warning.dark">
                      Adjusted: {event.adjustment.basis}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Paper>
        )}

        <Paper sx={{ p: 3, my: 2, bgcolor: '#f5f5f5' }}>
          <Typography variant="h6" gutterBottom>
            How It Works
          </Typography>
          <Typography variant="body2" component="div">
            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
              <li><strong>Face Value:</strong> Events appear exactly as they are in the source calendar</li>
              <li><strong>Personal Timezone:</strong> Events are converted to your Default Location timezone (e.g., 3pm Pacific → 6pm Eastern)</li>
              <li><strong>Umbrella Events:</strong> Multi-day events with locations (like hotel stays) override the default location during travel</li>
            </ul>
          </Typography>
        </Paper>

        {/* Add Calendar Dialog */}
        <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Add Calendar</DialogTitle>
          <DialogContent>
            <TextField
              label="iCal URL"
              fullWidth
              margin="normal"
              value={newCalendar.url}
              onChange={(e) => setNewCalendar({ ...newCalendar, url: e.target.value })}
              helperText="Get this from Google Calendar Settings > Integrate calendar > Secret address in iCal format"
            />
            <TextField
              label="Calendar Name"
              fullWidth
              margin="normal"
              value={newCalendar.name}
              onChange={(e) => setNewCalendar({ ...newCalendar, name: e.target.value })}
              helperText="Optional - will use name from calendar if not provided"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Mode</InputLabel>
              <Select
                value={newCalendar.mode}
                label="Mode"
                onChange={(e) => setNewCalendar({ ...newCalendar, mode: e.target.value })}
              >
                <MenuItem value="face-value">Face Value (no adjustment)</MenuItem>
                <MenuItem value="personal-timezone">Personal Timezone (adjust based on location)</MenuItem>
              </Select>
            </FormControl>
            {newCalendar.mode === 'personal-timezone' && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Events will be adjusted based on your Default Location (set in Settings) and any travel/umbrella events with locations.
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddCalendar} variant="contained" disabled={!newCalendar.url}>
              Add Calendar
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit Calendar Dialog */}
        <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Edit Calendar</DialogTitle>
          <DialogContent>
            {editingCalendar && (
              <>
                <TextField
                  label="Calendar Name"
                  fullWidth
                  margin="normal"
                  value={editingCalendar.name}
                  onChange={(e) => setEditingCalendar({ ...editingCalendar, name: e.target.value })}
                />
                <FormControl fullWidth margin="normal">
                  <InputLabel>Mode</InputLabel>
                  <Select
                    value={editingCalendar.mode}
                    label="Mode"
                    onChange={(e) => setEditingCalendar({ ...editingCalendar, mode: e.target.value })}
                  >
                    <MenuItem value="face-value">Face Value (no adjustment)</MenuItem>
                    <MenuItem value="personal-timezone">Personal Timezone (adjust based on location)</MenuItem>
                  </Select>
                </FormControl>
                {editingCalendar.mode === 'personal-timezone' && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="info">
                      Events will be adjusted based on your Default Location (set in Settings) and any travel/umbrella events with locations.
                    </Alert>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Source Timezone</InputLabel>
                      <Select
                        value={editingCalendar.sourceTimezone || ''}
                        label="Source Timezone"
                        onChange={(e) => setEditingCalendar({
                          ...editingCalendar,
                          sourceTimezone: e.target.value || null
                        })}
                      >
                        <MenuItem value="">
                          <em>Auto-detect from calendar {editingCalendar.detectedTimezone ? `(${editingCalendar.detectedTimezone})` : ''}</em>
                        </MenuItem>
                        {commonTimezones.map(tz => (
                          <MenuItem key={tz.value} value={tz.value}>{tz.label}</MenuItem>
                        ))}
                      </Select>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                        {editingCalendar.loadingTimezone
                          ? 'Detecting calendar timezone...'
                          : editingCalendar.detectedTimezone
                            ? `Detected from calendar: ${editingCalendar.detectedTimezone}`
                            : 'Could not detect timezone from calendar'}
                        . UTC-stored events will be interpreted as this timezone.
                      </Typography>
                    </FormControl>
                  </Box>
                )}
                <FormControlLabel
                  control={
                    <Switch
                      checked={editingCalendar.enabled !== false}
                      onChange={(e) => setEditingCalendar({ ...editingCalendar, enabled: e.target.checked })}
                    />
                  }
                  label="Enabled"
                />
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateCalendar} variant="contained">
              Save Changes
            </Button>
          </DialogActions>
        </Dialog>

        {/* Settings Dialog */}
        <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Settings</DialogTitle>
          <DialogContent>
            <TextField
              label="Months to Fetch"
              type="number"
              fullWidth
              margin="normal"
              value={editingSettings.monthsToFetch || 3}
              onChange={(e) => setEditingSettings({ ...editingSettings, monthsToFetch: parseInt(e.target.value, 10) })}
              inputProps={{ min: 1, max: 24 }}
              helperText="How many months of events to include in feeds (1-24)"
            />
            <TextField
              label="External URL (for subscriptions)"
              fullWidth
              margin="normal"
              value={editingSettings.baseUrl || ''}
              onChange={(e) => setEditingSettings({ ...editingSettings, baseUrl: e.target.value })}
              placeholder="https://your-domain.com"
              helperText="Leave empty for localhost. Set this to your public URL for external calendar subscriptions."
            />
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #eee' }}>
              <Typography variant="subtitle2" gutterBottom>Default Location</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Your home location. Used for personal-timezone calendars when no travel/umbrella event applies.
              </Typography>
              <FormControl fullWidth margin="normal">
                <InputLabel>Default Location</InputLabel>
                <Select
                  value={editingSettings.defaultLocation || ''}
                  label="Default Location"
                  onChange={(e) => setEditingSettings({ ...editingSettings, defaultLocation: e.target.value })}
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {commonLocations.map((loc) => (
                    <MenuItem key={loc.location} value={loc.location}>
                      {loc.location} ({loc.timezone})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {settings && settings.defaultLocation && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Current: {settings.defaultLocation}
                </Typography>
              )}
            </Box>
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #eee' }}>
              <Typography variant="subtitle2" gutterBottom>Feed Security</Typography>
              {settings && (
                <Alert severity={settings.hasFeedSecret ? 'success' : 'info'} sx={{ mb: 2 }}>
                  {settings.hasFeedSecret
                    ? 'Feed URLs are secured with a unique token.'
                    : 'Feed secret will be auto-generated on first use.'}
                </Alert>
              )}
              <Button
                variant="outlined"
                color="warning"
                size="small"
                onClick={async () => {
                  if (window.confirm('This will invalidate all existing feed URLs. You will need to re-subscribe to your calendars. Continue?')) {
                    try {
                      const res = await fetch(`${API_URL}/settings/feed-secret/regenerate`, { method: 'POST' });
                      if (res.ok) {
                        setSnackbar({ open: true, message: 'Feed secret regenerated. Update your calendar subscriptions.', severity: 'warning' });
                        fetchData();
                      } else {
                        throw new Error('Failed to regenerate');
                      }
                    } catch (err) {
                      setSnackbar({ open: true, message: 'Failed to regenerate feed secret', severity: 'error' });
                    }
                  }
                }}
              >
                Regenerate Feed Secret
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Regenerating invalidates existing feed URLs for security.
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateSettings} variant="contained">
              Save Settings
            </Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Container>
    </ThemeProvider>
  );
}

export default App;
