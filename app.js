// ---------- Data ----------
// All data lives in the browser's localStorage on THIS device.
// Shape: { lists: [ { id, name, color, updated, items: [ { id, text, done } ] } ] }
const KEY = "checklists-v1";
// Soft pastel palette: blue, mint, peach, rose, lavender, aqua, pink, slate
const COLORS = ["#9dbdff", "#94dcbc", "#ffd09b", "#ffa8b8", "#c8b0ff", "#8fdbe6", "#f6b0dc", "#bcc4d4"];
// Colors from the first version of the app; mapped to the pastel one in the same position.
const OLD_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2", "#db2777", "#475569"];
const DEFAULT_ACCENT = COLORS[0];

function load() {
  let data = { lists: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { console.warn("Could not read saved data", e); }
  return migrate(data);
}
// Make older saved data (no colors yet) work with the newer app.
function normalizeList(l, i) {
  l.items = Array.isArray(l.items) ? l.items : [];
  const old = OLD_COLORS.indexOf(l.color);
  if (old >= 0) l.color = COLORS[old];
  if (!l.color) l.color = COLORS[i % COLORS.length];
  if (!l.updated) l.updated = Date.now() - i;
  return l;
}
function migrate(data) {
  if (!data || !Array.isArray(data.lists)) return { lists: [] };
  data.lists.forEach(normalizeList);
  return data;
}
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
// saveLocal: keep a copy on this device (works offline).  save: also send changes to the cloud.
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert("Could not save data (storage full or blocked)."); }
}
function save() {
  saveLocal();
  schedulePush();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let state = load();
let currentListId = null;   // null = home screen
let query = "";             // home search text
let filter = "all";         // all | active | done

// ---------- Elements ----------
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const menuBtn = document.getElementById("menuBtn");
const menu = document.getElementById("menu");
const fab = document.getElementById("fab");
const dlg = document.getElementById("dlg");

// ---------- Cloud sync ----------
// Every list is stored as its own document in the cloud: users/<you>/lists/<listId>.
// The newest edit of a list wins. `synced` remembers, per list, which version the cloud has,
// so we only upload what changed and can tell when a list was deleted on another device.
const syncEl = document.getElementById("sync");
const SYNCED_KEY = "checklists-synced-v2";
let cloud = null;            // the cloud.js module, once loaded
let cloudError = false;      // true if it could not be loaded (e.g. no internet on first visit)
let user = null;             // signed-in user, or null
let authReady = false;       // true once we know whether someone is signed in
let unsubscribe = null;
let gotSnapshot = false;     // don't upload before we've seen what the cloud already has
let pushTimer = null;
let pending = 0;             // uploads in flight
const synced = loadJSON(SYNCED_KEY, {});   // { listId: updatedStampLastSynced }

function saveSynced() {
  try { localStorage.setItem(SYNCED_KEY, JSON.stringify(synced)); } catch (e) { /* ignore */ }
}
function updateSync() {
  if (!syncEl) return;
  const s = !user ? "" : !navigator.onLine ? "off" : pending > 0 ? "busy" : "ok";
  syncEl.className = "sync " + s;
  syncEl.title = { ok: "Synced", busy: "Syncing…", off: "Offline: changes will sync later", "": "" }[s];
}
function track(promise, id, kind) {
  pending++; updateSync();
  promise.catch(e => {
    console.warn("Sync failed", e);
    if (kind === "push") delete synced[id];      // try again next time
    else synced[id] = -1;                         // retry the removal next time
    saveSynced();
  }).finally(() => { pending--; updateSync(); });
}
function schedulePush() {
  if (!user || !cloud || !gotSnapshot) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushDirty, 400);
}
function pushDirty() {
  if (!user || !cloud || !gotSnapshot) return;
  const ids = new Set(state.lists.map(l => l.id));
  for (const l of state.lists) {
    if (synced[l.id] === l.updated) continue;     // cloud already has this version
    synced[l.id] = l.updated;
    track(cloud.pushList(user.uid, l), l.id, "push");
  }
  for (const id of Object.keys(synced)) {
    if (ids.has(id)) continue;                    // deleted here: delete in the cloud too
    delete synced[id];
    track(cloud.removeList(user.uid, id), id, "remove");
  }
  saveSynced();
}
// Called whenever the cloud tells us something changed.
function applyRemote(snap) {
  gotSnapshot = true;
  let changed = false;
  const remoteIds = new Set();
  snap.forEach(d => remoteIds.add(d.id));

  for (const ch of snap.docChanges()) {
    const id = ch.doc.id;
    if (ch.doc.metadata.hasPendingWrites) continue;   // that's just our own edit echoing back
    if (ch.type === "removed") {
      if (state.lists.some(l => l.id === id)) { state.lists = state.lists.filter(l => l.id !== id); changed = true; }
      delete synced[id];
      continue;
    }
    const remote = normalizeList({ ...ch.doc.data(), id }, state.lists.length);
    const i = state.lists.findIndex(l => l.id === id);
    if (i < 0) { state.lists.push(remote); synced[id] = remote.updated; changed = true; }
    else if (remote.updated > state.lists[i].updated) { state.lists[i] = remote; synced[id] = remote.updated; changed = true; }
    else if (remote.updated === state.lists[i].updated) synced[id] = remote.updated;
    // else: our copy is newer (edited offline); pushDirty below uploads it
  }

  // A list we knew was in the cloud is gone from the server: it was deleted on another device.
  if (!snap.metadata.fromCache) {
    for (const l of [...state.lists]) {
      if (synced[l.id] === undefined || remoteIds.has(l.id)) continue;
      if (synced[l.id] === l.updated) { state.lists = state.lists.filter(x => x.id !== l.id); delete synced[l.id]; changed = true; }
      else delete synced[l.id];                       // edited here since: keep it and upload again
    }
  }
  saveSynced();
  if (changed) { saveLocal(); render(); }
  pushDirty();
}
function startSync() {
  stopSync();
  unsubscribe = cloud.subscribe(user.uid, applyRemote, err => console.warn("Sync error", err));
}
function stopSync() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null; gotSnapshot = false;
  clearTimeout(pushTimer);
}
async function signOutFlow() {
  const unsent = pending > 0 || !navigator.onLine;
  const msg = unsent
    ? "Some changes may not have synced yet and would be lost. Sign out anyway?"
    : "Sign out? Your lists will be removed from this device. They stay safe in your account.";
  if (!confirm(msg)) return;
  stopSync();
  try { localStorage.removeItem(KEY); localStorage.removeItem(SYNCED_KEY); } catch (e) { /* ignore */ }
  try { await cloud.signOutAndClear(); } catch (e) { console.warn(e); }
  location.reload();
}
window.addEventListener("online", updateSync);
window.addEventListener("offline", updateSync);

