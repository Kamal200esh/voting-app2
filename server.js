const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, verifyAdmin } = require('./db/database.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- In-memory admin session store ----------
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 4;

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) { sessions.delete(token); return null; }
  return session;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  return cookies;
}

function requireAdmin(req) {
  const cookies = parseCookies(req);
  return getSession(cookies.admin_token);
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Route handlers ----------
async function handleApi(req, res, urlPath) {
  const method = req.method;

  // ---- Admin auth ----
  if (urlPath === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    const { username, password } = body;
    if (!username || !password) return sendJSON(res, 400, { error: 'Username and password required' });
    if (!verifyAdmin(username, password)) return sendJSON(res, 401, { error: 'Invalid username or password' });
    const token = createSession(username);
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Strict`);
    return sendJSON(res, 200, { success: true, username });
  }

  if (urlPath === '/api/admin/logout' && method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.admin_token) sessions.delete(cookies.admin_token);
    res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
    return sendJSON(res, 200, { success: true });
  }

  if (urlPath === '/api/admin/me' && method === 'GET') {
    const session = requireAdmin(req);
    if (!session) return sendJSON(res, 401, { error: 'Not authenticated' });
    return sendJSON(res, 200, { username: session.username });
  }

  if (urlPath.startsWith('/api/admin/')) {
    const session = requireAdmin(req);
    if (!session) return sendJSON(res, 401, { error: 'Not authenticated' });
  }

  // ---- Positions: admin management ----
  if (urlPath === '/api/admin/positions' && method === 'GET') {
    const positions = db.prepare('SELECT * FROM positions ORDER BY sort_order ASC, id ASC').all();
    return sendJSON(res, 200, { positions });
  }

  if (urlPath === '/api/admin/positions' && method === 'POST') {
    const body = await readBody(req);
    const title = (body.title || '').trim();
    if (!title) return sendJSON(res, 400, { error: 'Position title is required' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM positions').get().m || 0;
    const result = db.prepare('INSERT INTO positions (title, sort_order) VALUES (?, ?)').run(title, maxOrder + 1);
    return sendJSON(res, 201, { id: Number(result.lastInsertRowid), title });
  }

  if (urlPath.match(/^\/api\/admin\/positions\/\d+$/) && method === 'DELETE') {
    const id = Number(urlPath.split('/').pop());
    // Unlink candidates from this position
    db.prepare('UPDATE candidates SET position_id = NULL WHERE position_id = ?').run(id);
    db.prepare('DELETE FROM positions WHERE id = ?').run(id);
    return sendJSON(res, 200, { success: true });
  }

  // ---- Candidates: admin management ----
  if (urlPath === '/api/admin/candidates' && method === 'GET') {
    const candidates = db.prepare(`
      SELECT c.*, p.title AS position_title
      FROM candidates c
      LEFT JOIN positions p ON c.position_id = p.id
      ORDER BY p.sort_order ASC, c.id ASC
    `).all();
    return sendJSON(res, 200, { candidates });
  }

  if (urlPath === '/api/admin/candidates' && method === 'POST') {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    const party = (body.party || '').trim();
    const photo_url = body.photo_url || null;
    const position_id = body.position_id ? Number(body.position_id) : null;
    if (!name) return sendJSON(res, 400, { error: 'Candidate name is required' });
    const result = db.prepare('INSERT INTO candidates (name, party, photo_url, position_id) VALUES (?, ?, ?, ?)').run(name, party || null, photo_url, position_id);
    return sendJSON(res, 201, { id: Number(result.lastInsertRowid), name, party, position_id });
  }

  if (urlPath.match(/^\/api\/admin\/candidates\/\d+$/) && method === 'DELETE') {
    const id = Number(urlPath.split('/').pop());
    db.prepare('DELETE FROM votes WHERE candidate_id = ?').run(id);
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    return sendJSON(res, 200, { success: true });
  }

  // ---- Voters: admin management ----
  if (urlPath === '/api/admin/voters' && method === 'GET') {
    const voters = db.prepare('SELECT * FROM voters ORDER BY created_at DESC').all();
    return sendJSON(res, 200, { voters });
  }

  if (urlPath === '/api/admin/voters' && method === 'POST') {
    const body = await readBody(req);
    const id = (body.id || '').trim();
    const name = (body.name || '').trim();
    if (!id || !name) return sendJSON(res, 400, { error: 'Voter ID and name are required' });
    const existing = db.prepare('SELECT id FROM voters WHERE id = ?').get(id);
    if (existing) return sendJSON(res, 409, { error: 'A voter with this ID already exists' });
    db.prepare('INSERT INTO voters (id, name) VALUES (?, ?)').run(id, name);
    return sendJSON(res, 201, { id, name });
  }

  if (urlPath.match(/^\/api\/admin\/voters\/[^/]+$/) && method === 'DELETE') {
    const id = decodeURIComponent(urlPath.split('/').pop());
    db.prepare('DELETE FROM voters WHERE id = ?').run(id);
    return sendJSON(res, 200, { success: true });
  }

  // ---- Election settings ----
  if (urlPath === '/api/admin/settings' && method === 'GET') {
    const settings = db.prepare('SELECT * FROM election_settings WHERE id = 1').get();
    return sendJSON(res, 200, settings);
  }

  if (urlPath === '/api/admin/settings' && method === 'POST') {
    const body = await readBody(req);
    const { title, is_open } = body;
    const current = db.prepare('SELECT * FROM election_settings WHERE id = 1').get();
    db.prepare('UPDATE election_settings SET title = ?, is_open = ? WHERE id = 1').run(
      title !== undefined ? title : current.title,
      is_open !== undefined ? (is_open ? 1 : 0) : current.is_open
    );
    return sendJSON(res, 200, { success: true });
  }

  if (urlPath === '/api/admin/results' && method === 'GET') {
    const positions = db.prepare('SELECT * FROM positions ORDER BY sort_order ASC, id ASC').all();
    const positionsWithCandidates = positions.map(pos => ({
      ...pos,
      candidates: db.prepare('SELECT * FROM candidates WHERE position_id = ? ORDER BY votes DESC, name ASC').all(pos.id),
    }));
    // Candidates without a position
    const unassigned = db.prepare('SELECT * FROM candidates WHERE position_id IS NULL ORDER BY votes DESC, name ASC').all();
    const totalVoters = db.prepare('SELECT COUNT(*) AS c FROM voters').get().c;
    const totalVoted = db.prepare('SELECT COUNT(*) AS c FROM voters WHERE has_voted = 1').get().c;
    return sendJSON(res, 200, { positions: positionsWithCandidates, unassigned, totalVoters, totalVoted });
  }

  if (urlPath === '/api/admin/reset-votes' && method === 'POST') {
    db.prepare('UPDATE candidates SET votes = 0').run();
    db.prepare('UPDATE voters SET has_voted = 0, voted_at = NULL').run();
    db.prepare('DELETE FROM votes').run();
    return sendJSON(res, 200, { success: true });
  }

  // ---- Public: student-facing endpoints ----

  if (urlPath === '/api/election-info' && method === 'GET') {
    const settings = db.prepare('SELECT title, is_open FROM election_settings WHERE id = 1').get();
    return sendJSON(res, 200, settings);
  }

  if (urlPath === '/api/verify-voter' && method === 'POST') {
    const body = await readBody(req);
    const id = (body.id || '').trim();
    if (!id) return sendJSON(res, 400, { error: 'Please enter your student ID' });
    const voter = db.prepare('SELECT * FROM voters WHERE id = ?').get(id);
    if (!voter) return sendJSON(res, 404, { error: 'We could not find that student ID. Please check and try again.' });
    if (voter.has_voted) return sendJSON(res, 403, { error: 'This ID has already been used to vote.', already_voted: true, name: voter.name });
    const settings = db.prepare('SELECT is_open FROM election_settings WHERE id = 1').get();
    if (!settings.is_open) return sendJSON(res, 403, { error: 'Voting is currently closed.' });
    return sendJSON(res, 200, { id: voter.id, name: voter.name });
  }

  // Returns positions with their candidates
  if (urlPath === '/api/ballot' && method === 'GET') {
    const positions = db.prepare('SELECT * FROM positions ORDER BY sort_order ASC, id ASC').all();
    const ballot = positions.map(pos => ({
      id: pos.id,
      title: pos.title,
      candidates: db.prepare('SELECT id, name, party, photo_url FROM candidates WHERE position_id = ? ORDER BY name ASC').all(pos.id),
    })).filter(pos => pos.candidates.length > 0);
    return sendJSON(res, 200, { ballot });
  }

  // Cast vote: accepts votes for multiple positions at once
  if (urlPath === '/api/cast-vote' && method === 'POST') {
    const body = await readBody(req);
    const voterId = (body.voterId || '').trim();
    // votes: { [positionId]: candidateId, ... }
    const votes = body.votes;

    if (!voterId || !votes || typeof votes !== 'object') {
      return sendJSON(res, 400, { error: 'Missing voter or vote information' });
    }

    const settings = db.prepare('SELECT is_open FROM election_settings WHERE id = 1').get();
    if (!settings.is_open) return sendJSON(res, 403, { error: 'Voting is currently closed.' });

    const voter = db.prepare('SELECT * FROM voters WHERE id = ?').get(voterId);
    if (!voter) return sendJSON(res, 404, { error: 'Voter not found' });
    if (voter.has_voted) return sendJSON(res, 403, { error: 'You have already voted.' });

    // Validate all candidates
    const voteEntries = Object.entries(votes);
    if (voteEntries.length === 0) return sendJSON(res, 400, { error: 'No votes submitted' });

    for (const [positionId, candidateId] of voteEntries) {
      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ? AND position_id = ?').get(Number(candidateId), Number(positionId));
      if (!candidate) return sendJSON(res, 400, { error: `Invalid vote for position ${positionId}` });
    }

    // Record all votes atomically using explicit transaction
    db.exec('BEGIN');
    try {
      for (const [positionId, candidateId] of voteEntries) {
        db.prepare('UPDATE candidates SET votes = votes + 1 WHERE id = ?').run(Number(candidateId));
        db.prepare('INSERT INTO votes (voter_id, candidate_id, position_id) VALUES (?, ?, ?)').run(voterId, Number(candidateId), Number(positionId));
      }
      db.prepare(`UPDATE voters SET has_voted = 1, voted_at = datetime('now') WHERE id = ?`).run(voterId);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    // Return what they voted for (for receipt)
    const receipt = voteEntries.map(([positionId, candidateId]) => {
      const candidate = db.prepare('SELECT name FROM candidates WHERE id = ?').get(Number(candidateId));
      const position = db.prepare('SELECT title FROM positions WHERE id = ?').get(Number(positionId));
      return { position: position ? position.title : 'Unknown', candidate: candidate ? candidate.name : 'Unknown' };
    });

    return sendJSON(res, 200, { success: true, receipt });
  }

  return sendJSON(res, 404, { error: 'Not found' });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/api/')) {
    try { await handleApi(req, res, urlPath); } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
    return;
  }
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log(`\n  Voting app running at http://localhost:${PORT}`);
  console.log(`  Admin panel:  http://localhost:${PORT}/admin.html`);
  console.log(`  Student vote: http://localhost:${PORT}/index.html\n`);
});
