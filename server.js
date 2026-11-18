// ============================================================================
//  TikTok Live Olympic Running Game - Server
//  Node.js + Express + socket.io + tiktok-live-connector (v2, ESM)
// ============================================================================
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------- Config ---------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';      // اختياري: يحمي لوحة المضيف
const AUTO_USERNAME = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '');
const SIGN_API_KEY = process.env.SIGN_API_KEY || '';        // اختياري (Euler Stream)

const MAX_RACERS = 10;
const TRACK_LEN = 1000;          // طول المضمار (وحدات داخلية)
const TICK_MS = 50;              // 20 تحديث في الثانية
const COUNTDOWN_S = 5;           // العد التنازلي قبل الانطلاق
const RESULT_S = 15;             // مدة عرض النتائج قبل الجولة الجديدة
const FULL_START_DELAY_MS = 3000; // بدء تلقائي بعد اكتمال 10 متسابقين
const LIKE_POWER = 1.2;          // وحدات دفع لكل لايك
const GIFT_POWER = 4;            // وحدات دفع لكل Diamond
const GIFT_CAP = 700;            // أقصى دفعة لهدية واحدة

const settings = {
  duration: 180,       // بالثواني، 0 = مفتوح حتى خط النهاية
  autoStart: true,     // بدء تلقائي عند اكتمال 10
  autoRestart: true,   // جولة جديدة تلقائياً بعد النتائج
};

// ----------------------------- Express / Socket -----------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

// ----------------------------- Game State -----------------------------------
const game = {
  phase: 'waiting',   // waiting | countdown | running | finished
  racers: new Map(),  // uniqueId -> racer
  countdownEnd: 0,
  startedAt: 0,
  endsAt: 0,          // 0 = مفتوح
  finishedAt: 0,
  fullSince: 0,
  seq: 0,             // ترتيب الدخول
  finishSeq: 0,
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function freeCharIndex(uid) {
  const used = new Set([...game.racers.values()].map((r) => r.charIdx));
  let idx = hashStr(uid) % MAX_RACERS;
  for (let i = 0; i < MAX_RACERS; i++) {
    const c = (idx + i) % MAX_RACERS;
    if (!used.has(c)) return c;
  }
  return idx;
}

function addRacer(user) {
  if (game.racers.has(user.id)) return game.racers.get(user.id);
  if (game.phase !== 'waiting') return null;         // الانضمام فقط قبل بدء الجولة
  if (game.racers.size >= MAX_RACERS) return null;
  const h = hashStr(user.id);
  const racer = {
    id: user.id,
    name: user.id,                                    // اسم المستخدم (uniqueId)
    nick: user.name || user.id,
    avatar: user.avatar || '',
    flag: user.flag || '',
    // لا تتوفر بيانات الجنس في أحداث البث، لذلك يُحدد عشوائياً ثابتاً حسب المستخدم
    gender: (h >> 3) % 2 === 0 ? 'boy' : 'girl',
    charIdx: freeCharIndex(user.id),
    lane: game.racers.size,
    joinSeq: game.seq++,
    pos: 0,
    pending: 0,
    likes: 0,
    diamonds: 0,
    speedFactor: 0.9 + (h % 21) / 100,                // 0.90 - 1.10
    finished: false,
    finishSeq: 0,
  };
  game.racers.set(racer.id, racer);
  assignLanes();
  console.log(`[JOIN] @${racer.id} (${racer.gender}) ${game.racers.size}/${MAX_RACERS}`);
  io.emit('fx', { type: 'join', id: racer.id });
  return racer;
}

function assignLanes() {
  [...game.racers.values()]
    .sort((a, b) => a.joinSeq - b.joinSeq)
    .forEach((r, i) => { r.lane = i; });
}

function baseSpeed() {
  // سرعة أساسية بسيطة تضمن حركة دائمة؛ الباقي من اللايكات والهدايا
  if (settings.duration > 0) return (TRACK_LEN * 0.45) / settings.duration;
  return TRACK_LEN / 240;
}

function startCountdown() {
  if (game.phase !== 'waiting' || game.racers.size < 1) return false;
  game.phase = 'countdown';
  game.countdownEnd = Date.now() + COUNTDOWN_S * 1000;
  console.log('[GAME] countdown');
  return true;
}

function startRace() {
  game.phase = 'running';
  game.startedAt = Date.now();
  game.endsAt = settings.duration > 0 ? game.startedAt + settings.duration * 1000 : 0;
  console.log('[GAME] race started');
}

function finishRace() {
  game.phase = 'finished';
  game.finishedAt = Date.now();
  const ranked = rankedRacers();
  console.log('[GAME] finished. winner:', ranked[0]?.id);
}

function resetRace() {
  game.racers.clear();
  game.phase = 'waiting';
  game.countdownEnd = 0;
  game.startedAt = 0;
  game.endsAt = 0;
  game.finishedAt = 0;
  game.fullSince = 0;
  game.seq = 0;
  game.finishSeq = 0;
  console.log('[GAME] reset');
}

function rankedRacers() {
  return [...game.racers.values()].sort((a, b) => {
    if (a.finished && b.finished) return a.finishSeq - b.finishSeq;
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (b.pos !== a.pos) return b.pos - a.pos;
    return a.joinSeq - b.joinSeq;
  });
}

// ----------------------------- Game Loop ------------------------------------
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;

  if (game.phase === 'waiting') {
    if (settings.autoStart && game.racers.size >= MAX_RACERS) {
      if (!game.fullSince) game.fullSince = now;
      else if (now - game.fullSince >= FULL_START_DELAY_MS) startCountdown();
    } else {
      game.fullSince = 0;
    }
  } else if (game.phase === 'countdown') {
    if (now >= game.countdownEnd) startRace();
  } else if (game.phase === 'running') {
    const base = baseSpeed();
    for (const r of game.racers.values()) {
      if (r.finished) continue;
      // دفعة اللايكات والهدايا تُصرف تدريجياً لحركة سلسة وقوية
      const drain = r.pending * (1 - Math.exp(-dt * 2.2));
      r.pending -= drain;
      if (r.pending < 0.01) r.pending = 0;
      r.pos += base * r.speedFactor * dt + drain;
      if (r.pos >= TRACK_LEN) {
        r.pos = TRACK_LEN;
        r.finished = true;
        r.finishSeq = ++game.finishSeq;
        r.pending = 0;
      }
    }
    const anyFinished = [...game.racers.values()].some((r) => r.finished);
    const timeUp = game.endsAt && now >= game.endsAt;
    if (anyFinished || timeUp) finishRace();
  } else if (game.phase === 'finished') {
    if (settings.autoRestart && now - game.finishedAt >= RESULT_S * 1000) resetRace();
  }

  io.emit('state', snapshot());
}

