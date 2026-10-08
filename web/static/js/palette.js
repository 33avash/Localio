import { escapeHtml } from "./format.js";

// The command palette: Ctrl+K (⌘K on a Mac) or "/". It searches what the
// data actually holds (ward names and the localities inside each ward)
// and offers commands. Numbers become commands: "50k" offers a rent
// ceiling, "400 sq ft" a shop size. Arrow keys move, Enter runs, Esc closes.
export function createPalette(dialog, { wards, commands }) {
  const input = dialog.querySelector("#palette-input");
  const list = dialog.querySelector("#palette-list");
  let items = [];
  let active = 0;

  const entries = wards.map(({ properties: p }) => ({
    name: p.name,
    terms: [p.name, ...p.aliases].map(fold),
    hint: `${p.corporation} ward ${p.ward_number}`,
    aliases: p.aliases,
  }));

  function search(query) {
    const q = fold(query.trim());
    const found = [];
    if (q) {
      for (const e of entries) {
        const hit = e.terms.findIndex((t) => t.includes(q));
        if (hit === -1) continue;
        const starts = e.terms[hit].startsWith(q);
        const via = hit === 0 ? "" : e.aliases[hit - 1];
        found.push({ score: (hit === 0 ? 0 : 1) + (starts ? 0 : 2), group: "Wards", label: e.name, ward: true,
          hint: via ? `includes ${via}` : e.hint, run: (c) => c.openWard(e.name) });
      }
      found.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
    }
    const typed = numberCommands(query, commands);
    const matching = commands.list.filter((c) => !q || fold(`${c.label} ${c.keywords ?? ""}`).includes(q));
    return [...typed, ...found.slice(0, 8), ...matching.map((c) => ({ ...c, group: c.group ?? "Commands" }))];
  }

  function draw() {
    items = search(input.value);
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!items.length) {
      list.innerHTML = `<li class="palette-empty">Nothing matches. Localio searches ward names and the localities
        inside them; colleges and stations aren't searchable yet.</li>`;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    let group = null;
    list.innerHTML = items.map((item, i) => {
      const head = item.group !== group ? `<li class="palette-group" role="presentation">${escapeHtml(item.group)}</li>` : "";
      group = item.group;
      return `${head}<li class="palette-item" role="option" id="pi-${i}" data-index="${i}" aria-selected="${i === active}">
        <span class="pi-label${item.ward ? " pi-ward" : ""}">${escapeHtml(item.label)}</span>
        ${item.hint ? `<span class="pi-hint">${escapeHtml(item.hint)}</span>` : ""}</li>`;
    }).join("");
    input.setAttribute("aria-activedescendant", `pi-${active}`);
    list.querySelector(`#pi-${active}`)?.scrollIntoView({ block: "nearest" });
  }

  function run(index) {
    const item = items[index];
    if (!item) return;
    dialog.close();
    item.run(commands);
  }

  input.addEventListener("input", () => { active = 0; draw(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  });
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-index]");
    if (item) run(Number(item.dataset.index));
  });
  list.addEventListener("mousemove", (event) => {
    const item = event.target.closest("[data-index]");
    if (!item || Number(item.dataset.index) === active) return;
    active = Number(item.dataset.index);
    for (const el of list.querySelectorAll("[aria-selected]")) el.setAttribute("aria-selected", String(el === item));
    input.setAttribute("aria-activedescendant", item.id);
  });
  // A click on the backdrop closes it.
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  return {
    open(query = "") {
      if (dialog.open) return;
      input.value = query;
      active = 0;
      draw();
      dialog.showModal();
      input.focus();
    },
  };
}

// "50k", "₹45,000", "400 sq ft": numbers the brief can use.
function numberCommands(query, commands) {
  const sqft = query.match(/(\d{2,4})\s*(?:sq\.?\s*ft|sqft|sft)/i);
  if (sqft) {
    const value = Number(sqft[1]);
    if (value >= 50 && value <= 5000) return [{ group: "Set", label: `Shop size: ${value} sq ft`, run: (c) => c.set("sqft", value) }];
  }
  const money = query.replace(/[₹,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|l|lakh)?$/i);
  if (money) {
    const unit = (money[2] ?? "").toLowerCase();
    const value = Math.round(Number(money[1]) * (unit === "k" ? 1e3 : unit.startsWith("l") ? 1e5 : 1));
    if (value >= 1000 && value <= 5e6) {
      return [{ group: "Set", label: `Rent ceiling: ₹${value.toLocaleString("en-IN")} a month`, run: (c) => c.set("budget", value) }];
    }
  }
  return [];
}

function fold(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
