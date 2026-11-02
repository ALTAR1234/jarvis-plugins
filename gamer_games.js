// J.A.R.V.I.S. plugin: your Gamer game library.
// Reads Gamer's library (%APPDATA%\nexus-games\library.json) so it works even
// when Gamer isn't open, and launches games the same way Gamer does.
const fs = require('node:fs');
const path = require('node:path');

const LIBRARY = path.join(process.env.APPDATA || '', 'nexus-games', 'library.json');
// the installed app (Settings > Apps), or the copy in the code folder if it isn't installed
const GAMER_CMD = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nexus-games', 'Gamer.exe'),
  path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'AIReason', 'nexus', 'Gamer.cmd'),
].find((p) => fs.existsSync(p)) ?? '';

const norm = (s = '') => s.toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function games() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY, 'utf8')).games.filter((g) => !g.hidden);
  } catch {
    return [];
  }
}

/** Best match for a spoken name: exact, then contains, then most shared words. */
function find(name) {
  const want = norm(name);
  const list = games();
  const exact = list.find((g) => norm(g.title) === want);
  if (exact) return exact;
  const contains = list.filter((g) => norm(g.title).includes(want) || want.includes(norm(g.title)));
  if (contains.length) return contains.sort((a, b) => a.title.length - b.title.length)[0];
  const words = new Set(want.split(' '));
  let best = null;
  let bestScore = 0;
  for (const g of list) {
    const score = norm(g.title).split(' ').filter((w) => words.has(w)).length;
    if (score > bestScore) [best, bestScore] = [g, score];
  }
  return best;
}

const hours = (s) => (s ? `${(s / 3600).toFixed(1)} hours` : 'not played yet');

module.exports = [
  {
    name: 'list_games',
    description: "List the user's PC games from their Gamer game library (Steam, Xbox app / Game Pass, EA, Epic, Roblox and others), with playtime. Use when they ask what games they have or what to play.",
    parameters: { type: 'object', properties: {} },
    summary: () => 'Checked your game library',
    async run() {
      const list = games();
      if (!list.length) return { games: [], detail: 'The Gamer library is empty or Gamer has not scanned for games yet.' };
      return {
        games: list
          .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
          .map((g) => ({ title: g.title, from: g.source, playtime: hours(g.playtime), lastPlayed: g.lastPlayed ? new Date(g.lastPlayed).toLocaleDateString() : 'never', pinned: !!g.pinned })),
      };
    },
  },
  {
    name: 'launch_game',
    description: 'Launch one of the user\'s PC games by name from their Gamer library (for example "NBA 2K27", "Fortnite", "Forza"). Matches loosely, so partial names work.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'The game to launch, as the user said it' } }, required: ['name'] },
    summary: (a) => `Launching ${a.name}`,
    async run({ name }, ctx) {
      const g = find(name);
      if (!g) return { status: 'error', detail: `No game matching "${name}" in the Gamer library.` };
      await ctx.launch(g.target);
      return { launched: g.title, from: g.source };
    },
  },
  {
    name: 'open_gamer',
    description: 'Open the Gamer game launcher (the console-style game library, Game Pass catalog, captures and stats).',
    parameters: { type: 'object', properties: {} },
    summary: () => 'Opening Gamer',
    async run(_a, ctx) {
      if (!fs.existsSync(GAMER_CMD)) return { status: 'error', detail: 'Gamer was not found at ' + GAMER_CMD };
      await ctx.launch(GAMER_CMD);
      return { opened: 'Gamer' };
    },
  },
];