function snapshot() {
  const now = Date.now();
  const ranked = rankedRacers();
  const rankOf = new Map(ranked.map((r, i) => [r.id, i + 1]));
  return {
    phase: game.phase,
    maxRacers: MAX_RACERS,
    trackLen: TRACK_LEN,
    duration: settings.duration,
    timeLeft: game.phase === 'running' && game.endsAt ? Math.max(0, (game.endsAt - now) / 1000) : null,
    countdown: game.phase === 'countdown' ? Math.max(0, Math.ceil((game.countdownEnd - now) / 1000)) : 0,
    resetIn: game.phase === 'finished' && settings.autoRestart
      ? Math.max(0, Math.ceil((RESULT_S * 1000 - (now - game.finishedAt)) / 1000)) : null,
    racers: [...game.racers.values()].map((r) => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      flag: r.flag,
      gender: r.gender,
      charIdx: r.charIdx,
      lane: r.lane,
      pos: Math.round(r.pos * 100) / 100,
      boost: Math.min(1, r.pending / 150),
      likes: r.likes,
      diamonds: r.diamonds,
      finished: r.finished,
      rank: rankOf.get(r.id),
    })),
  };
}

setInterval(tick, TICK_MS);

// ----------------------------- TikTok Events --------------------------------
function extractUser(data) {
  // يدعم الشكل الجديد (data.user.*) والقديم (data.uniqueId)
  const u = data.user || {};
  const id = String(u.uniqueId || data.uniqueId || '').trim();
  const name = u.nickname || data.nickname || id;
  const avatar =
    u.profilePicture?.url?.[0] ||
    u.profilePicture?.urls?.[0] ||
    u.avatarThumb?.urlList?.[0] ||
    data.profilePictureUrl ||
    '';
  const region = u.region || data.region || '';
  const flag = /^[A-Za-z]{2}$/.test(region) ? regionToFlag(region) : '';
  return { id, name, avatar, flag };
}

