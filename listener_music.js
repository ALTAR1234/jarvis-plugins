// J.A.R.V.I.S. plugin: control the Listener music app.
// Listener runs a private control channel on 127.0.0.1 and writes its port and
// a per-launch secret to %APPDATA%\aurora-music\control.json. If Listener isn't
// running, this opens it and waits for the channel to come up.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const CONTROL = path.join(process.env.APPDATA || '', 'aurora-music', 'control.json');
// the installed app (Settings > Apps), or the copy in the code folder if it isn't installed
const LISTENER_CMD = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'aurora-music', 'Listener.exe'),
  path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason', 'aurora-music', 'Listener.cmd'),
].find((p) => fs.existsSync(p)) ?? '';

function send(action, extra = {}) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
    } catch {
      return reject(Object.assign(new Error('Listener is not running'), { code: 'NOT_RUNNING' }));
    }
    const body = JSON.stringify({ token: cfg.token, action, ...extra });
    const req = http.request({ host: '127.0.0.1', port: cfg.port, path: '/command', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data || '{}');
          res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'Listener said ' + res.statusCode));
        } catch {
          reject(new Error('Bad reply from Listener'));
        }
      });
    });
    req.on('error', (e) => reject(e.code !== 'ECONNREFUSED' ? e : Object.assign(new Error('Listener is not running'), { code: 'NOT_RUNNING' })));
    req.on('timeout', () => req.destroy(new Error('Listener took too long to answer')));
    req.end(body);
  });
}

/** Send a command, opening Listener first if it isn't running. */
async function command(ctx, action, extra) {
  try {
    return await send(action, extra);
  } catch (e) {
    if (e.code !== 'NOT_RUNNING') throw e;
  }
  if (!fs.existsSync(LISTENER_CMD)) throw new Error('Listener was not found at ' + LISTENER_CMD);
  await ctx.launch(LISTENER_CMD);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      // give the page a moment after the channel opens
      await new Promise((r) => setTimeout(r, 1500));
      return await send(action, extra);
    } catch (e) {
      if (e.code !== 'NOT_RUNNING') throw e;
    }
  }
  throw new Error('Listener did not start in time');
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
    name: 'play_music',
    description: 'Play a song, artist or album in the Listener music app (YouTube Music). Use for requests like "play Espresso", "play some Drake", "put on Thriller". Starts a station of similar songs after it.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to play, e.g. "Espresso Sabrina Carpenter"' } }, required: ['query'] },
    summary: (a) => `Playing ${a.query}`,
    run: wrap(({ query }, ctx) => command(ctx, 'play', { query })),
  },
  {
    name: 'music_control',
    description: 'Control music playing in Listener: pause, resume, skip to the next song, go back, like (love) the current song, or toggle shuffle.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'like', 'shuffle'] } }, required: ['action'] },
    summary: (a) => `Music: ${a.action}`,
    run: wrap(({ action }, ctx) => command(ctx, action)),
  },
  {
    name: 'music_volume',
    description: "Set Listener's music volume from 0 to 100 percent (this is the music app's own volume, not the Windows volume).",
    parameters: { type: 'object', properties: { percent: { type: 'number', description: '0 to 100' } }, required: ['percent'] },
    summary: (a) => `Music volume ${a.percent}%`,
    run: wrap(({ percent }, ctx) => command(ctx, 'volume', { value: percent })),
  },
  {
    name: 'now_playing',
    description: 'Say what song is currently playing in Listener and whether it is playing or paused.',
    parameters: { type: 'object', properties: {} },
    summary: () => 'Checked what is playing',
    run: wrap(async () => {
      try {
        return await send('now');
      } catch (e) {
        if (e.code === 'NOT_RUNNING') return { playing: false, detail: 'Listener is not open.' };
        throw e;
      }
    }),
  },
];
