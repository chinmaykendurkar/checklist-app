// ---------- Data ----------
// All data lives in the browser's localStorage on THIS device.
// Shape: { lists: [ { id, name, items: [ { id, text, done } ] } ] }
const KEY = "checklists-v1";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("Could not read saved data", e); }
  return { lists: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert("Could not save data (storage full or blocked)."); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let state = load();
let currentListId = null; // null = home screen

// ---------- Elements ----------
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const backBtn = document.getElementById("backBtn");
const menuBtn = document.getElementById("menuBtn");
const menu = document.getElementById("menu");

// ---------- Helpers ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}
const currentList = () => state.lists.find(l => l.id === currentListId);

// ---------- Screens ----------
function render() {
  menu.hidden = true;
  view.replaceChildren();
  if (currentListId === null) renderHome();
  else if (currentList()) renderList(currentList());
  else { currentListId = null; renderHome(); }
}

function renderHome() {
  titleEl.textContent = "Checklists";
  backBtn.hidden = true;

  if (state.lists.length === 0) {
    view.append(el("div", { className: "empty", textContent: "No checklists yet. Create your first one below." }));
  }
  for (const list of state.lists) {
    const done = list.items.filter(i => i.done).length;
    const total = list.items.length;
    const pct = total ? Math.round(done / total * 100) : 0;
    const row = el("div", { className: "list-row" },
      el("span", { className: "name", textContent: list.name }),
      el("span", { className: "count", textContent: `${done}/${total}` }));
    row.onclick = () => { currentListId = list.id; render(); };
    const bar = el("div", { className: "progress" }, el("div", { style: `width:${pct}%` }));
    view.append(el("div", { className: "card" }, row, bar));
  }

  const input = el("input", { placeholder: "New checklist name", maxLength: 80 });
  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    const list = { id: uid(), name, items: [] };
    state.lists.push(list);
    save();
    currentListId = list.id;
    render();
  };
  input.onkeydown = e => { if (e.key === "Enter") add(); };
  view.append(el("div", { className: "add-row" }, input, el("button", { className: "primary", textContent: "Create", onclick: add })));
}

function renderList(list) {
  titleEl.textContent = list.name;
  backBtn.hidden = false;

  const toolbar = el("div", { className: "toolbar" },
    el("button", { className: "secondary", textContent: "Uncheck all (reuse)", onclick: () => {
      list.items.forEach(i => i.done = false); save(); render();
    } }),
    el("button", { className: "secondary", textContent: "Remove checked", onclick: () => {
      list.items = list.items.filter(i => !i.done); save(); render();
    } }));
  view.append(toolbar);

  if (list.items.length === 0) {
    view.append(el("div", { className: "empty", textContent: "Empty list. Add your first item below." }));
  } else {
    const card = el("div", { className: "card" });
    for (const item of list.items) {
      const cb = el("input", { type: "checkbox", checked: item.done });
      cb.onchange = () => { item.done = cb.checked; save(); render(); };
      const text = el("span", { className: "text", textContent: item.text });
      const del = el("button", { className: "del", textContent: "✕", title: "Delete item" });
      del.onclick = () => { list.items = list.items.filter(i => i.id !== item.id); save(); render(); };
      card.append(el("div", { className: "item" + (item.done ? " done" : "") }, cb, text, del));
    }
    view.append(card);
  }

  const input = el("input", { placeholder: "Add item", maxLength: 200 });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    list.items.push({ id: uid(), text, done: false });
    save();
    render();
    view.querySelector(".add-row input").focus(); // keep typing
  };
  input.onkeydown = e => { if (e.key === "Enter") add(); };
  view.append(el("div", { className: "add-row" }, input, el("button", { className: "primary", textContent: "Add", onclick: add })));
}

// ---------- Menu ----------
function buildMenu() {
  menu.replaceChildren();
  const btn = (label, fn, cls = "") => menu.append(el("button", { textContent: label, className: cls, onclick: () => { menu.hidden = true; fn(); } }));

  if (currentListId !== null && currentList()) {
    btn("Rename list", () => {
      const name = prompt("New name:", currentList().name);
      if (name && name.trim()) { currentList().name = name.trim(); save(); render(); }
    });
    btn("Duplicate list", () => {
      const src = currentList();
      const copy = { id: uid(), name: src.name + " (copy)", items: src.items.map(i => ({ id: uid(), text: i.text, done: false })) };
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
      state = data; save(); currentListId = null; render();
    } catch (e) { alert("That file doesn't look like a valid backup."); }
  };
  inp.click();
}

// ---------- Events ----------
backBtn.onclick = () => { currentListId = null; render(); };
menuBtn.onclick = e => { e.stopPropagation(); buildMenu(); menu.hidden = !menu.hidden; };
document.addEventListener("click", () => { menu.hidden = true; });

// ---------- Start ----------
render();

// Offline support + installability
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW failed", err));
}
