/**
 * dashboard/server.ts
 *
 * Web-based file browser accessible from any Tailscale device.
 * Serves files from the VPS locally and from the MacBook via SSH.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { Client } from 'ssh2';
import { config } from '../config.js';

const app = express();
const PORT = 3000;

// Device definitions
interface Device {
    name: string;
    type: 'local' | 'ssh';
    icon: string;
    rootPath: string;
    // SSH-only fields
    host?: string;
    username?: string;
    privateKeyPath?: string;
}

const DEVICES: Device[] = [
    {
        name: 'VPS (Contabo)',
        type: 'local',
        icon: 'server',
        rootPath: '/root',
    },
    {
        name: 'MacBook Air',
        type: 'ssh',
        icon: 'laptop',
        rootPath: '/Users/abhismac',
        host: '100.81.218.116',
        username: 'abhismac',
        privateKeyPath: '/root/.ssh/id_ed25519',
    },
];

// ============================
// LOCAL FILE OPERATIONS
// ============================
function listLocal(dirPath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const items = entries
                .filter(e => !e.name.startsWith('.'))
                .map(e => ({
                    name: e.name,
                    isDirectory: e.isDirectory(),
                    size: e.isDirectory() ? null : (() => { try { return fs.statSync(path.join(dirPath, e.name)).size; } catch { return 0; } })(),
                    modified: (() => { try { return fs.statSync(path.join(dirPath, e.name)).mtime.toISOString(); } catch { return null; } })(),
                }))
                .sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            resolve(items);
        } catch (e: any) {
            reject(e);
        }
    });
}

function readLocalFile(filePath: string): fs.ReadStream {
    return fs.createReadStream(filePath);
}

// ============================
// SSH FILE OPERATIONS
// ============================
function getSSHConnection(device: Device): Promise<Client> {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        conn.on('ready', () => resolve(conn));
        conn.on('error', (err) => reject(err));
        conn.connect({
            host: device.host!,
            port: 22,
            username: device.username!,
            privateKey: fs.readFileSync(device.privateKeyPath!),
            readyTimeout: 10000,
        });
    });
}

function listSSH(device: Device, dirPath: string): Promise<any[]> {
    return new Promise(async (resolve, reject) => {
        let conn: Client | null = null;
        try {
            conn = await getSSHConnection(device);
            conn.sftp((err, sftp) => {
                if (err) { conn?.end(); return reject(err); }
                sftp.readdir(dirPath, (err, list) => {
                    conn?.end();
                    if (err) return reject(err);
                    const items = list
                        .filter(e => !e.filename.startsWith('.'))
                        .map(e => ({
                            name: e.filename,
                            isDirectory: (e.attrs as any).isDirectory(),
                            size: (e.attrs as any).isDirectory() ? null : e.attrs.size,
                            modified: new Date((e.attrs.mtime || 0) * 1000).toISOString(),
                        }))
                        .sort((a, b) => {
                            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                            return a.name.localeCompare(b.name);
                        });
                    resolve(items);
                });
            });
        } catch (e) {
            conn?.end();
            reject(e);
        }
    });
}

function readSSHFile(device: Device, filePath: string): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
        let conn: Client | null = null;
        try {
            conn = await getSSHConnection(device);
            conn.sftp((err, sftp) => {
                if (err) { conn?.end(); return reject(err); }
                const chunks: Buffer[] = [];
                const stream = sftp.createReadStream(filePath);
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => { conn?.end(); resolve(Buffer.concat(chunks)); });
                stream.on('error', (e: Error) => { conn?.end(); reject(e); });
            });
        } catch (e) {
            conn?.end();
            reject(e);
        }
    });
}

// ============================
// MIME TYPE DETECTION
// ============================
const MIME_TYPES: Record<string, string> = {
    // Text
    txt: 'text/plain', md: 'text/plain', log: 'text/plain', csv: 'text/plain',
    json: 'application/json', xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml',
    toml: 'text/plain', ini: 'text/plain', cfg: 'text/plain', conf: 'text/plain',
    env: 'text/plain', gitignore: 'text/plain', dockerignore: 'text/plain',
    // Code
    js: 'text/plain', ts: 'text/plain', py: 'text/plain', rb: 'text/plain',
    go: 'text/plain', rs: 'text/plain', java: 'text/plain', c: 'text/plain',
    cpp: 'text/plain', h: 'text/plain', swift: 'text/plain', kt: 'text/plain',
    php: 'text/plain', sh: 'text/plain', bash: 'text/plain', zsh: 'text/plain',
    sql: 'text/plain', css: 'text/css', html: 'text/html', htm: 'text/html',
    makefile: 'text/plain', dockerfile: 'text/plain', lock: 'text/plain',
    // Images
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
    // Documents
    pdf: 'application/pdf',
    // Audio / Video
    mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm',
    // Archives
    zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
};

function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return MIME_TYPES[ext] || 'application/octet-stream';
}

// ============================
// SECURITY: Path validation
// ============================
function safePath(rootPath: string, requestedPath: string): string {
    const resolved = path.resolve(rootPath, requestedPath);
    if (!resolved.startsWith(rootPath)) {
        throw new Error('Path traversal blocked');
    }
    return resolved;
}

// ============================
// API ROUTES
// ============================

// List devices
app.get('/api/devices', (_req, res) => {
    res.json(DEVICES.map((d, i) => ({
        id: i,
        name: d.name,
        icon: d.icon,
        type: d.type,
        rootPath: d.rootPath,
    })));
});

// List directory
app.get('/api/files/:deviceId', async (req, res) => {
    try {
        const deviceId = parseInt(req.params.deviceId);
        const device = DEVICES[deviceId];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const relPath = (req.query.path as string) || '';
        const fullPath = safePath(device.rootPath, relPath);

        let items;
        if (device.type === 'local') {
            items = await listLocal(fullPath);
        } else {
            items = await listSSH(device, fullPath);
        }

        res.json({ path: relPath || '/', items });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Download / view file
app.get('/api/download/:deviceId', async (req, res) => {
    try {
        const deviceId = parseInt(req.params.deviceId);
        const device = DEVICES[deviceId];
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const relPath = req.query.path as string;
        if (!relPath) return res.status(400).json({ error: 'path required' });

        const fullPath = safePath(device.rootPath, relPath);
        const filename = path.basename(fullPath);

        const mime = getMimeType(filename);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        if (device.type === 'local') {
            readLocalFile(fullPath).pipe(res);
        } else {
            const data = await readSSHFile(device, fullPath);
            res.send(data);
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ============================
// SERVE FRONTEND
// ============================
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Gravity Claw - File Browser</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #58a6ff;
    --accent-hover: #79c0ff;
    --green: #3fb950;
    --orange: #d29922;
    --red: #f85149;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* Header */
  .header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 600;
    background: linear-gradient(135deg, var(--accent), #a371f7);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .header .subtitle {
    font-size: 12px;
    color: var(--text-dim);
  }

  /* Device tabs */
  .device-tabs {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .device-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 14px;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .device-tab:hover { border-color: var(--accent); color: var(--text); }
  .device-tab.active {
    border-color: var(--accent);
    background: rgba(88, 166, 255, 0.1);
    color: var(--text);
  }
  .device-tab .status-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    flex-shrink: 0;
  }
  .device-tab .status-dot.offline { background: var(--red); }

  /* Breadcrumb */
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 20px;
    font-size: 13px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }
  .breadcrumb span {
    cursor: pointer;
    color: var(--accent);
    padding: 2px 4px;
    border-radius: 4px;
  }
  .breadcrumb span:hover { background: rgba(88,166,255,0.1); }
  .breadcrumb .sep { color: var(--text-dim); cursor: default; }
  .breadcrumb .sep:hover { background: none; }

  /* File list */
  .file-list {
    padding: 0 20px 20px;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.1s;
    border-bottom: 1px solid var(--border);
  }
  .file-item:hover { background: var(--surface); }
  .file-item .icon { font-size: 20px; flex-shrink: 0; width: 28px; text-align: center; }
  .file-item .name { flex: 1; font-size: 14px; word-break: break-all; }
  .file-item .meta {
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    text-align: right;
  }

  /* Loading & Error */
  .loading, .error-msg, .empty-msg {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-dim);
    font-size: 14px;
  }
  .error-msg { color: var(--red); }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Preview overlay */
  .preview-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.85);
    z-index: 200;
    display: none;
    flex-direction: column;
  }
  .preview-overlay.active { display: flex; }
  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .preview-header .filename { font-size: 14px; font-weight: 600; }
  .preview-header button {
    background: none; border: 1px solid var(--border);
    color: var(--text); padding: 6px 14px;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }
  .preview-header button:hover { border-color: var(--accent); }
  .preview-content {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }
  .preview-content pre {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text);
  }
  .preview-content img {
    max-width: 100%;
    border-radius: 8px;
  }

  /* Mobile */
  @media (max-width: 600px) {
    .header h1 { font-size: 16px; }
    .file-item .meta { display: none; }
    .file-item { padding: 12px 8px; }
    .breadcrumb { padding: 8px 12px; font-size: 12px; }
    .file-list { padding: 0 8px 20px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Gravity Claw</h1>
  <span class="subtitle">File Browser</span>
</div>

<div class="device-tabs" id="deviceTabs"></div>
<div class="breadcrumb" id="breadcrumb"></div>
<div class="file-list" id="fileList"></div>

<!-- Preview overlay -->
<div class="preview-overlay" id="previewOverlay">
  <div class="preview-header">
    <span class="filename" id="previewFilename"></span>
    <div style="display:flex;gap:8px;">
      <button onclick="downloadCurrent()">Download</button>
      <button onclick="closePreview()">Close</button>
    </div>
  </div>
  <div class="preview-content" id="previewContent"></div>
</div>

<script>
let devices = [];
let activeDevice = 0;
let currentPath = '';
let currentDownloadUrl = '';

// Format file size
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  if (bytes < 1024*1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
  return (bytes/(1024*1024*1024)).toFixed(1) + ' GB';
}

// Format date
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  if (diff < 86400000*7) return d.toLocaleDateString([], {weekday:'short'});
  return d.toLocaleDateString([], {month:'short',day:'numeric'});
}

// File icon
function getIcon(name, isDir) {
  if (isDir) return '\u{1F4C1}';
  const ext = name.split('.').pop()?.toLowerCase();
  const icons = {
    js:'\\u{1F7E8}', ts:'\\u{1F535}', py:'\\u{1F40D}', json:'\\u{1F4CB}',
    md:'\\u{1F4DD}', txt:'\\u{1F4C4}', html:'\\u{1F310}', css:'\\u{1F3A8}',
    png:'\\u{1F5BC}', jpg:'\\u{1F5BC}', jpeg:'\\u{1F5BC}', gif:'\\u{1F5BC}', svg:'\\u{1F5BC}',
    mp3:'\\u{1F3B5}', wav:'\\u{1F3B5}', mp4:'\\u{1F3AC}', mov:'\\u{1F3AC}',
    zip:'\\u{1F4E6}', tar:'\\u{1F4E6}', gz:'\\u{1F4E6}',
    pdf:'\\u{1F4D5}', env:'\\u{1F512}', log:'\\u{1F4DC}',
  };
  return icons[ext] || '\\u{1F4C4}';
}

// Device icon
function getDeviceIcon(icon) {
  return icon === 'server' ? '\\u{1F5A5}' : '\\u{1F4BB}';
}

// Load devices
async function loadDevices() {
  const res = await fetch('/api/devices');
  devices = await res.json();
  renderDeviceTabs();
  loadDirectory('');
}

function renderDeviceTabs() {
  const el = document.getElementById('deviceTabs');
  el.innerHTML = devices.map((d, i) =>
    '<div class="device-tab ' + (i === activeDevice ? 'active' : '') + '" onclick="switchDevice(' + i + ')">' +
    '<span class="status-dot"></span>' +
    '<span>' + getDeviceIcon(d.icon) + ' ' + d.name + '</span></div>'
  ).join('');
}

function switchDevice(id) {
  activeDevice = id;
  currentPath = '';
  renderDeviceTabs();
  loadDirectory('');
}

// Load directory
async function loadDirectory(relPath) {
  currentPath = relPath;
  renderBreadcrumb();

  const el = document.getElementById('fileList');
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';

  try {
    const res = await fetch('/api/files/' + activeDevice + '?path=' + encodeURIComponent(relPath));
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.items.length === 0) {
      el.innerHTML = '<div class="empty-msg">This folder is empty</div>';
      return;
    }

    el.innerHTML = data.items.map(item =>
      '<div class="file-item" onclick="' + (item.isDirectory
        ? "loadDirectory('" + (relPath ? relPath + '/' : '') + item.name.replace(/'/g, "\\\\'") + "')"
        : "previewFile('" + (relPath ? relPath + '/' : '') + item.name.replace(/'/g, "\\\\'") + "')") + '">' +
      '<span class="icon">' + getIcon(item.name, item.isDirectory) + '</span>' +
      '<span class="name">' + item.name + '</span>' +
      '<span class="meta">' + (item.isDirectory ? '' : formatSize(item.size)) + ' ' + formatDate(item.modified) + '</span>' +
      '</div>'
    ).join('');
  } catch (e) {
    el.innerHTML = '<div class="error-msg">Error: ' + e.message + '</div>';
  }
}

// Breadcrumb
function renderBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  const root = devices[activeDevice]?.rootPath || '/';
  const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  let html = '<span onclick="loadDirectory(\\'\\')">' + root + '</span>';
  let accumulated = '';
  for (const part of parts) {
    accumulated += (accumulated ? '/' : '') + part;
    const p = accumulated;
    html += '<span class="sep">/</span><span onclick="loadDirectory(\\'' + p.replace(/'/g, "\\\\'") + '\\')">' + part + '</span>';
  }
  el.innerHTML = html;
}

