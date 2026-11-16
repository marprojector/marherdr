import { spaces, panes, terminals, run, exec, playSound, settings, shared, setShared } from "herdr";

const cache = new Map(); // tid -> { time, title }
const CACHE_TTL_MS = 3000;
const seenFailed = new Set();
const lastStates = new Map();

// A name the person gave a tab wins for good. `tab.named` alone can't tell their
// rename from this mod's own (`run("tab.rename")` sets it too), so remember every
// name this mod set: a tab whose name is not one of those was renamed by the person.
const OWNED_KEY = "autorename.owned";
const owned = new Map(); // tabId -> the name this mod last set
const personOwned = new Set(); // tabId -> the person named it; never touch it again
let loaded = false;

function loadOwned() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = shared(OWNED_KEY);
    if (raw && typeof raw === "object") {
      for (const [id, name] of Object.entries(raw)) owned.set(id, name);
    }
  } catch {}
}

function saveOwned() {
  try {
    setShared(OWNED_KEY, Object.fromEntries(owned));
  } catch {}
}

function checkFailedSounds(terms) {
  const cfg = settings()?.sounds;
  if (cfg?.enabled === false) return;

  for (const t of terms) {
    const isAgent = Boolean(t.agent || t.status?.app || t.program?.agent);
    if (!isAgent) continue;

    const isFailed =
      t.status === "error" ||
      t.status?.state === "error" ||
      (t.state === "finished" && typeof t.exit_code === "number" && t.exit_code !== 0);

    const prev = lastStates.get(t.address);
    lastStates.set(t.address, t.status?.state || t.status || t.state);

    if (isFailed && !seenFailed.has(t.address)) {
      seenFailed.add(t.address);
      if (prev && prev !== "finished") {
        try {
          playSound(cfg?.failed ?? "sounds/failed.mp3");
        } catch (_) {}
      }
    }
  }
}

function cleanStr(s) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/[`*_\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatTitle(s, maxLen = 22) {
  let title = cleanStr(s);
  if (!title) return "";
  if (title.length > 15) {
    title = title.replace(/\s*\([^)]*\)$/, "");
  }
  // If executable path like ./bin/dev or /usr/local/bin/node
  if (/^(\.\/|\/)/.test(title)) {
    const spaceIdx = title.indexOf(" ");
    const exe = spaceIdx > 0 ? title.slice(0, spaceIdx) : title;
    const rest = spaceIdx > 0 ? title.slice(spaceIdx) : "";
    const base = exe.split("/").filter(Boolean).at(-1) || exe;
    title = (base + rest).trim();
  }
  if (title.length > maxLen) {
    return title.slice(0, maxLen - 1).trim() + "…";
  }
  return title;
}

export function extractTaskFromMsg(msg) {
  if (!msg || typeof msg !== "string") return null;

  // 1. Look for bold markdown **...**
  const boldMatches = [...msg.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
  const goodBolds = boldMatches.filter(
    (b) => b.length >= 3 && !/^(user|role|done|error|warning|perbaikan|penyebab|catatan|solusi)$/i.test(b)
  );
  if (goodBolds.length > 0) {
    let candidate = goodBolds[0].replace(/[`'\"]/g, "").trim();
    const sub = candidate.match(/\((?:role\s+)?([^)]+)\)/i);
    if (sub) candidate = sub[1].trim();
    return formatTitle(candidate, 22);
  }

  // 2. Look for backticks `...`
  const tickMatches = [...msg.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  const goodTicks = tickMatches.filter(
    (t) => t.length >= 3 && !t.startsWith("/") && t.length <= 25 && !/^[0-9a-f]{7,40}$/i.test(t)
  );
  if (goodTicks.length > 0) {
    return formatTitle(goodTicks[0], 22);
  }

  // 3. Commit / push pattern
  if (/commit/i.test(msg) && /push/i.test(msg)) {
    const branch = msg.match(/branch\s+`?([a-zA-Z0-9_\-\.]+)/i);
    return branch ? `Push ${branch[1]}` : "Commit & Push";
  }

  // 4. First short clause
  const first = msg.split(/[:\.\n]/)[0].replace(/[`*_\r\n]+/g, " ").trim();
  if (first && first.length >= 4 && first.length <= 25) {
    return formatTitle(first, 22);
  }

  return null;
}