// ---------- Helpers ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}
const currentList = () => state.lists.find(l => l.id === currentListId);
const touch = list => { list.updated = Date.now(); };
const stats = list => {
  const total = list.items.length;
  const done = list.items.filter(i => i.done).length;
  return { total, done, pct: total ? Math.round(done / total * 100) : 0, complete: total > 0 && done === total };
};
function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}

// Navigation helper: switch screen with a gentle fade/slide-in
let animateNext = false;
let firstLoad = true;
function go(listId) {
  currentListId = listId;
  animateNext = true;
  render();
  window.scrollTo(0, 0);
}

// ---------- Screens ----------
function render() {
  menu.hidden = true;
  view.replaceChildren();
  view.classList.remove("enter");
  if (animateNext) { void view.offsetWidth; view.classList.add("enter"); animateNext = false; }

  // Nothing is shown until we know who is signed in.
  if (cloudError) return renderMessage("Can't reach the sign-in service. Check your internet connection.", boot);
  if (!authReady) return renderMessage("Loading…");
  if (!user) return renderLogin();
  menuBtn.hidden = false;

  if (currentListId !== null && !currentList()) currentListId = null;
  if (currentListId === null) renderHome();
  else renderList(currentList());
}

// ----- Loading / error / sign-in screens -----
function chromeOff() {
  setAccent(DEFAULT_ACCENT);
  titleEl.textContent = "Checklists";
  backBtn.hidden = true; fab.hidden = true; menuBtn.hidden = true;
  document.querySelector(".add-bar")?.remove();
  updateSync();
}
function renderMessage(text, retry) {
  chromeOff();
  const box = el("div", { className: "empty", textContent: text });
  if (retry) box.append(el("br"), el("br"), el("button", { className: "primary", textContent: "Try again", onclick: retry }));
  view.append(box);
}
function renderLogin() {
  chromeOff();
  const email = el("input", { type: "email", name: "email", autocomplete: "username", placeholder: "Email", required: true, autocapitalize: "none", spellcheck: false });
  const pw = el("input", { type: "password", name: "password", autocomplete: "current-password", placeholder: "Password", required: true });
  const err = el("div", { className: "login-error", role: "alert" });
  const btn = el("button", { className: "primary", type: "submit", textContent: "Sign in" });
  const form = el("form", { className: "login" },
    el("div", { className: "login-icon", textContent: "✓" }),
    el("h2", { textContent: "Welcome back" }),
    el("p", { className: "muted", textContent: "Sign in to see your checklists." }),
    email, pw, err, btn);
  form.onsubmit = async e => {
    e.preventDefault();
    err.textContent = ""; btn.disabled = true; btn.textContent = "Signing in…";
    try { await cloud.signIn(email.value.trim(), pw.value); }   // success: the auth listener redraws
    catch (ex) {
      err.textContent = ex.message; btn.disabled = false; btn.textContent = "Sign in";
      pw.value = ""; pw.focus();
    }
  };
  view.append(form);
}