// Preview
const TEXT_EXTS = ['txt','md','js','ts','py','json','html','css','xml','yaml','yml','toml',
  'sh','bash','zsh','env','log','csv','sql','rs','go','java','c','cpp','h','rb','php','swift',
  'kt','conf','cfg','ini','gitignore','dockerfile','makefile','lock'];
const IMG_EXTS = ['png','jpg','jpeg','gif','svg','webp','ico','bmp'];

async function previewFile(relPath) {
  const filename = relPath.split('/').pop();
  const ext = filename.split('.').pop()?.toLowerCase();
  const url = '/api/download/' + activeDevice + '?path=' + encodeURIComponent(relPath);
  currentDownloadUrl = url;

  document.getElementById('previewFilename').textContent = filename;
  const content = document.getElementById('previewContent');

  if (IMG_EXTS.includes(ext)) {
    content.innerHTML = '<img src="' + url + '" alt="' + filename + '">';
  } else if (TEXT_EXTS.includes(ext) || !ext) {
    content.innerHTML = '<div class="loading"><div class="spinner"></div>Loading...</div>';
    try {
      const res = await fetch(url);
      const text = await res.text();
      const pre = document.createElement('pre');
      pre.textContent = text.slice(0, 500000); // Limit preview size
      content.innerHTML = '';
      content.appendChild(pre);
    } catch (e) {
      content.innerHTML = '<div class="error-msg">Cannot preview: ' + e.message + '</div>';
    }
  } else {
    content.innerHTML = '<div class="empty-msg">No preview available for .' + ext + ' files.<br><br>Click Download to save the file.</div>';
  }

  document.getElementById('previewOverlay').classList.add('active');
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('active');
}

function downloadCurrent() {
  if (currentDownloadUrl) {
    const a = document.createElement('a');
    a.href = currentDownloadUrl;
    a.download = '';
    a.click();
  }
}

// Close preview on Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

// Init
loadDevices();
</script>
</body>
</html>`;

app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(FRONTEND_HTML);
});

// ============================
// START SERVER
// ============================
export function startDashboard(): Promise<void> {
    return new Promise((resolve) => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`[Dashboard] File browser running at http://0.0.0.0:${PORT}`);
            console.log(`[Dashboard] Access via Tailscale: http://100.86.164.51:${PORT}`);
            resolve();
        });
    });
}

// Allow standalone execution
if (process.argv[1]?.includes('dashboard')) {
    startDashboard();
}
