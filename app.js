// ---------- Data ----------
// All data lives in the browser's localStorage on THIS device.
// Shape: { lists: [ { id, name, color, updated, items: [ { id, text, done } ] } ] }
const KEY = "checklists-v1";
const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2", "#db2777", "#475569"];
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
function migrate(data) {
  if (!data || !Array.isArray(data.lists)) return { lists: [] };
  data.lists.forEach((l, i) => {
    l.items = Array.isArray(l.items) ? l.items : [];
    if (!l.color) l.color = COLORS[i % COLORS.length];
    if (!l.updated) l.updated = Date.now() - i;
  });
  return data;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert("Could not save data (storage full or blocked)."); }
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = color;
}

// ---------- Screens ----------
function render() {
  menu.hidden = true;
  view.replaceChildren();
  if (currentListId !== null && !currentList()) currentListId = null;
  if (currentListId === null) renderHome();
  else renderList(currentList());
}

// ----- Home -----
function renderHome() {
  setAccent(DEFAULT_ACCENT);
  titleEl.textContent = "My Checklists";
  backBtn.hidden = true;
  fab.hidden = false;
  document.querySelector(".add-bar")?.remove();

  if (state.lists.length === 0) {
    view.append(el("div", { className: "empty" },
      el("big", { textContent: "✅" }),
      "No checklists yet.", el("br"), "Tap the + button to create your first one."));
    return;
  }

  const search = el("input", { className: "search", type: "search", placeholder: "Search checklists or items…", value: query });
  const chips = el("div", { className: "chips" });
  const grid = el("div", { className: "grid" });

  const drawChips = () => {
    chips.replaceChildren();
    for (const [key, label] of [["all", "All"], ["active", "In progress"], ["done", "Completed"]]) {
      chips.append(el("button", {
        className: "chip" + (filter === key ? " on" : ""), textContent: label,
        onclick: () => { filter = key; drawChips(); drawGrid(); }
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
    for (const { list, s, hit } of matches) grid.append(makeBlock(list, s, hit));
  };

  search.oninput = () => { query = search.value; drawGrid(); };
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
  block.onclick = () => { currentListId = list.id; render(); window.scrollTo(0, 0); };
  return block;
}

// ----- Single list -----
function renderList(list) {
  setAccent(list.color);
  titleEl.textContent = list.name;
  backBtn.hidden = false;
  fab.hidden = true;

  const s = stats(list);
  view.append(el("div", { className: "summary" },
    el("div", { className: "top" },
      el("span", { textContent: `${s.done} of ${s.total} done` }),
      el("span", { textContent: `${s.pct}%` })),
    el("div", { className: "bar" }, el("div", { style: `width:${s.pct}%` }))));

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

  // Add-item bar, fixed at the bottom (easy to reach on a phone)
  document.querySelector(".add-bar")?.remove();
  const input = el("input", { type: "text", placeholder: "Add an item…", maxLength: 200, enterKeyHint: "done" });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    list.items.push({ id: uid(), text, done: false });
    touch(list); save(); render();
    document.querySelector(".add-bar input").focus(); // keep typing
  };
  input.onkeydown = e => { if (e.key === "Enter") add(); };
  document.body.append(el("div", { className: "add-bar" },
    el("div", { className: "inner" }, input, el("button", { className: "primary", textContent: "Add", onclick: add }))));
}

function makeItemRow(list, item) {
  const cb = el("input", { type: "checkbox", checked: item.done });
  cb.onchange = () => { item.done = cb.checked; touch(list); save(); render(); };

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

  return el("div", { className: "item" + (item.done ? " done" : "") }, cb, text, del);
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
      currentListId = created.id; render();
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
      state.lists.push(copy); save(); currentListId = copy.id; render();
    });
    btn("Delete list", () => {
      if (confirm(`Delete "${currentList().name}"?`)) {
        state.lists = state.lists.filter(l => l.id !== currentListId);
        save(); currentListId = null; render();
      }
    }, "danger");
  }
  btn("Export backup (file)", exportData);
  btn("Import backup", importData);
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
      if (!confirm("Replace all current checklists with this backup?")) return;
      state = migrate(data); save(); currentListId = null; render();
    } catch (e) { alert("That file doesn't look like a valid backup."); }
  };
  inp.click();
}

// ---------- Events ----------
backBtn.onclick = () => { currentListId = null; render(); };
fab.onclick = () => openListDialog(null);
menuBtn.onclick = e => { e.stopPropagation(); buildMenu(); menu.hidden = !menu.hidden; };
document.addEventListener("click", () => { menu.hidden = true; });
window.addEventListener("popstate", () => { if (currentListId !== null) { currentListId = null; render(); } });

// ---------- Start ----------
render();

// Offline support + installability
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW failed", err));
}