// ----- Home -----
function renderHome() {
  setAccent(DEFAULT_ACCENT);
  titleEl.textContent = "My Checklists";
  backBtn.hidden = true;
  fab.hidden = false;
  document.querySelector(".add-bar")?.remove();
  const entrance = view.classList.contains("enter") || firstLoad;  // blocks pop in only when arriving
  firstLoad = false;

  if (state.lists.length === 0) {
    view.append(el("div", { className: "empty" },
      el("big", { textContent: "✅" }),
      "No checklists yet.", el("br"), "Tap the + button to create your first one."));
    return;
  }

  const search = el("input", { className: "search", type: "search", placeholder: "Search checklists or items…", value: query });
  const chips = el("div", { className: "chips" });
  const grid = el("div", { className: "grid" + (entrance ? " stagger" : "") });

  const drawChips = () => {
    chips.replaceChildren();
    for (const [key, label] of [["all", "All"], ["active", "In progress"], ["done", "Completed"]]) {
      chips.append(el("button", {
        className: "chip" + (filter === key ? " on" : ""), textContent: label,
        onclick: () => { filter = key; grid.classList.remove("stagger"); drawChips(); drawGrid(); }
      }));
    }
  };

  const drawGrid = () => {
    grid.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = [];
    for (const list of state.lists) {
      const s = stats(list);
      if (filter === "active" && s.complete) continue;
      if (filter === "done" && !s.complete) continue;
      let hit = null;
      if (q) {
        const nameHit = list.name.toLowerCase().includes(q);
        const itemHit = list.items.find(i => i.text.toLowerCase().includes(q));
        if (!nameHit && !itemHit) continue;
        if (!nameHit && itemHit) hit = itemHit.text;
      }
      matches.push({ list, s, hit });
    }
    matches.sort((a, b) => b.list.updated - a.list.updated);

    if (matches.length === 0) {
      grid.style.display = "block";
      grid.append(el("div", { className: "empty", textContent: "No checklists match." }));
      return;
    }
    grid.style.display = "";
    matches.forEach(({ list, s, hit }, i) => {
      const block = makeBlock(list, s, hit);
      block.style.setProperty("--i", i);
      grid.append(block);
    });
  };

  search.oninput = () => { query = search.value; grid.classList.remove("stagger"); drawGrid(); };
  view.append(search, chips, grid);
  drawChips();
  drawGrid();
}

function makeBlock(list, s, hit) {
  const block = el("div", { className: "block" });
  block.style.setProperty("--c", list.color);
  block.append(el("h2", { textContent: list.name }));

  if (s.total === 0) {
    block.append(el("div", { className: "meta", textContent: "Empty" }));
  } else {
    block.append(el("div", { className: "meta", textContent: `${s.done} of ${s.total} done` }));
    block.append(el("div", { className: "bar" }, el("div", { style: `width:${s.pct}%` })));
    if (s.complete) {
      block.append(el("div", { className: "complete", textContent: "✓ All done" }));
    } else {
      const open = list.items.filter(i => !i.done).slice(0, 3);
      const ul = el("ul");
      open.forEach(i => ul.append(el("li", { textContent: i.text })));
      block.append(ul);
    }
  }
  if (hit) block.append(el("div", { className: "hit", textContent: `Item: ${hit}` }));
  block.onclick = () => go(list.id);
  return block;
}

