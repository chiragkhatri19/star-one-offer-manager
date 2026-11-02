// Offer Manager UI. Talks to the main process through window.om (see preload.js).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- dates (always Jodhpur time) ----------
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const endOfMonth = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
const prettyDate = (ymd, withYear = false) =>
  ymd ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`)) : '';

// ---------- templates ----------
const nextJan15 = () => { const t = todayIST(); const y = Number(t.slice(0, 4)) + (t.slice(5) > '01-15' ? 1 : 0); return `${y}-01-15`; };
const TEMPLATES = {
  diwali: () => ({ name: 'Diwali Dhamaka', headline: '+1 month', highlight: 'extra', detail: 'on 3, 6 and 12-month plans', chip: 'Diwali · +1 month extra', until: addDays(todayIST(), 7) }),
  newyear: () => ({ name: 'New Year Kickstart', headline: 'No joining', highlight: 'fee', detail: 'on every plan, this January only', chip: 'New Year · no joining fee', until: nextJan15() }),
  summer: () => ({ name: 'Summer Shred', headline: 'Flat 15%', highlight: 'off', detail: 'on 6 and 12-month plans', chip: 'Summer Shred · flat 15% off', until: addDays(todayIST(), 15) }),
  monthend: () => ({ name: 'Month-end Offer', headline: '+15 days', highlight: 'free', detail: 'when you join before the month ends', chip: 'Month-end · +15 days free', until: endOfMonth(todayIST()) }),
  blank: () => ({ name: '', headline: '', highlight: '', detail: '', chip: '', until: addDays(todayIST(), 7) }),
};
const autoChip = (o) => [o.name.split(' ')[0], [o.headline, o.highlight].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
const offerName = (o) => (/offer$/i.test(o.name.trim()) ? o.name.trim() : `${o.name.trim() || 'current'} offer`);
const autoWa = (o) => `Hi! I'd like the ${offerName(o)}${o.headline ? ` (${[o.headline, o.highlight].filter(Boolean).join(' ')})` : ''}. Which plan is best for me?`;
const blankOffer = () => ({ active: true, button: 'Claim on WhatsApp', prices: [], whatsapp: '', ...TEMPLATES.diwali() });

// ---------- state ----------
let settings = {};
let live = null;       // what the website has now (null = unknown / not connected)
let draft = blankOffer();
let waAuto = true;     // keep the WhatsApp message in sync until the user edits it
let touched = false;   // the user started editing before the live offer finished loading
document.addEventListener('input', () => (touched = true), true);
document.addEventListener('click', (e) => { if (e.target.closest('[data-template], [data-days], [data-add-price], [data-auto-chip]')) touched = true; }, true);

const FIELDS = ['name', 'headline', 'highlight', 'detail', 'chip', 'until', 'whatsapp', 'button'];
const comparable = (o) => o && JSON.stringify({
  active: !!o.active, ...Object.fromEntries(FIELDS.map((k) => [k, (o[k] || '').trim()])),
  prices: (o.prices || []).filter((p) => p.plan && p.price).map((p) => [p.plan.trim(), p.price.trim()]),
});
const isDirty = () => !live || comparable(live) !== comparable(draft);

// ---------- navigation ----------
function go(view) {
  $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === view));
  $$('[data-view]').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  if (view === 'history') renderHistory();
  if (view === 'settings') fillSettings();
}
window.__go = go;
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));

