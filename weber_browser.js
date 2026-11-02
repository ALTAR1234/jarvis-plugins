// J.A.R.V.I.S. plugin: drive the Weber web browser.
// Weber runs a private control channel on 127.0.0.1 and writes its port and
// a per-launch secret to %APPDATA%\Weber\control.json. If Weber isn't running,
// this opens it and waits for the channel to come up.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const CONTROL = path.join(process.env.APPDATA || '', 'Weber', 'control.json');
// the installed app (Settings > Apps), or the copy in the code folder if it isn't installed
const WEBER_CMD = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'weber-browser', 'Weber.exe'),
  path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason', 'weber', 'Weber.cmd'),
].find((p) => fs.existsSync(p)) ?? '';

function send(action, extra = {}) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
    } catch {
      return reject(Object.assign(new Error('Weber is not running'), { code: 'NOT_RUNNING' }));
    }
    const body = JSON.stringify({ token: cfg.token, action, ...extra });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'Weber said ' + res.statusCode));
        } catch {
          reject(new Error('Bad reply from Weber'));
        }
      });
    });
    req.on('error', (e) => reject(e.code !== 'ECONNREFUSED' ? e : Object.assign(new Error('Weber is not running'), { code: 'NOT_RUNNING' })));
    req.on('timeout', () => req.destroy(new Error('Weber took too long to answer')));
    req.end(body);
  });
}

/** Send a command, opening Weber first if it isn't running. */
async function command(ctx, action, extra) {
  try {
    return await send(action, extra);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  if (!fs.existsSync(WEBER_CMD)) throw new Error('Weber was not found at ' + WEBER_CMD);
  await ctx.launch(WEBER_CMD);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await send(action, extra);
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error('Weber did not start in time');
}

const wrap = (fn) => async (args, ctx) => {
  try {
    return await fn(args, ctx);
  } catch (e) {
    return { status: 'error', detail: e.message };
  }
};

module.exports = [
  {
    name: 'browse',
    description: 'Open a website or run a web search in the Weber browser. Give a URL or site name ("youtube.com", "reddit.com/r/nba") or search words ("best pizza near me"). Use new_tab to keep the current page open.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A URL, site address or search words' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of the current one' },
      },
      required: ['query'],
    },
    summary: (a) => `Opening ${a.query}`,
    run: wrap(({ query, new_tab }, ctx) => command(ctx, 'open', { query, newTab: !!new_tab })),
  },
  {
    name: 'read_web_page',
    description: 'Read the text of the page currently open in Weber, so you can summarize it, answer questions about it or pull out details.',
    parameters: { type: 'object', properties: {} },
    summary: () => 'Read the current page',
    run: wrap((_a, ctx) => command(ctx, 'read')),
  },
  {
    name: 'weber_tabs',
    description: 'List the tabs open in Weber (with ids), or switch to or close one. Use action "list" first to find the tab id.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'switch', 'close'] },
        tab_id: { type: 'number', description: 'Tab id for switch or close (close without an id closes the current tab)' },
      },
      required: ['action'],
    },
    summary: (a) => (a.action === 'list' ? 'Checked your tabs' : `Tab: ${a.action}`),
    run: wrap(({ action, tab_id }, ctx) => command(ctx, action === 'list' ? 'tabs' : action, { value: tab_id })),
  },
  {
    name: 'weber_navigate',
    description: 'Go back, forward or reload the current page in Weber.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['back', 'forward', 'reload'] } }, required: ['action'] },
    summary: (a) => `Browser: ${a.action}`,
    run: wrap(({ action }, ctx) => command(ctx, action)),
  },
];
