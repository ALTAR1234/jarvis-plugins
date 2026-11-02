// J.A.R.V.I.S. plugin: Socialer, the private social app and messenger (plus its Instagram,
// Snapchat, TikTok and iMessage sidebar). Socialer runs a private control channel on
// 127.0.0.1 and writes its port and a per-launch secret to %APPDATA%\Socialer\control.json.
// If Socialer isn't running, this opens it and waits for the channel to come up.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const CONTROL = path.join(process.env.APPDATA || '', 'Socialer', 'control.json');
const SOCIALER_EXE = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'socialer', 'Socialer.exe');

function send(action, extra = {}) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
    } catch {
      return reject(Object.assign(new Error('Socialer is not running'), { code: 'NOT_RUNNING' }));
    }
    const body = JSON.stringify({ token: cfg.token, action, ...extra });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'Socialer said ' + res.statusCode));
        } catch {
          reject(new Error('Bad reply from Socialer'));
        }
      });
    });
    req.on('error', (e) => reject(e.code !== 'ECONNREFUSED' ? e : Object.assign(new Error('Socialer is not running'), { code: 'NOT_RUNNING' })));
    req.on('timeout', () => req.destroy(new Error('Socialer took too long to answer')));
    req.end(body);
  });
}

/** Send a command, opening Socialer first if it isn't running. */
async function command(ctx, action, extra) {
  try {
    return await send(action, extra);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  if (!fs.existsSync(SOCIALER_EXE)) throw new Error('Socialer was not found at ' + SOCIALER_EXE);
  await ctx.launch(SOCIALER_EXE);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await send(action, extra);
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error('Socialer did not start in time');
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
    name: 'check_messages',
    description: 'Check the user\'s Socialer messages: how many unread, from which chats, and the latest line of each. Also reports unread counts shown by Instagram, Snapchat and TikTok in Socialer\'s sidebar.',
    parameters: { type: 'object', properties: {} },
    summary: () => 'Checking your messages',
    run: wrap((_a, ctx) => command(ctx, 'status')),
  },
  {
    name: 'list_chats',
    description: 'List the user\'s recent Socialer chats with their latest message.',
    parameters: { type: 'object', properties: {} },
    summary: () => 'Looking at your chats',
    run: wrap((_a, ctx) => command(ctx, 'chats')),
  },
  {
    name: 'read_messages',
    description: 'Read the latest messages in one Socialer chat (a person\'s name or a group name). Marks them read.',
    parameters: { type: 'object', properties: { chat: { type: 'string', description: 'Who the chat is with, or the group name, e.g. "Sam" or "Weekend crew"' } }, required: ['chat'] },
    summary: (a) => `Reading your chat with ${a.chat}`,
    run: wrap(({ chat }, ctx) => command(ctx, 'read', { query: chat })),
  },
  {
    name: 'send_message',
    description: 'Send a Socialer message to a person or group chat. Use the user\'s words for the text; if they did not say exactly what to send, ask first.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The person\'s name or the group name' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['to', 'text'],
    },
    confirm: true, // shows the message in the HUD and waits for your OK before sending
    summary: (a) => `Messaging ${a.to}: ${a.text}`,
    run: wrap(({ to, text }, ctx) => command(ctx, 'send', { query: to, text })),
  },
  {
    name: 'open_social_app',
    description: 'Open Socialer, or one of the apps in its sidebar: Instagram, Snapchat or TikTok messages, or iMessage (which opens Phone Link).',
    parameters: { type: 'object', properties: { app: { type: 'string', enum: ['Socialer', 'Instagram', 'Snapchat', 'TikTok', 'iMessage'] } }, required: ['app'] },
    summary: (a) => `Opening ${a.app}`,
    run: wrap(({ app }, ctx) => command(ctx, 'open', { query: app.toLowerCase() })),
  },
];