function toast(msg) {
  const t = $('[data-toast]');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- form <-> draft ----------
function fillForm() {
  FIELDS.forEach((k) => { $(`[data-f="${k}"]`).value = draft[k] || ''; });
  $('[data-f="active"]').checked = !!draft.active;
  renderPrices();
  refresh();
}
FIELDS.forEach((k) => $(`[data-f="${k}"]`).addEventListener('input', (e) => {
  draft[k] = e.target.value;
  if (k === 'whatsapp') waAuto = false;
  if (waAuto && ['name', 'headline', 'highlight'].includes(k)) { draft.whatsapp = autoWa(draft); $('[data-f="whatsapp"]').value = draft.whatsapp; }
  refresh();
}));
$('[data-f="active"]').addEventListener('change', (e) => { draft.active = e.target.checked; refresh(); });
$('[data-auto-chip]').addEventListener('click', () => { draft.chip = autoChip(draft); $('[data-f="chip"]').value = draft.chip; refresh(); });
$$('[data-days]').forEach((b) => b.addEventListener('click', () => {
  const d = b.dataset.days;
  draft.until = d === 'eom' ? endOfMonth(todayIST()) : addDays(todayIST(), Number(d));
  $('[data-f="until"]').value = draft.until;
  refresh();
}));
$$('[data-template]').forEach((b) => b.addEventListener('click', () => {
  draft = { ...draft, ...TEMPLATES[b.dataset.template](), active: true };
  if (b.dataset.template === 'blank') draft.prices = [];
  draft.whatsapp = autoWa(draft);
  waAuto = true;
  fillForm();
  toast(b.dataset.template === 'blank' ? 'Started a blank offer' : `Loaded the ${b.textContent} template`);
}));

function renderPrices() {
  const box = $('[data-prices]');
  box.replaceChildren(...(draft.prices || []).map((p, i) => {
    const row = document.createElement('div');
    row.className = 'price-row';
    const plan = Object.assign(document.createElement('input'), { value: p.plan || '', placeholder: '3 Months', maxLength: 20 });
    const price = Object.assign(document.createElement('input'), { value: p.price || '', placeholder: '₹5,999', maxLength: 16 });
    const x = Object.assign(document.createElement('button'), { className: 'x', type: 'button', textContent: '×', title: 'Remove' });
    plan.addEventListener('input', () => { draft.prices[i].plan = plan.value; refresh(); });
    price.addEventListener('input', () => { draft.prices[i].price = price.value; refresh(); });
    price.addEventListener('blur', () => {
      const digits = price.value.replace(/[^\d]/g, '');
      if (digits && !/[a-z]/i.test(price.value)) { price.value = `₹${Number(digits).toLocaleString('en-IN')}`; draft.prices[i].price = price.value; refresh(); }
    });
    x.addEventListener('click', () => { draft.prices.splice(i, 1); renderPrices(); refresh(); });
    row.append(plan, price, x);
    return row;
  }));
  $('[data-add-price]').hidden = (draft.prices || []).length >= 4;
}
$('[data-add-price]').addEventListener('click', () => {
  const used = new Set((draft.prices || []).map((p) => p.plan));
  const plan = ['3 Months', '6 Months', '12 Months', '1 Month'].find((p) => !used.has(p)) || '';
  draft.prices = [...(draft.prices || []), { plan, price: '' }];
  renderPrices();
  $$('[data-prices] .price-row:last-child input')[1]?.focus();
  refresh();
});

// ---------- validation ----------
function problems() {
  if (!draft.active) return [];
  const out = [];
  if (!draft.name.trim()) out.push('name');
  if (!draft.headline.trim()) out.push('headline');
  if (!draft.until) out.push('until');
  else if (draft.until < todayIST()) out.push('until');
  return out;
}

// ---------- render ----------
function refresh() {
  const bad = problems();
  $$('[data-f]').forEach((el) => el.closest('.field')?.classList.toggle('is-bad', bad.includes(el.dataset.f)));
  $$('[data-count]').forEach((em) => {
    const k = em.dataset.count;
    const max = Number($(`[data-f="${k}"]`).maxLength);
    const n = (draft[k] || '').length;
    em.textContent = `${n}/${max}`;
    em.classList.toggle('is-near', n > max * 0.85);
  });

  // run length
  const runs = $('[data-runs]');
  const t = todayIST();
  runs.className = 'runbar__note mono';
  if (!draft.active) runs.textContent = 'Hidden on the website';
  else if (!draft.until) runs.textContent = 'Pick the last day';
  else if (draft.until < t) { runs.textContent = 'This date has already passed'; runs.classList.add('is-bad'); }
  else {
    const left = daysBetween(t, draft.until) + 1;
    runs.textContent = left === 1 ? 'Shows today only' : `Shows for ${left} days · till ${prettyDate(draft.until)}`;
    runs.classList.add('is-ok');
  }
  $$('[data-days]').forEach((b) => {
    const d = b.dataset.days;
    b.classList.toggle('is-on', draft.until === (d === 'eom' ? endOfMonth(t) : addDays(t, Number(d))));
  });

  // preview
  $('[data-pv-chip]').textContent = draft.chip || autoChip(draft) || 'Your offer';
  $('[data-pv-tag]').textContent = `${draft.name || 'Offer name'} · till ${prettyDate(draft.until) || '—'}`;
  $('[data-pv-headline]').textContent = draft.headline || 'Big line';
  $('[data-pv-highlight]').textContent = draft.highlight || '';
  $('[data-pv-detail]').textContent = draft.detail || '';
  $('[data-pv-button]').textContent = draft.button || 'Claim on WhatsApp';
  $('[data-pv-prices]').replaceChildren(...(draft.prices || []).filter((p) => p.plan && p.price).map((p) => {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = p.plan;
    s.append(b, ` ${p.price}`);
    return s;
  }));
  const showsOnSite = draft.active && draft.until >= t;
  $('[data-screen]').classList.toggle('is-off', !showsOnSite);
  $('[data-pv-off]').hidden = showsOnSite;

  // action bar
  const state = $('[data-state]');
  const dirty = isDirty();
  state.className = 'actionbar__state';
  if (bad.length) { state.classList.add('is-bad'); state.lastElementChild.textContent = 'Fill in the highlighted boxes to publish'; }
  else if (!live) { state.classList.add('is-dirty'); state.lastElementChild.textContent = 'Not connected to the website yet'; }
  else if (dirty) { state.classList.add('is-dirty'); state.lastElementChild.textContent = 'You have changes that are not on the website yet'; }
  else { state.classList.add('is-live'); state.lastElementChild.textContent = 'The website is showing exactly this'; }
  $('[data-publish]').disabled = bad.length > 0 || (live && !dirty);
  $('[data-revert]').disabled = !live || !dirty;
}

function renderLive(err) {
  const pill = $('[data-live]');
  const conn = $('[data-conn]');
  pill.className = 'livepill mono';
  if (err) {
    pill.classList.add('is-err');
    pill.lastElementChild.textContent = 'Not connected';
    conn.textContent = 'Not connected';
    conn.classList.remove('is-ok');
    return;
  }
  conn.textContent = settings.mode === 'folder' ? 'Test folder' : 'Connected';
  conn.classList.add('is-ok');
  const t = todayIST();
  if (live?.active && live.until >= t) {
    const left = daysBetween(t, live.until) + 1;
    pill.classList.add('is-live');
    pill.lastElementChild.textContent = `Live · ${live.name} · ${left === 1 ? 'last day' : `${left} days left`}`;
  } else {
    pill.lastElementChild.textContent = 'No offer on the website';
  }
}

$$('[data-pv]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-pv]').forEach((x) => x.classList.toggle('is-on', x === b));
  $('[data-screen]').classList.toggle('show-card', b.dataset.pv === 'card');
}));

