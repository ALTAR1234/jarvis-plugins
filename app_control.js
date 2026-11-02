// J.A.R.V.I.S. plugin: see and use Listener, Gamer, Weber and Streamer.
// Each app runs a private control channel on 127.0.0.1 and writes its port and a
// per-launch secret to control.json in its data folder. see_app lists what's on
// screen (buttons, links, fields, tabs…) with short ids; use_app clicks, types,
// presses keys or scrolls using those ids, then reports the screen again.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const appData = process.env.APPDATA || '';
const local = process.env.LOCALAPPDATA || '';
const dev = path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason');
// the installed app (Settings > Apps), or the copy in the code folder if it isn't installed
const firstExisting = (...p) => p.find((x) => fs.existsSync(x)) ?? '';
const APPS = {
  Listener: { control: path.join(appData, 'aurora-music', 'control.json'), exe: () => firstExisting(path.join(local, 'Programs', 'aurora-music', 'Listener.exe'), path.join(dev, 'aurora-music', 'Listener.cmd')) },
  Gamer: { control: path.join(appData, 'nexus-games', 'control.json'), exe: () => firstExisting(path.join(local, 'Programs', 'nexus-games', 'Gamer.exe'), path.join(dev, 'nexus', 'Gamer.cmd')) },
  Weber: { control: path.join(appData, 'Weber', 'control.json'), exe: () => firstExisting(path.join(local, 'Programs', 'weber-browser', 'Weber.exe'), path.join(dev, 'weber', 'Weber.cmd')) },
  Streamer: { control: path.join(appData, 'Streamer', 'control.json'), exe: () => firstExisting(path.join(local, 'Programs', 'Streamer', 'electron.exe'), path.join(dev, 'streamer-tv', 'Streamer.cmd')) },
};
const NAMES = Object.keys(APPS);

function send(name, body) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(APPS[name].control, 'utf8'));
    } catch {
      return reject(Object.assign(new Error(`${name} is not running`), { code: 'NOT_RUNNING' }));
    }
    const data = JSON.stringify({ token: cfg.token, ...body });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 20000 }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(out || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || `${name} said ${res.statusCode}`));
        } catch {
          reject(new Error(`Bad reply from ${name}`));
        }
      });
    });
    req.on('error', (e) => reject(e.code !== 'ECONNREFUSED' ? e : Object.assign(new Error(`${name} is not running`), { code: 'NOT_RUNNING' })));
    req.on('timeout', () => req.destroy(new Error(`${name} took too long to answer`)));
    req.end(data);
  });
}

/** Send a command, opening the app first if it isn't running. */
async function command(ctx, name, body) {
  try {
    return await send(name, body);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  const exe = APPS[name].exe();
  if (!exe) throw new Error(`${name} isn't installed.`);
  await ctx.launch(exe);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await send(name, body);
      return r;
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error(`${name} did not start in time`);
}

// Compact, model-friendly description of a screen section.
function describe(section, heading) {
  if (!section) return null;
  const lines = (section.elements || []).map((e) => `${e.id} ${e.kind}: ${e.label}${e.value ? ` [value: ${e.value}]` : ''}${e.selected ? ' (selected)' : ''}${e.disabled ? ' (disabled)' : ''}`);
  return {
    screen: heading,
    title: section.title || undefined,
    url: section.url || undefined,
    heading: section.heading || undefined,
    elements: lines,
    visible_text: (section.text || '').slice(0, 1500),
  };
}
const shape = (name, r) => ({
  app: name,
  [`${name} interface`]: describe(r.app, `${name}'s own controls (ids starting with a)`),
  ...(r.page ? { 'web page': describe(r.page, 'the web page open in Weber (ids starting with p)') } : {}),
  ...(r.service ? { service: describe(r.service, `${r.service.name}, open inside Streamer (ids starting with p)`) } : {}),
});

const wrap = (fn) => async (args, ctx) => {
  const name = NAMES.find((n) => n.toLowerCase() === String(args.app || '').toLowerCase());
  if (!name) return { status: 'error', detail: `Unknown app. Use one of: ${NAMES.join(', ')}.` };
  try {
    return await fn(name, args, ctx);
  } catch (e) {
    return { status: 'error', detail: e.message };
  }
};

module.exports = [
  {
    name: 'see_app',
    description:
      "See what's on screen in one of the user's own apps: Listener (music), Gamer (games and Xbox), Weber (web browser, including the web page that's open) or Streamer (TV services, including the service that's open). Returns every visible button, link, field and tab with a short id (like a4 or p12), plus the visible text. Use this before use_app, and again whenever ids may have changed.",
    parameters: { type: 'object', properties: { app: { type: 'string', enum: NAMES } }, required: ['app'] },
    summary: (a) => `Looked at ${a.app}`,
    run: wrap(async (name, _a, ctx) => shape(name, await command(ctx, name, { action: 'see' }))),
  },
  {
    name: 'use_app',
    description:
      'Do something in Listener, Gamer, Weber or Streamer, like a person would: click an element, type into a field (replaces its text; set submit to press Enter after), press a key (Enter, Escape, Tab, Up, Down, Left, Right, Space, Backspace, PageDown…), scroll up or down, or show (bring the app to the front). Element ids come from see_app. Returns the screen afterwards with fresh ids.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', enum: NAMES },
        action: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'show'] },
        element: { type: 'string', description: 'Element id from see_app, for click and type (e.g. "a7" or "p3")' },
        text: { type: 'string', description: 'Text to type, the key to press, or "up"/"down" for scroll' },
        submit: { type: 'boolean', description: 'For type: press Enter after typing' },
        where: { type: 'string', enum: ['app', 'page'], description: 'For key/scroll in Weber or Streamer: the app itself or the open page/service (default: the page if one is open)' },
      },
      required: ['app', 'action'],
    },
    summary: (a) => `${a.app}: ${a.action}${a.element ? ' ' + a.element : ''}${a.text && a.action !== 'type' ? ' ' + a.text : ''}`,
    run: wrap(async (name, a, ctx) => {
      if (a.action === 'show') return command(ctx, name, { action: 'show' });
      const result = await command(ctx, name, { action: 'act', op: a.action, id: a.element || '', text: a.text || '', submit: !!a.submit, target: a.where || '' });
      if (result.error) return { status: 'error', detail: result.error };
      await new Promise((r) => setTimeout(r, 900)); // let the app react before looking again
      return { done: result, now: shape(name, await send(name, { action: 'see' })) };
    }),
  },
];