// ----- Single list -----
function renderList(list) {
  setAccent(list.color);
  titleEl.textContent = list.name;
  backBtn.hidden = false;
  fab.hidden = true;

  const s = stats(list);
  summaryRefs = {
    count: el("span", { textContent: `${s.done} of ${s.total} done` }),
    pct: el("span", { textContent: `${s.pct}%` }),
    fill: el("div", { style: `width:${s.pct}%` }),
  };
  view.append(el("div", { className: "summary" },
    el("div", { className: "top" }, summaryRefs.count, summaryRefs.pct),
    el("div", { className: "bar" }, summaryRefs.fill)));

  view.append(el("div", { className: "toolbar" },
    el("button", { className: "secondary", textContent: "↺ Uncheck all", onclick: () => {
      list.items.forEach(i => i.done = false); touch(list); save(); render();
    } }),
    el("button", { className: "secondary", textContent: "🗑 Remove checked", onclick: () => {
      list.items = list.items.filter(i => !i.done); touch(list); save(); render();
    } })));

  if (list.items.length === 0) {
    view.append(el("div", { className: "empty", textContent: "Empty list. Add your first item below." }));
  } else {
    const card = el("div", { className: "card" });
    for (const item of list.items) card.append(makeItemRow(list, item));
    view.append(card);
  }

  // Add-item bar, fixed at the bottom (easy to reach on a phone).
  // It stays in place between re-renders so the phone keyboard doesn't flicker.
  const existing = document.querySelector(".add-bar");
  if (existing && existing.dataset.list === list.id) return;
  existing?.remove();
  const input = el("input", { type: "text", placeholder: "Add an item…", maxLength: 200, enterKeyHint: "done" });
  const send = el("button", { type: "button", textContent: "↵", ariaLabel: "Add item" });
  const listId = list.id;
  const add = () => {
    const text = input.value.trim();
    // Look the list up again: it may have been replaced by a newer copy from the cloud.
    const target = state.lists.find(l => l.id === listId);
    if (!text || !target) return;
    target.items.push({ id: uid(), text, done: false });
    touch(target); save();
    input.value = ""; send.classList.remove("show");
    render();
    input.focus(); // keep typing
  };
  input.oninput = () => send.classList.toggle("show", input.value.trim() !== "");
  input.onkeydown = e => { if (e.key === "Enter") add(); };
  send.onclick = add;
  const bar = el("div", { className: "add-bar" }, el("div", { className: "inner" }, input, send));
  bar.dataset.list = list.id;
  document.body.append(bar);
}

// Update the progress summary without redrawing the whole list (keeps animations smooth)
let summaryRefs = null;
function refreshSummary(list) {
  if (!summaryRefs) return;
  const s = stats(list);
  summaryRefs.count.textContent = `${s.done} of ${s.total} done`;
  summaryRefs.pct.textContent = `${s.pct}%`;
  summaryRefs.fill.style.width = s.pct + "%";
}

function makeItemRow(list, item) {
  const cb = el("input", { type: "checkbox", checked: item.done });
  let row;
  cb.onchange = () => {
    item.done = cb.checked; touch(list); save();
    row.classList.toggle("done", item.done);   // animate in place, no full redraw
    refreshSummary(list);
  };

  const text = el("span", { className: "text", textContent: item.text, title: "Tap to edit" });
  text.onclick = () => {
    const edit = el("input", { className: "edit-input", value: item.text, maxLength: 200 });
    let finished = false;
    const commit = () => {
      if (finished) return; finished = true;
      const v = edit.value.trim();
      if (v) item.text = v;
      touch(list); save(); render();
    };
    edit.onblur = commit;
    edit.onkeydown = e => {
      if (e.key === "Enter") edit.blur();
      if (e.key === "Escape") { finished = true; render(); }
    };
    text.replaceWith(edit);
    edit.focus(); edit.select();
  };

  const del = el("button", { className: "del", textContent: "✕", title: "Delete item" });
  del.onclick = () => { list.items = list.items.filter(i => i.id !== item.id); touch(list); save(); render(); };

  row = el("div", { className: "item" + (item.done ? " done" : "") }, cb, text, del);
  return row;
}