// ---------- load / publish ----------
async function loadLive() {
  const res = await window.om.loadOffer();
  if (!res.ok) { live = null; renderLive(res.error); return res; }
  live = { prices: [], ...res.offer };
  renderLive();
  return res;
}

$('[data-revert]').addEventListener('click', () => {
  if (!live) return;
  draft = structuredClone(live);
  waAuto = draft.whatsapp === autoWa(draft);
  fillForm();
  toast('Back to what the website shows now');
});

const modal = $('[data-modal]');
const step = (name) => $$('[data-step]', modal).forEach((s) => (s.hidden = s.dataset.step !== name));
const closeModal = () => (modal.hidden = true);
$$('[data-close]', modal).forEach((b) => b.addEventListener('click', closeModal));
modal.addEventListener('click', (e) => { if (e.target === modal && $('[data-step="busy"]').hidden) closeModal(); });

$('[data-publish]').addEventListener('click', () => {
  const dl = $('[data-summary]');
  const rows = draft.active
    ? [['Offer', draft.name], ['Shows', `${draft.headline} ${draft.highlight}`.trim()], ['Ends', prettyDate(draft.until, true)],
       ['Prices', (draft.prices || []).filter((p) => p.plan && p.price).map((p) => `${p.plan} ${p.price}`).join(', ') || 'Not shown (ask on WhatsApp)']]
    : [['Offer', 'Turned off'], ['Website', 'No banner and no offer card']];
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
  step('confirm');
  modal.hidden = false;
});