export function extractTaskFromScreen(screen) {
  if (!screen || typeof screen !== "string") return null;
  const lines = screen.split("\n").map((l) => l.trim()).filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // File edit or create: ● Edit(...) or ● Create(...)
    const fileMatch = line.match(/●\s*(Edit|Create)\([^)]*\/([^\/)]+)\)/);
    if (fileMatch) return formatTitle(`${fileMatch[1]} ${fileMatch[2]}`, 22);

    // Bash command: ● Bash(cmd)
    const bashMatch = line.match(/●\s*Bash\(([^)]+)\)/);
    if (bashMatch) {
      let cmd = bashMatch[1].trim().split("&&")[0].split("|")[0].trim();
      cmd = cmd.replace(/^cd\s+[^&]+\s*&&\s*/, "");
      if (!/^(touch|find|ls|cat|which|mkdir|rm)\b/.test(cmd)) {
        return formatTitle(cmd, 22);
      }
    }

    // Markdown section heading: ### 1. Foo or ## Foo
    const headMatch = line.match(/^#{1,4}\s+(?:\d+[\.\)]\s+)?([^\n\r]+)/);
    if (headMatch) {
      const h = headMatch[1].replace(/[`*_\r\n]+/g, " ").trim();
      if (h.length >= 3 && h.length <= 80 && !/^(summary|ringkasan|catatan|overview)$/i.test(h)) {
        return formatTitle(h, 22);
      }
    }

    // User prompt marker like "> ..." or "❯ ..."
    const promptMatch = line.match(/^[>❯]\s*(.+)$/);
    if (promptMatch) {
      const p = promptMatch[1].trim();
      if (p.length >= 3 && !p.startsWith("Try ") && !p.startsWith("Claude Code")) {
        return formatTitle(p, 22);
      }
    }
  }

  return null;
}

export async function fetchLiveTask(tid) {
  if (!tid) return null;
  const now = Date.now();
  const cached = cache.get(tid);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.title;
  }

  try {
    const res = await exec("hc", ["get", "--json", tid]);
    if (res.code === 0 && res.stdout) {
      const info = JSON.parse(res.stdout);
      const msg = info.status?.msg;
      let task = extractTaskFromMsg(msg);

      if (!task) {
        const readRes = await exec("hc", ["read", tid]);
        if (readRes.code === 0 && readRes.stdout) {
          task = extractTaskFromScreen(readRes.stdout);
        }
      }

      cache.set(tid, { time: now, title: task });
      return task;
    }
  } catch {}

  return null;
}

export function resolveTabSync(tab, allPanes = panes(), allTerms = terminals()) {
  const mine = allPanes.filter((p) => p.tab === tab.id);
  const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
  if (!lead) return null;

  if (lead.mod) {
    return formatTitle(lead.title || lead.mod);
  }

  const term = allTerms.find((t) => t.address === lead.terminal);

  // Check cached live task (from agent status or screen)
  const cached = cache.get(lead.terminal);
  if (cached?.title) {
    return cached.title;
  }

  // Explicit terminal template or custom name
  if (term?.name && !term.name.startsWith("t") && term.name !== "hc") {
    return formatTitle(term.name);
  }

  // Active CLI foreground command (if not shell and not agent)
  const argv = term?.foreground?.argv;
  if (argv && argv.length > 0) {
    const rawCmd = argv.join(" ").trim();
    if (!/^\/(?:bin|usr\/bin|usr\/local\/bin)\/(?:zsh|bash|sh|fish|nu)(?:\s+-[la]+)?$/.test(rawCmd)) {
      if (!/^(zsh|bash|sh|fish|nu|agy|claude|codex|opencode)\b/.test(rawCmd)) {
        return formatTitle(rawCmd);
      }
    }
  }

  // Fallback to program name
  if (lead.program?.name && !lead.program.shell) {
    return lead.program.name;
  }

  // Fallback to directory name
  if (lead.cwd) {
    const parts = lead.cwd.replace(/\/+$/, "").split("/");
    const last = parts.at(-1);
    if (last && last !== "~") return last;
  }

  return "Terminal";
}

let running = false;
export async function autoRenameTabs() {
  if (running) return;
  running = true;
  loadOwned();

  try {
    const sps = spaces();
    const pns = panes();
    const terms = terminals();

    checkFailedSounds(terms);

    for (const space of sps) {
      const tabs = space.tabs ?? [];
      const spaceTitles = [];

      for (const tab of tabs) {
        const mine = pns.filter((p) => p.tab === tab.id);
        const lead = mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
        if (lead?.terminal) {
          await fetchLiveTask(lead.terminal);
        }

        const target = resolveTabSync(tab, pns, terms);
        spaceTitles.push({ tab, target });
      }

      // Check duplicates within the same space
      const countMap = new Map();
      for (const { target } of spaceTitles) {
        if (target) {
          countMap.set(target, (countMap.get(target) || 0) + 1);
        }
      }

      const seenMap = new Map();
      for (const { tab, target } of spaceTitles) {
        if (!target) continue;

        if (!tab.named) {
          // Nobody named it (its name is just its number): ours to name.
          personOwned.delete(tab.id);
          owned.delete(tab.id);
        } else if (owned.get(tab.id) === tab.name) {
          // Still the name this mod set: keep managing it.
          personOwned.delete(tab.id);
        } else if (personOwned.has(tab.id)) {
          continue;
        } else if (tab.name === target) {
          // Named, and already what the mod would set (a tab named before this
          // bookkeeping existed): adopt it and keep going.
          owned.set(tab.id, tab.name);
          saveOwned();
        } else {
          // Named with something this mod never set: the person named it.
          // Leave it alone from now on, until they clear the name.
          personOwned.add(tab.id);
          continue;
        }

        let finalTitle = target;
        if ((countMap.get(target) || 0) > 1) {
          const idx = (seenMap.get(target) || 0) + 1;
          seenMap.set(target, idx);
          finalTitle = `${target} #${idx}`;
        }
        if (tab.name !== finalTitle) {
          owned.set(tab.id, finalTitle);
          saveOwned();
          run("tab.rename", { id: tab.id, name: finalTitle });
        }
      }
    }

    // Forget tabs that are gone.
    const live = new Set(sps.flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    let pruned = false;
    for (const id of owned.keys()) {
      if (!live.has(id)) {
        owned.delete(id);
        personOwned.delete(id);
        pruned = true;
      }
    }
    if (pruned) saveOwned();
  } finally {
    running = false;
  }
}
