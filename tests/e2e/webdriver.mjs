// Minimal W3C WebDriver client for tauri-driver (no extra dependencies). Talks only to
// the local driver on 127.0.0.1.

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async create(base, application, args = []) {
    const r = await call(base, "POST", "/session", {
      capabilities: { alwaysMatch: { "tauri:options": { application, args } } },
    });
    return new Session(base, r.sessionId);
  }

  cmd(method, path, body) {
    return call(this.base, method, `/session/${this.id}${path}`, body);
  }

  title() {
    return this.cmd("GET", "/title");
  }
  exec(script, args = []) {
    return this.cmd("POST", "/execute/sync", { script, args });
  }
  async find(css) {
    const r = await this.cmd("POST", "/element", { using: "css selector", value: css });
    return Object.values(r)[0];
  }
  sendKeys(elementId, text) {
    return this.cmd("POST", `/element/${elementId}/value`, { text });
  }
  windowHandles() {
    return this.cmd("GET", "/window/handles");
  }
  switchTo(handle) {
    return this.cmd("POST", "/window", { handle });
  }
  /** Press a chord, e.g. chord(CTRL, "s"). */
  chord(...keys) {
    const down = keys.map((value) => ({ type: "keyDown", value }));
    const up = [...keys].reverse().map((value) => ({ type: "keyUp", value }));
    return this.cmd("POST", "/actions", {
      actions: [{ type: "key", id: "kbd", actions: [...down, ...up] }],
    });
  }
  async delete() {
    try {
      await this.cmd("DELETE", "");
    } catch {
      /* app may already be gone */
    }
  }
}

export const CTRL = "";
export const SHIFT = "";
export const END = "";

async function call(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.value && json.value.error)) {
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json.value ?? json)}`);
  }
  return json.value;
}