function regionToFlag(cc) {
  return [...cc.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

function handleLike(data) {
  const user = extractUser(data);
  if (!user.id) return;
  const count = Math.max(1, Number(data.likeCount) || 1);
  // انضمام تلقائي بأول لايك
  const racer = game.racers.get(user.id) || addRacer(user);
  if (!racer) return;
  racer.likes += count;
  if (game.phase === 'running' && !racer.finished) {
    racer.pending += count * LIKE_POWER;
  }
}

function handleGift(data) {
  const details = data.giftDetails || {};
  const giftType = details.giftType ?? data.giftType;
  const repeatEnd = Boolean(data.repeatEnd);
  // الهدايا المتتابعة (Streak): تجاهل كل التكرارات حتى تنتهي السلسلة
  if (giftType === 1 && !repeatEnd) return;

  const user = extractUser(data);
  if (!user.id) return;
  const diamondsEach = Number(details.diamondCount ?? data.diamondCount) || 0;
  const repeat = Math.max(1, Number(data.repeatCount) || 1);
  const diamonds = diamondsEach * repeat;
  if (diamonds <= 0) return;

  // مرسل الهدية ينضم للسباق أيضاً إن كان هناك مكان
  const racer = game.racers.get(user.id) || addRacer(user);
  if (!racer) return;
  racer.diamonds += diamonds;
  if (game.phase === 'running' && !racer.finished) {
    racer.pending += Math.min(GIFT_CAP, diamonds * GIFT_POWER);
  }
  io.emit('fx', {
    type: 'gift',
    id: racer.id,
    diamonds,
    giftName: details.giftName || data.giftName || '',
  });
  console.log(`[GIFT] @${racer.id} ${details.giftName || ''} = ${diamonds} diamonds`);
}

// ----------------------------- TikTok Connection ----------------------------
let conn = null;
let wantUser = '';
let retryTimer = null;
let connStatus = { state: 'idle', username: '', message: '' };

function setStatus(state, message = '') {
  connStatus = { state, username: wantUser, message };
  io.emit('conn', connStatus);
  console.log(`[TIKTOK] ${state} ${wantUser} ${message}`);
}

function teardown() {
  clearTimeout(retryTimer);
  retryTimer = null;
  const c = conn;
  conn = null;                       // يمنع معالجات الأحداث القديمة
  if (c) {
    try { c.removeAllListeners(); } catch { /* ignore */ }
    try { c.disconnect(); } catch { /* ignore */ }
  }
}

function scheduleRetry() {
  if (!wantUser) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => connectTikTok(wantUser), 10000);
}

async function connectTikTok(username) {
  teardown();
  wantUser = String(username || '').replace(/^@/, '').trim();
  if (!wantUser) { setStatus('idle'); return; }
  setStatus('connecting');

  const options = { processInitialData: false };
  if (SIGN_API_KEY) options.signApiKey = SIGN_API_KEY;
  const c = new TikTokLiveConnection(wantUser, options);
  conn = c;

  c.on(WebcastEvent?.LIKE || 'like', (d) => { if (conn === c) handleLike(d); });
  c.on(WebcastEvent?.GIFT || 'gift', (d) => { if (conn === c) handleGift(d); });
  c.on(ControlEvent?.DISCONNECTED || 'disconnected', () => {
    if (conn !== c) return;
    setStatus('disconnected', 'انقطع الاتصال، إعادة المحاولة بعد 10 ثوانٍ');
    scheduleRetry();
  });
  c.on(ControlEvent?.ERROR || 'error', (e) => {
    console.error('[TIKTOK] error:', e?.message || e);
  });
  if (WebcastEvent?.STREAM_END) {
    c.on(WebcastEvent.STREAM_END, () => {
      if (conn === c) setStatus('disconnected', 'انتهى البث');
    });
  }

  try {
    await c.connect();
    if (conn === c) setStatus('connected');
  } catch (err) {
    if (conn !== c) return;
    setStatus('error', String(err?.message || err));
    scheduleRetry();
  }
}

function disconnectTikTok() {
  wantUser = '';
  teardown();
  setStatus('idle');
}

// ----------------------------- Host Controls (socket) -----------------------
io.on('connection', (socket) => {
  socket.data.isHost = !HOST_PASSWORD;
  socket.emit('hello', { needsAuth: Boolean(HOST_PASSWORD), isHost: socket.data.isHost });
  socket.emit('conn', connStatus);
  socket.emit('settings', settings);
  socket.emit('state', snapshot());

  socket.on('host:login', (password, ack) => {
    const ok = !HOST_PASSWORD || password === HOST_PASSWORD;
    socket.data.isHost = ok;
    if (typeof ack === 'function') ack({ ok });
  });

  const hostOnly = (fn) => (...args) => {
    if (!socket.data.isHost) return;
    try { fn(...args); } catch (e) { console.error(e); }
  };

  socket.on('host:connect', hostOnly((username) => connectTikTok(username)));
  socket.on('host:disconnect', hostOnly(() => disconnectTikTok()));

  socket.on('host:settings', hostOnly((s = {}) => {
    if (s.duration !== undefined) {
      const d = Number(s.duration);
      settings.duration = d === 0 ? 0 : Math.min(1800, Math.max(30, d || 180));
    }
    if (s.autoStart !== undefined) settings.autoStart = Boolean(s.autoStart);
    if (s.autoRestart !== undefined) settings.autoRestart = Boolean(s.autoRestart);
    io.emit('settings', settings);
  }));

  socket.on('host:start', hostOnly(() => startCountdown()));
  socket.on('host:reset', hostOnly(() => resetRace()));

  // أدوات اختبار للمضيف فقط (تُستخدم من host.html وليس من شاشة اللعبة)
  socket.on('host:testLike', hostOnly((p = {}) => {
    handleLike({ user: { uniqueId: String(p.id || 'test_user'), nickname: p.id }, likeCount: Number(p.count) || 15 });
  }));
  socket.on('host:testGift', hostOnly((p = {}) => {
    handleGift({
      user: { uniqueId: String(p.id || 'test_user'), nickname: p.id },
      giftDetails: { giftType: 2, diamondCount: Number(p.diamonds) || 100, giftName: 'Test Gift' },
      repeatCount: 1,
      repeatEnd: true,
    });
  }));
});

// ----------------------------- Start ----------------------------------------
server.listen(PORT, () => {
  console.log(`Game:  http://localhost:${PORT}/`);
  console.log(`Host:  http://localhost:${PORT}/host.html`);
  if (AUTO_USERNAME) connectTikTok(AUTO_USERNAME);
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