$('[data-confirm]').addEventListener('click', async () => {
  step('busy');
  const res = await window.om.publish(draft);
  if (!res.ok) { $('[data-err-msg]').textContent = res.error; step('error'); return; }
  live = { prices: [], ...res.offer };
  draft = structuredClone(live);
  renderLive();
  fillForm();
  $('[data-done-msg]').textContent = settings.mode === 'folder'
    ? 'Saved into the website folder on this computer.'
    : 'The website shows the new offer within about a minute. You can close this app.';
  step('done');
});
$('[data-open-site]').addEventListener('click', () => settings.siteUrl && window.om.openUrl(settings.siteUrl));
$('[data-goto-settings]').addEventListener('click', () => { closeModal(); go('settings'); });

// ---------- history ----------
async function renderHistory() {
  const res = await window.om.history();
  const box = $('[data-history]');
  const list = res.ok ? res.history : [];
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Nothing published from this computer yet. Offers you publish will show up here.';
    box.replaceChildren(e);
    return;
  }
  box.replaceChildren(...list.map(({ at, offer }) => {
    const c = document.createElement('article');
    c.className = 'hcard';
    const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(at));
    const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
    const big = el('div', 'hcard__big', offer.active ? `${offer.headline} ` : 'Offer off');
    if (offer.active && offer.highlight) big.append(el('span', 'g', offer.highlight));
    const use = el('button', 'minibtn', 'Use again');
    use.type = 'button';
    use.addEventListener('click', () => {
      draft = { ...structuredClone(offer), active: true };
      if (!draft.until || draft.until < todayIST()) draft.until = addDays(todayIST(), 7);
      waAuto = draft.whatsapp === autoWa(draft);
      fillForm();
      go('offer');
      toast(`Loaded “${offer.name || 'offer'}”. Check the date, then publish.`);
    });
    c.append(el('span', 'hcard__when mono', when), el('span', 'hcard__name', offer.active ? offer.name : 'Turned off'), big,
      el('span', 'hcard__meta', offer.active ? `${offer.detail || ''}${offer.detail ? ' · ' : ''}till ${prettyDate(offer.until, true)}` : 'No offer on the website'), use);
    return c;
  }));
}

// ---------- settings ----------
function fillSettings() {
  $('[data-s="siteUrl"]').value = settings.siteUrl || '';
  $('[data-s="pass"]').value = '';
  $('[data-pass-state]').textContent = settings.hasPass ? 'saved securely' : 'not saved yet';
}
async function saveSettings() {
  const next = { siteUrl: $('[data-s="siteUrl"]').value.trim() };
  const pass = $('[data-s="pass"]').value.trim();
  if (pass) next.pass = pass;
  const res = await window.om.saveSettings(next);
  if (res.ok) settings = res.settings;
  fillSettings();
  return res;
}
async function testAndLoad() {
  const r = await window.om.testConnection();
  if (r.ok) {
    live = { prices: [], ...r.offer };
    renderLive();
    draft = structuredClone(live);
    waAuto = !draft.whatsapp || draft.whatsapp === autoWa(draft);
    fillForm();
  }
  return r;
}
$('[data-save-settings]').addEventListener('click', async () => {
  await saveSettings();
  const r = await testAndLoad();
  toast(r.ok ? 'Saved · connected to the website' : `Saved · ${r.error}`);
});
$('[data-test-btn]').addEventListener('click', async () => {
  const t = $('[data-test]');
  t.className = 'test mono';
  t.textContent = 'Testing…';
  await saveSettings();
  const r = await testAndLoad();
  if (r.ok) { t.classList.add('is-ok'); t.textContent = `Connected · password OK · current offer: ${r.offer.active ? r.offer.name : 'off'}`; }
  else { t.classList.add('is-bad'); t.textContent = r.error; }
});

// ---------- start ----------
(async () => {
  const s = await window.om.getSettings();
  settings = s.ok ? s.settings : {};
  const r = await loadLive();
  if (r.ok && !touched) draft = structuredClone(live);
  waAuto = !draft.whatsapp || draft.whatsapp === autoWa(draft);
  if (!draft.whatsapp) draft.whatsapp = autoWa(draft);
  if (touched) refresh(); else fillForm();
  if (settings.mode !== 'folder' && !settings.hasPass) { go('settings'); toast('Type the Offer Manager password once to start'); }
})();