// ---------- New / edit checklist dialog ----------
function openListDialog(list) {
  const editing = !!list;
  let color = list ? list.color : COLORS[state.lists.length % COLORS.length];

  const name = el("input", { type: "text", placeholder: "Checklist name", maxLength: 80, value: list ? list.name : "" });
  const swatches = el("div", { className: "swatches" });
  const drawSwatches = () => {
    swatches.replaceChildren();
    for (const c of COLORS) {
      const sw = el("button", { type: "button", className: "swatch" + (c === color ? " on" : ""), ariaLabel: "Color " + c });
      sw.style.setProperty("--c", c);
      sw.onclick = () => { color = c; drawSwatches(); };
      swatches.append(sw);
    }
  };
  drawSwatches();

  const submit = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    if (editing) {
      list.name = n; list.color = color; touch(list); save(); dlg.close(); render();
    } else {
      const created = { id: uid(), name: n, color, updated: Date.now(), items: [] };
      state.lists.push(created); save(); dlg.close();
      go(created.id);
    }
  };
  name.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  dlg.replaceChildren(
    el("h3", { textContent: editing ? "Edit checklist" : "New checklist" }),
    name, swatches,
    el("div", { className: "dlg-actions" },
      el("button", { className: "secondary", type: "button", textContent: "Cancel", onclick: () => dlg.close() }),
      el("button", { className: "primary", type: "button", textContent: editing ? "Save" : "Create", onclick: submit })));
  dlg.showModal();
  name.focus();
}

// ---------- Menu ----------
function buildMenu() {
  menu.replaceChildren();
  const btn = (label, fn, cls = "") => menu.append(el("button", { textContent: label, className: cls, onclick: () => { menu.hidden = true; fn(); } }));

  if (currentListId !== null && currentList()) {
    btn("Rename / change color", () => openListDialog(currentList()));
    btn("Duplicate list", () => {
      const src = currentList();
      const copy = { id: uid(), name: src.name + " (copy)", color: src.color, updated: Date.now(),
        items: src.items.map(i => ({ id: uid(), text: i.text, done: false })) };
      state.lists.push(copy); save(); go(copy.id);
    });
    btn("Delete list", () => {
      if (confirm(`Delete "${currentList().name}"?`)) {
        state.lists = state.lists.filter(l => l.id !== currentListId);
        save(); go(null);
      }
    }, "danger");
  }
  btn("Export backup (file)", exportData);
  btn("Import checklists (file)", importData);
  btn("Sign out", signOutFlow);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "checklists-backup.json" });
  document.body.append(a); a.click(); a.remove();
}
function importData() {
  const inp = el("input", { type: "file", accept: "application/json" });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!Array.isArray(data.lists)) throw new Error("bad format");
      const incoming = migrate(data).lists;
      if (!confirm(`Add ${incoming.length} checklist(s) from this file? Your current checklists are kept.`)) return;
      // Add to what's already here. A list with the same id (same backup imported twice) is updated, not duplicated.
      for (const l of incoming) {
        touch(l);                     // mark as a new edit so it uploads
        const i = state.lists.findIndex(x => x.id === l.id);
        if (i >= 0) state.lists[i] = l; else state.lists.push(l);
      }
      save(); currentListId = null; render();
    } catch (e) { alert("That file doesn't look like a valid backup."); }
  };
  inp.click();
}

// ---------- Events ----------
backBtn.onclick = () => go(null);
fab.onclick = () => openListDialog(null);
menuBtn.onclick = e => { e.stopPropagation(); buildMenu(); menu.hidden = !menu.hidden; };
document.addEventListener("click", () => { menu.hidden = true; });
window.addEventListener("popstate", () => { if (currentListId !== null) { currentListId = null; render(); } });

// ---------- Start ----------
// Load the cloud module, then wait to hear whether someone is signed in.
// (Loaded on demand so a failed network fetch shows a message instead of a blank page.)
async function boot() {
  cloudError = false;
  render();
  try { cloud = await import("./cloud.js"); }
  catch (e) { console.warn("Cloud unavailable", e); cloudError = true; render(); return; }
  cloud.onUser(u => {
    user = u; authReady = true;
    if (u) startSync(); else stopSync();
    render(); updateSync();
  });
}
boot();

// Offline support + installability
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW failed", err));
}
