// J.A.R.V.I.S. plugin: the Streamer TV app (Netflix, Disney+, Hulu, Prime Video,
// Paramount+, Peacock, Apple TV+ and YouTube in one window).
// Streamer runs a private control channel on 127.0.0.1 and writes its port and
// a per-launch secret to %APPDATA%\Streamer\control.json. If Streamer isn't
// running, this opens it and waits for the channel to come up.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const CONTROL = path.join(process.env.APPDATA || '', 'Streamer', 'control.json');
// the installed app (Settings > Apps), or the copy in the code folder if it isn't installed
const STREAMER_CMD = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Streamer', 'electron.exe'),
  path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason', 'streamer-tv', 'Streamer.cmd'),
].find((p) => fs.existsSync(p)) ?? '';

function send(action, extra = {}) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
    } catch {
      return reject(Object.assign(new Error('Streamer is not running'), { code: 'NOT_RUNNING' }));
    }
    const body = JSON.stringify({ token: cfg.token, action, ...extra });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'Streamer said ' + res.statusCode));
        } catch {
          reject(new Error('Bad reply from Streamer'));
        }
      });
    });
    req.on('error', (e) => reject(e.code !== 'ECONNREFUSED' ? e : Object.assign(new Error('Streamer is not running'), { code: 'NOT_RUNNING' })));
    req.on('timeout', () => req.destroy(new Error('Streamer took too long to answer')));
    req.end(body);
  });
}

/** Send a command, opening Streamer first if it isn't running. */
async function command(ctx, action, extra) {
  try {
    return await send(action, extra);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  if (!fs.existsSync(STREAMER_CMD)) throw new Error('Streamer was not found at ' + STREAMER_CMD);
  await ctx.launch(STREAMER_CMD);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      return await send(action, extra);
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error('Streamer did not start in time');
}

const wrap = (fn) => async (args, ctx) => {
  try {
    return await fn(args, ctx);
  } catch (e) {
    return { status: 'error', detail: e.message };
  }
};

const SERVICE_ENUM = ['Netflix', 'Disney+', 'Hulu', 'Prime Video', 'Paramount+', 'Peacock', 'Apple TV+', 'YouTube'];

module.exports = [
  {
    name: 'watch_show',
    description: 'Find and open a TV show, movie or video in the Streamer TV app. If no service is given, Streamer works out which of the user\'s services has the show (Netflix, Disney+, Hulu, Prime Video, Paramount+, Peacock, Apple TV+, YouTube).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The show, movie or video, e.g. "The Bear" or "MrBeast"' },
        service: { type: 'string', enum: SERVICE_ENUM, description: 'Only if the user named a service' },
      },
      required: ['title'],
    },
    summary: (a) => `Opening ${a.title}${a.service ? ' on ' + a.service : ''}`,
    run: wrap(({ title, service }, ctx) => command(ctx, 'watch', { query: title, service: service || '' })),
  },
  {
    name: 'open_streaming_service',
    description: 'Open one of the user\'s streaming services in Streamer, or Streamer\'s home screen.',
    parameters: { type: 'object', properties: { service: { type: 'string', enum: [...SERVICE_ENUM, 'Home'] } }, required: ['service'] },
    summary: (a) => `Opening ${a.service}`,
    run: wrap(({ service }, ctx) => (service === 'Home' ? command(ctx, 'home') : command(ctx, 'open', { service }))),
  },
  {
    name: 'tv_playback',
    description: 'Pause or resume what is playing in Streamer, or say what is on.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'now'] } }, required: ['action'] },
    summary: (a) => `TV: ${a.action}`,
    run: wrap(({ action }, ctx) => command(ctx, action)),
  },
];
