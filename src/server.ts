// ──────────────────────────────────────────────────────────────────────────
// server.ts — Express web server for Coin Smith PSBT builder
// ──────────────────────────────────────────────────────────────────────────

import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { buildFromFixture } from './builder';
import { BuilderError, Report } from './types';
import { buildErrorReport } from './reporter';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS support for cross-origin requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ── API Routes ───────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Build PSBT from fixture JSON
app.post('/api/build', (req, res) => {
  try {
    const fixtureJson = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const report = buildFromFixture(fixtureJson);
    res.json(report);
  } catch (e) {
    if (e instanceof BuilderError) {
      res.status(400).json(buildErrorReport(e.code, e.message));
    } else if (e instanceof Error) {
      res.status(500).json(buildErrorReport('INTERNAL_ERROR', e.message));
    } else {
      res.status(500).json(buildErrorReport('INTERNAL_ERROR', 'Unknown error'));
    }
  }
});

// List available fixtures
app.get('/api/fixtures', (_req, res) => {
  try {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    if (fs.existsSync(fixturesDir)) {
      const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
      res.json({ fixtures: files });
    } else {
      res.json({ fixtures: [] });
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to list fixtures' });
  }
});

// Load a specific fixture
app.get('/api/fixtures/:name', (req, res) => {
  try {
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    const filePath = path.join(fixturesDir, req.params.name);
    if (!filePath.startsWith(fixturesDir)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fixture not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.type('application/json').send(content);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load fixture' });
  }
});

// ── Vendor JS (served locally — no CDN / no internet required) ─────────
const nodeModulesDir = path.join(__dirname, '..', 'node_modules');
app.get('/vendor/react.js', (_req, res) => {
  res.sendFile(path.join(nodeModulesDir, 'react', 'umd', 'react.production.min.js'));
});
app.get('/vendor/react-dom.js', (_req, res) => {
  res.sendFile(path.join(nodeModulesDir, 'react-dom', 'umd', 'react-dom.production.min.js'));
});
app.get('/vendor/babel.js', (_req, res) => {
  res.sendFile(path.join(nodeModulesDir, '@babel', 'standalone', 'babel.min.js'));
});

// ── Serve React UI ───────────────────────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Fallback: serve index.html for any non-API route
app.get('*', (_req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Web UI not found. Build the frontend first.');
  }
});

// ── Start server ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  // Print URL to stdout (required by web.sh spec)
  console.log(`http://127.0.0.1:${PORT}`);
});
