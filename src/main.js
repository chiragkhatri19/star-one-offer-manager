// Star One Offer Manager: edits the website's seasonal offer and publishes it.
// Two publish targets:
//   website: reads and writes https://staronegym.com/api/offer (a Cloudflare Pages Function that
//            stores the offer in KV). Publishing needs the Offer Manager password; the site picks
//            the change up within about a minute, no rebuild.
//   folder:  writes src/data/offer.json into a local copy of the website (testing only; set
//            "mode": "folder" in settings.json by hand).
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const SITE = 'https://staronegym.com';
const DEFAULTS = {
  mode: 'website',
  siteUrl: SITE,
  folder: '',
  file: 'src/data/offer.json',
};
const userFile = (name) => path.join(app.getPath('userData'), name);
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

// ---------- settings (the password is encrypted with the OS keychain) ----------
function loadSettings() {
  const s = { ...DEFAULTS, ...readJson(userFile('settings.json'), {}) };
  // 1.0.0 published through GitHub and defaulted to the wrong domain
  if (s.mode !== 'folder') s.mode = 'website';
  if (!/^https:\/\//.test(s.siteUrl || '') || /staronegym\.in/.test(s.siteUrl)) s.siteUrl = SITE;
  s.siteUrl = s.siteUrl.replace(/\/+$/, '');
  delete s.repo; delete s.branch; delete s.tokenEnc;
  return s;
}
function password() {
  const s = loadSettings();
  if (!s.passEnc) return '';
  try { return safeStorage.decryptString(Buffer.from(s.passEnc, 'base64')); } catch { return ''; }
}
function publicSettings() {
  const { passEnc, ...rest } = loadSettings();
  return { ...rest, hasPass: Boolean(passEnc) };
}
function saveSettings(next) {
  const merged = { ...loadSettings(), ...next };
  delete merged.pass;
  delete merged.hasPass;
  if (typeof next.pass === 'string' && next.pass.trim()) {
    merged.passEnc = safeStorage.encryptString(next.pass.trim()).toString('base64');
  }
  writeJson(userFile('settings.json'), merged);
  return publicSettings();
}

// ---------- targets ----------
async function api(method, body, pass) {
  const s = loadSettings();
  const host = new URL(s.siteUrl).host;
  let res;
  try {
    res = await fetch(`${s.siteUrl}/api/offer`, {
      method,
      cache: 'no-store',
      headers: {
        'User-Agent': 'star-one-offer-manager',
        ...(pass ? { Authorization: `Bearer ${pass}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach ${host}. Check the internet connection and try again.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('The password is wrong. Check it in Settings.');
  if (!res.ok && !(method === 'GET' && res.status === 404)) throw new Error(data.error || `${host} answered with error ${res.status}. Try again in a minute.`);
  return res.status === 404 ? null : data;
}
const needPass = () => {
  const p = password();
  if (!p) throw new Error('Enter the Offer Manager password in Settings first.');
  return p;
};

async function readOffer() {
  const s = loadSettings();
  if (s.mode === 'folder') {
    if (!s.folder) throw new Error('Choose the website folder in settings.json.');
    const file = path.join(s.folder, s.file);
    return { offer: JSON.parse(fs.readFileSync(file, 'utf8')), where: file };
  }
  const offer = await api('GET');
  return { offer: offer || { active: false, prices: [] }, where: new URL(s.siteUrl).host };
}

async function writeOffer(offer) {
  const s = loadSettings();
  if (s.mode === 'folder') {
    if (!s.folder) throw new Error('Choose the website folder in settings.json.');
    const file = path.join(s.folder, s.file);
    fs.writeFileSync(file, JSON.stringify(offer, null, 2) + '\n');
    return { where: file };
  }
  await api('PUT', offer, needPass());
  return { where: new URL(s.siteUrl).host };
}

async function testConnection() {
  const { offer, where } = await readOffer();
  if (loadSettings().mode !== 'folder') await api('POST', {}, needPass());
  return { offer, where };
}

// ---------- validation (same rules as the website's /api/offer) ----------
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
ipcMain.handle('settings:test', wrap(testConnection));
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
