// Star One Offer Manager: edits the website's offer (src/data/offer.json) and publishes it.
// Two publish targets:
//   github: commits offer.json to the website repo; Cloudflare Pages rebuilds the site (about 1–2 min).
//   folder: writes offer.json into a local copy of the website (for testing).
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  mode: 'github',
  repo: '',
  branch: 'main',
  file: 'src/data/offer.json',
  folder: '',
  siteUrl: 'https://staronegym.in',
};
const userFile = (name) => path.join(app.getPath('userData'), name);
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

// ---------- settings (the GitHub token is encrypted with the OS keychain) ----------
function loadSettings() {
  return { ...DEFAULTS, ...readJson(userFile('settings.json'), {}) };
}
function token() {
  const s = loadSettings();
  if (!s.tokenEnc) return '';
  try { return safeStorage.decryptString(Buffer.from(s.tokenEnc, 'base64')); } catch { return ''; }
}
function publicSettings() {
  const { tokenEnc, ...rest } = loadSettings();
  return { ...rest, hasToken: Boolean(tokenEnc) };
}
function saveSettings(next) {
  const cur = loadSettings();
  const merged = { ...cur, ...next };
  delete merged.token;
  delete merged.hasToken;
  if (typeof next.token === 'string' && next.token.trim()) {
    merged.tokenEnc = safeStorage.encryptString(next.token.trim()).toString('base64');
  }
  if (next.clearToken) delete merged.tokenEnc;
  delete merged.clearToken;
  writeJson(userFile('settings.json'), merged);
  return publicSettings();
}

// ---------- targets ----------
async function gh(method, url, body) {
  const t = token();
  if (!t) throw new Error('No GitHub access key saved. Add it in Settings.');
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'star-one-offer-manager',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 401 ? 'The access key is wrong or expired.'
      : res.status === 404 ? 'Website repository or file not found. Check Settings.'
      : res.status === 403 ? 'The access key is not allowed to change this repository.'
      : data.message || `GitHub error ${res.status}`;
    throw new Error(hint);
  }
  return data;
}
const ghPath = (s) => `/repos/${s.repo}/contents/${s.file.split('/').map(encodeURIComponent).join('/')}`;

async function readOffer() {
  const s = loadSettings();
  if (s.mode === 'folder') {
    if (!s.folder) throw new Error('Choose the website folder in Settings.');
    const raw = fs.readFileSync(path.join(s.folder, s.file), 'utf8');
    return { offer: JSON.parse(raw), where: path.join(s.folder, s.file) };
  }
  if (!s.repo) throw new Error('Add the website repository in Settings.');
  const data = await gh('GET', `${ghPath(s)}?ref=${encodeURIComponent(s.branch)}`);
  return { offer: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')), sha: data.sha, where: `${s.repo}@${s.branch}` };
}

async function writeOffer(offer) {
  const s = loadSettings();
  const body = JSON.stringify(offer, null, 2) + '\n';
  if (s.mode === 'folder') {
    if (!s.folder) throw new Error('Choose the website folder in Settings.');
    fs.writeFileSync(path.join(s.folder, s.file), body);
    return { where: path.join(s.folder, s.file) };
  }
  const cur = await readOffer();
  const msg = offer.active ? `Offer: ${offer.name} (till ${offer.until})` : 'Offer turned off';
  const res = await gh('PUT', ghPath(s), {
    message: `${msg} [Offer Manager]`,
    content: Buffer.from(body, 'utf8').toString('base64'),
    sha: cur.sha,
    branch: s.branch,
  });
  return { where: `${s.repo}@${s.branch}`, commit: res.commit?.html_url };
}

// ---------- validation (the site trusts this file, so keep it tidy) ----------
const LIMITS = { name: 40, chip: 44, headline: 16, highlight: 14, detail: 70, button: 26, whatsapp: 300 };
function clean(o) {
  const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = {
    active: Boolean(o.active),
    name: str(o.name, LIMITS.name),
    chip: str(o.chip, LIMITS.chip),
    headline: str(o.headline, LIMITS.headline),
    highlight: str(o.highlight, LIMITS.highlight),
    detail: str(o.detail, LIMITS.detail),
    until: /^\d{4}-\d{2}-\d{2}$/.test(o.until) ? o.until : '',
    button: str(o.button, LIMITS.button) || 'Claim on WhatsApp',
    whatsapp: String(o.whatsapp ?? '').trim().slice(0, LIMITS.whatsapp),
    prices: (Array.isArray(o.prices) ? o.prices : [])
      .map((p) => ({ plan: str(p.plan, 20), price: str(p.price, 16) }))
      .filter((p) => p.plan && p.price)
      .slice(0, 4),
    updatedAt: new Date().toISOString(),
  };
  if (out.active && (!out.name || !out.headline || !out.until)) throw new Error('Offer name, big line and end date are required.');
  return out;
}

// ---------- IPC ----------
const wrap = (fn) => async (_e, ...args) => {
  try { return { ok: true, ...(await fn(...args)) }; } catch (err) { return { ok: false, error: err.message }; }
};
ipcMain.handle('settings:get', wrap(async () => ({ settings: publicSettings() })));
ipcMain.handle('settings:save', wrap(async (s) => ({ settings: saveSettings(s) })));
ipcMain.handle('offer:load', wrap(readOffer));
ipcMain.handle('offer:publish', wrap(async (offer) => {
  const tidy = clean(offer);
  const res = await writeOffer(tidy);
  const history = readJson(userFile('history.json'), []);
  history.unshift({ at: tidy.updatedAt, offer: tidy });
  writeJson(userFile('history.json'), history.slice(0, 40));
  return { offer: tidy, ...res };
}));
ipcMain.handle('history:list', wrap(async () => ({ history: readJson(userFile('history.json'), []) })));
ipcMain.handle('open:url', wrap(async (url) => {
  if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened.');
  await shell.openExternal(url);
  return {};
}));

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0a0a0b',
    title: 'Star One Offer Manager',
    icon: path.join(__dirname, 'renderer', 'img', 'crest.webp'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0d0e', symbolColor: '#c7c9cc', height: 46 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // QA hook: OM_SNAPSHOT=<file.png> [OM_VIEW=history|settings] captures the window and quits.
  if (process.env.OM_SNAPSHOT) {
    win.webContents.once('did-finish-load', async () => {
      if (process.env.OM_VIEW) await win.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(process.env.OM_VIEW)})`);
      if (process.env.OM_JS) await win.webContents.executeJavaScript(process.env.OM_JS);
      setTimeout(async () => {
        fs.writeFileSync(process.env.OM_SNAPSHOT, (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 2500);
    });
  }
}

if (process.env.OM_USERDATA) app.setPath('userData', process.env.OM_USERDATA);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
