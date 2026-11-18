/* ==========================================================================
   Olympic Run Live - Game client
   - يستقبل الحالة من الخادم عبر socket.io (20 تحديث/ثانية)
   - يرسم الحلبة والعدّائين على Canvas مع حركة ركض بالـ Frames الإجرائية
   - لا توجد أي أزرار أو عناصر تحكم على الشاشة
   ========================================================================== */
(() => {
  'use strict';

  // ---------- ثوابت التصميم ----------
  const W = 1080;
  const H = 1310;
  const LANES = 10;
  const LANE_H = H / LANES;      // 131
  const START_X = 150;
  const FIN_X = 960;
  const CHAR_SCALE = 0.78;
  const FONT = '"Segoe UI","Tajawal","Cairo",Tahoma,Arial,sans-serif';

  // ---------- 10 شخصيات أنمي أصلية (ألوان وتسريحات مختلفة) ----------
  const LOOKS = [
    { hair: '#2f6bff', eye: '#38e0ff', outfit: '#e63946', shorts: '#14213d' },
    { hair: '#ff4f81', eye: '#ffd23f', outfit: '#3a86ff', shorts: '#2b2d42' },
    { hair: '#ffb703', eye: '#2a9d8f', outfit: '#8338ec', shorts: '#1b1b2f' },
    { hair: '#2ec27e', eye: '#ff6b6b', outfit: '#ffffff', shorts: '#264653' },
    { hair: '#9b5de5', eye: '#f9e04b', outfit: '#00b4d8', shorts: '#22223b' },
    { hair: '#e63946', eye: '#a8dadc', outfit: '#ffd166', shorts: '#3d0814' },
    { hair: '#f1f1f1', eye: '#7b2cbf', outfit: '#ff7b00', shorts: '#1d1d1d' },
    { hair: '#3a2a22', eye: '#56ab2f', outfit: '#ef476f', shorts: '#0b132b' },
    { hair: '#00c2c7', eye: '#ff4d8d', outfit: '#6a994e', shorts: '#2d3142' },
    { hair: '#ff8a3d', eye: '#4361ee', outfit: '#f72585', shorts: '#10002b' },
  ];
  const BOY_STYLES = ['spiky', 'swept', 'messy'];
  const GIRL_STYLES = ['twin', 'pony', 'bob'];
  const SKIN = '#ffe3cf';
  const LINE = '#2a1e22';

  // ---------- عناصر الصفحة ----------
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('track');
  const ctx = canvas.getContext('2d');
  const elTimer = document.getElementById('timer');
  const elCount = document.getElementById('count');
  const elOverlay = document.getElementById('overlay');
  const elCard = document.getElementById('overlay-card');
  const elLbRows = document.getElementById('lb-rows');
  const elConn = document.getElementById('conn-note');

  // ---------- ملاءمة الشاشة ----------
  function fit() {
    const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- الحالة ----------
  let S = null;                      // آخر حالة من الخادم
  const views = new Map();           // id -> { pos, phase, boost }
  const floaters = [];               // نصوص عائمة
  const particles = [];              // جزيئات
  const avatars = new Map();         // url -> Image

  // ---------- Socket ----------
  const socket = io();
  socket.on('state', (st) => {
    S = st;
    onState();
  });
  socket.on('conn', (c) => {
    if (c.state === 'disconnected' || c.state === 'error' || c.state === 'connecting') {
      elConn.textContent = c.state === 'connecting' ? '… جاري الاتصال بالبث' : '⚠ إعادة الاتصال بالبث';
      elConn.classList.remove('hidden');
    } else {
      elConn.classList.add('hidden');
    }
  });
  socket.on('fx', (fx) => {
    if (!S) return;
    const r = S.racers.find((q) => q.id === fx.id);
    if (!r) return;
    const v = views.get(r.id);
    const x = runnerX(v ? v.pos : r.pos);
    const y = r.lane * LANE_H + 60;
    if (fx.type === 'gift') {
      floaters.push({ x, y, text: `🎁 +${fx.diamonds}`, life: 1.8, max: 1.8, color: '#ffd54a', size: 40 });
      burst(x, y + 30, 28, ['#ffd54a', '#ff8a3d', '#fff3b0']);
    } else if (fx.type === 'join') {
      floaters.push({ x: Math.min(x + 60, W - 120), y, text: 'JOIN ✔', life: 1.3, max: 1.3, color: '#7dffb0', size: 32 });
    }
  });

  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 260;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        life: 0.7 + Math.random() * 0.6,
        max: 1.3,
        size: 3 + Math.random() * 5,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  // ---------- أدوات ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const runnerX = (pos) => START_X + (clamp(pos, 0, S ? S.trackLen : 1000) / (S ? S.trackLen : 1000)) * (FIN_X - START_X);
  const fmtTime = (sec) => {
    sec = Math.max(0, Math.ceil(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };

  function getAvatar(url) {
    if (!url) return null;
    let img = avatars.get(url);
    if (!img) {
      img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
      avatars.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  // ======================================================================
  //  الحلبة (تُرسم مرة واحدة على Canvas خارجي ثم تُنسخ كل إطار)
  // ======================================================================
  const trackBg = document.createElement('canvas');
  trackBg.width = W;
  trackBg.height = H;
  (function buildTrack() {
    const g = trackBg.getContext('2d');
    // خلفية العشب خلف خط النهاية
    g.fillStyle = '#0d6b3b';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < LANES; i++) {
      const y = i * LANE_H;
      // أرضية المضمار
      const grad = g.createLinearGradient(0, y, 0, y + LANE_H);
      grad.addColorStop(0, i % 2 ? '#c4552f' : '#b84a28');
      grad.addColorStop(1, i % 2 ? '#b34a27' : '#a63f20');
      g.fillStyle = grad;
      g.fillRect(0, y, FIN_X + 16, LANE_H);
      // نسيج خفيف
      g.fillStyle = 'rgba(0,0,0,.05)';
      for (let x = 0; x < FIN_X; x += 24) g.fillRect(x, y + ((x / 24) % 2) * 3, 12, LANE_H);
      // رقم المسار
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.font = `900 64px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), 62, y + LANE_H / 2 + 6);
    }
    // خطوط المسارات
    g.fillStyle = '#fff';
    for (let i = 0; i <= LANES; i++) g.fillRect(0, i * LANE_H - 2, FIN_X + 16, 4);
    // علامات المسافة 25/50/75
    g.setLineDash([10, 14]);
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 3;
    [0.25, 0.5, 0.75].forEach((f) => {
      const x = START_X + f * (FIN_X - START_X);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    });
    g.setLineDash([]);
    // خط البداية
    g.fillStyle = '#fff';
    g.fillRect(START_X - 36, 0, 6, H);
    // خط النهاية (مربعات)
    const cs = LANE_H / 8;
    for (let r = 0; r < LANES * 8; r++) {
      for (let c = 0; c < 2; c++) {
        g.fillStyle = (r + c) % 2 ? '#fff' : '#111';
        g.fillRect(FIN_X + c * 16, r * cs, 16, cs);
      }
    }
    // ظل جانبي للعشب
    const sh = g.createLinearGradient(FIN_X + 16, 0, FIN_X + 70, 0);
    sh.addColorStop(0, 'rgba(0,0,0,.35)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(FIN_X + 16, 0, 60, H);
    // كلمة FINISH
    g.save();
    g.translate(1030, H / 2);
    g.rotate(Math.PI / 2);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = `900 46px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('F I N I S H', 0, 0);
    g.restore();
  })();

  // ======================================================================
  //  رسم الشخصية (أنمي Chibi) مع حركة ركض بمراحل متسلسلة
  // ======================================================================
  function seg(x0, y0, x1, y1, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // زاوية من العمودي للأسفل؛ الموجب = للأمام (+x)
  function limb(x0, y0, a1, l1, a2, l2, c1, c2, w) {
    const kx = x0 + Math.sin(a1) * l1;
    const ky = y0 + Math.cos(a1) * l1;
    const fx = kx + Math.sin(a2) * l2;
    const fy = ky + Math.cos(a2) * l2;
    seg(x0, y0, kx, ky, '#1c1418', w + 3);
    seg(kx, ky, fx, fy, '#1c1418', w + 2);
    seg(x0, y0, kx, ky, c1, w);
    seg(kx, ky, fx, fy, c2, w - 1);
    return { fx, fy };
  }

  function legPose(theta, mode) {
    if (mode === 'run') {
      const a = 0.85 * Math.sin(theta);
      const flex = 0.15 + 1.0 * (0.5 + 0.5 * Math.cos(theta));
      return [a, a - flex];
    }
    if (mode === 'win') {
      const a = 0.3 * Math.sin(theta);
      return [a, a - 0.25];
    }
    const a = 0.1 * Math.sin(theta);
    return [a, a];
  }

  function armPose(theta, mode, side) {
    if (mode === 'run') {
      const a = -0.95 * Math.sin(theta) * side;
      return [a, a + 1.4];
    }
    if (mode === 'win') {
      const a = (Math.PI - 0.55) * side;
      return [a, a + 0.15 * side];
    }
    return [0.12 * side, 0.12 * side + 0.35];
  }

  function drawShoe(x, y, color) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 2, 9, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - 1, y + 2, 11, 2.5);
  }

  function drawHand(x, y) {
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawEye(x, y, look, happy) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y, 5.6, 7.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = look.eye;
    ctx.beginPath();
    ctx.ellipse(x + 0.8, y + 0.4, 4.3, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10101a';
    ctx.beginPath();
    ctx.ellipse(x + 0.9, y + 0.8, 2.2, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 2.2, y - 2.4, 1.9, 0, Math.PI * 2);
    ctx.arc(x - 1, y + 2.6, 1, 0, Math.PI * 2);
    ctx.fill();
    // الجفن العلوي
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(x, y - 0.5, 6.2, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    if (happy) {
      // ابتسامة العينين عند الفوز
      ctx.fillStyle = SKIN;
      ctx.fillRect(x - 8, y - 1, 16, 10);
      ctx.beginPath();
      ctx.arc(x, y + 2, 5.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }

  function drawRunner(cx, footY, charIdx, gender, mode, phase, boost, t, num) {
    const look = LOOKS[charIdx % LOOKS.length];
    const style = (gender === 'girl' ? GIRL_STYLES : BOY_STYLES)[charIdx % 3];
    const run = mode === 'run';
    const win = mode === 'win';
    const wave = (k) => (run ? Math.sin(phase * 2 + k) * 6 : Math.sin(t * 2.4 + k) * 2.2);

    ctx.save();
    ctx.translate(cx, footY);
    ctx.scale(CHAR_SCALE, CHAR_SCALE);

    // ظل
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(2, 2, 27, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const bob = run ? -Math.abs(Math.sin(phase)) * 5
      : win ? -Math.abs(Math.sin(t * 9)) * 9
      : Math.sin(t * 2.2) * 1.2;
    const lean = run ? 7 + boost * 6 : 0;
    const hipX = 0;
    const hipY = -34 + bob;
    const shX = hipX + lean;
    const shY = hipY - 32;
    const headX = shX + 4;
    const headY = shY - 28;

    // ---------- الأطراف البعيدة ----------
    const farLeg = legPose(phase + Math.PI, mode);
    const nearLeg = legPose(phase, mode);
    const farArm = armPose(phase, mode, 1);        // عكس الساق القريبة
    const nearArm = armPose(phase, mode, -1);
    // اجعل الذراع القريبة تعاكس الساق القريبة
    const farArmP = run ? [0.95 * Math.sin(phase), 0.95 * Math.sin(phase) + 1.4] : armPose(phase, mode, -1);
    const nearArmP = run ? [-0.95 * Math.sin(phase), -0.95 * Math.sin(phase) + 1.4] : armPose(phase, mode, 1);
    void farArm; void nearArm;

    // ذراع بعيدة
    let h = limb(shX, shY + 4, farArmP[0], 13, farArmP[1], 13, look.outfit, SKIN, 8);
    drawHand(h.fx, h.fy);
    // ساق بعيدة
    let f = limb(hipX, hipY, farLeg[0], 16, farLeg[1], 16, look.shorts, SKIN, 10);
    drawShoe(f.fx, f.fy, look.outfit);

    // ---------- الجذع ----------
    seg(hipX, hipY, shX, shY, LINE, 28);
    seg(hipX, hipY, shX, shY, look.outfit, 24);
    ctx.fillStyle = look.shorts;
    ctx.beginPath();
    ctx.arc(hipX, hipY + 1, 13, 0, Math.PI * 2);
    ctx.fill();
    // رقم السباق
    const mx = (hipX + shX) / 2 + 2;
    const my = (hipY + shY) / 2;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(mx - 9, my - 8, 18, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `900 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), mx, my + 1);

    // ---------- الساق القريبة ----------
    f = limb(hipX, hipY, nearLeg[0], 16, nearLeg[1], 16, look.shorts, SKIN, 10);
    drawShoe(f.fx, f.fy, look.outfit);

    // ---------- الشعر الخلفي ----------
    ctx.fillStyle = look.hair;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX - 3, headY - 2, 23.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const tail = (sx, sy, ex, ey, w) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = LINE;
      ctx.lineWidth = w + 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, sy - 6, ex, ey); ctx.stroke();
      ctx.strokeStyle = look.hair;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + ex) / 2, sy - 6, ex, ey); ctx.stroke();
      ctx.fillStyle = '#ff4f81';
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
    };
    const spike = (bx, by, tx, ty, w) => {
      ctx.fillStyle = look.hair;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - w, by);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx + w, by);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    if (style === 'twin') {
      tail(headX - 14, headY - 12, headX - 46 - boost * 8, headY + 14 + wave(0), 11);
      tail(headX - 6, headY - 16, headX - 40 - boost * 8, headY + 4 + wave(1.7), 10);
    } else if (style === 'pony') {
      tail(headX - 12, headY - 18, headX - 52 - boost * 10, headY + 6 + wave(0), 14);
    } else if (style === 'bob') {
      ctx.fillStyle = look.hair;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(headX - 6, headY + 8, 25, 22 + wave(0) * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (style === 'swept') {
      spike(headX - 14, headY - 12, headX - 44 - boost * 8, headY - 22 + wave(0), 7);
      spike(headX - 16, headY - 2, headX - 46 - boost * 8, headY - 4 + wave(1), 7);
      spike(headX - 12, headY + 8, headX - 38 - boost * 8, headY + 14 + wave(2), 6);
    }

    // ---------- الرأس ----------
    ctx.fillStyle = SKIN;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(headX, headY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // أذن
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(headX - 19, headY + 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // الوجه
    drawEye(headX + 3, headY + 3, look, win);
    drawEye(headX + 15, headY + 3, look, win);
    ctx.fillStyle = 'rgba(255,90,120,.35)';
    ctx.beginPath();
    ctx.ellipse(headX + 17, headY + 11, 4.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    if (boost > 0.25 || win) {
      ctx.fillStyle = '#c1121f';
      ctx.beginPath();
      ctx.ellipse(headX + 10, headY + 14, 3.8, 4.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(headX + 10, headY + 12, 3.6, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }

    // ---------- الشعر الأمامي (الغرّة) ----------
    ctx.fillStyle = look.hair;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX, headY, 23.5, Math.PI, Math.PI * 2);
    ctx.lineTo(headX + 22, headY - 3);
    ctx.lineTo(headX + 15, headY - 11);
    ctx.lineTo(headX + 11, headY - 2);
    ctx.lineTo(headX + 3, headY - 11);
    ctx.lineTo(headX - 3, headY - 1);
    ctx.lineTo(headX - 11, headY - 10);
    ctx.lineTo(headX - 23, headY - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // لمعة الشعر
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(headX, headY, 17, Math.PI * 1.15, Math.PI * 1.55);
    ctx.stroke();

    if (style === 'spiky') {
      spike(headX - 8, headY - 20, headX - 12 + wave(0) * 0.3, headY - 40, 6);
      spike(headX + 2, headY - 22, headX + 2 + wave(1) * 0.3, headY - 46, 6);
      spike(headX + 12, headY - 19, headX + 18 + wave(2) * 0.3, headY - 38, 6);
    } else if (style === 'messy') {
      spike(headX - 12, headY - 19, headX - 20 + wave(0) * 0.4, headY - 38, 5);
      spike(headX - 3, headY - 22, headX - 4 + wave(1) * 0.4, headY - 44, 5);
      spike(headX + 6, headY - 21, headX + 10 + wave(2) * 0.4, headY - 42, 5);
      spike(headX + 14, headY - 17, headX + 22 + wave(3) * 0.4, headY - 33, 5);
    } else if (style === 'twin' || style === 'pony' || style === 'bob') {
      // أحمر شعر صغير (فيونكة)
      ctx.fillStyle = '#ff4f81';
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(headX - 2, headY - 23);
      ctx.lineTo(headX - 12, headY - 30);
      ctx.lineTo(headX - 12, headY - 18);
      ctx.closePath();
      ctx.moveTo(headX - 2, headY - 23);
      ctx.lineTo(headX + 8, headY - 30);
      ctx.lineTo(headX + 8, headY - 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // ---------- الذراع القريبة ----------
    h = limb(shX, shY + 4, nearArmP[0], 13, nearArmP[1], 13, look.outfit, SKIN, 8);
    drawHand(h.fx, h.fy);

    ctx.restore();
  }

  // ======================================================================
  //  عناصر فوق الشخصية: الأيقونة + الاسم + العلم + شريط التقدم
  // ======================================================================
  function fitText(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function drawLabel(r, x, y0, v) {
    ctx.save();
    ctx.font = `800 21px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const name = fitText(r.name, 170);
    const flag = r.flag ? `${r.flag} ` : '';
    const label = `${flag}${name}`;
    const tw = ctx.measureText(label).width;
    const w = 30 + 6 + tw;
    const lx = clamp(x - w / 2, 6, W - 6 - w);
    const cy = y0 + 15;

    // خلفية شفافة
    ctx.fillStyle = 'rgba(8,12,34,.62)';
    ctx.beginPath();
    ctx.roundRect(lx - 4, y0 + 1, w + 8, 33, 10);
    ctx.fill();

    // الأيقونة (صورة الملف الشخصي أو حرف)
    const look = LOOKS[r.charIdx % LOOKS.length];
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx + 13, cy, 12, 0, Math.PI * 2);
    ctx.clip();
    const img = getAvatar(r.avatar);
    if (img) {
      ctx.drawImage(img, lx + 1, cy - 12, 24, 24);
    } else {
      ctx.fillStyle = look.hair;
      ctx.fillRect(lx, cy - 13, 26, 26);
      ctx.fillStyle = '#fff';
      ctx.font = `900 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText((r.name[0] || '?').toUpperCase(), lx + 13, cy + 1);
    }
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lx + 13, cy, 12, 0, Math.PI * 2);
    ctx.stroke();

    // الاسم
    ctx.font = `800 21px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.strokeText(label, lx + 33, cy + 1);
    ctx.fillStyle = r.finished ? '#ffd54a' : '#fff';
    ctx.fillText(label, lx + 33, cy + 1);

    // شريط التقدم
    const p = clamp(v.pos / S.trackLen, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath();
    ctx.roundRect(lx, y0 + 29, w, 5, 3);
    ctx.fill();
    const g = ctx.createLinearGradient(lx, 0, lx + w, 0);
    g.addColorStop(0, '#00e5ff');
    g.addColorStop(1, '#7dff6a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(lx, y0 + 29, Math.max(4, w * p), 5, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawBoostFx(x, footY, boost, t) {
    if (boost < 0.04) return;
    ctx.save();
    // خطوط سرعة
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + boost * 0.5})`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const yy = footY - 20 - i * 17;
      const len = 30 + boost * 70 + ((t * 300 + i * 37) % 30);
      ctx.beginPath();
      ctx.moveTo(x - 34, yy);
      ctx.lineTo(x - 34 - len, yy);
      ctx.stroke();
    }
    // لهب
    for (let i = 0; i < 6; i++) {
      const k = i / 6;
      ctx.globalAlpha = boost * (1 - k) * 0.85;
      ctx.fillStyle = i < 2 ? '#fff3b0' : i < 4 ? '#ffb703' : '#ff4d00';
      const rr = (13 - i * 1.6) * (0.8 + boost * 0.7);
      ctx.beginPath();
      ctx.arc(x - 34 - i * 13, footY - 38 + Math.sin(t * 25 + i) * 4, Math.max(2, rr), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ======================================================================
  //  حلقة الرسم
  // ======================================================================
  let last = performance.now();

  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    const t = ts / 1000;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(trackBg, 0, 0);

    if (S) {
      const racers = S.racers.slice().sort((a, b) => a.lane - b.lane);
      const alive = new Set();

      for (const r of racers) {
        alive.add(r.id);
        let v = views.get(r.id);
        if (!v) { v = { pos: r.pos, phase: Math.random() * 6, boost: 0 }; views.set(r.id, v); }
        v.pos += (r.pos - v.pos) * Math.min(1, dt * 9);
        v.boost += (r.boost - v.boost) * Math.min(1, dt * 6);

        const running = S.phase === 'running' && !r.finished;
        const mode = running ? 'run' : (r.finished || (S.phase === 'finished' && r.rank === 1)) ? 'win' : 'idle';
        if (running) v.phase += dt * (11 + v.boost * 9);

        const y0 = r.lane * LANE_H;
        const footY = y0 + LANE_H - 9;
        const x = runnerX(v.pos);

        if (running) drawBoostFx(x, footY, v.boost, t);
        drawRunner(x, footY, r.charIdx, r.gender, mode, v.phase, running ? v.boost : 0, t, r.lane + 1);
        drawLabel(r, x, y0, v);
      }
      for (const id of [...views.keys()]) if (!alive.has(id)) views.delete(id);
    }

    // الجزيئات
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = clamp(p.life / p.max * 1.6, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // النصوص العائمة
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      f.y -= 46 * dt;
      const k = f.life / f.max;
      ctx.globalAlpha = clamp(k * 2, 0, 1);
      ctx.font = `900 ${f.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ======================================================================
  //  HUD / لوحة الصدارة / الطبقة الوسطى (DOM)
  // ======================================================================
  const lbRows = new Map();
  let overlayKey = '';

  function onState() {
    updateHud();
    updateLeaderboard();
    updateOverlay();
  }

  function updateHud() {
    elCount.textContent = `👥 ${S.racers.length}/${S.maxRacers}`;
    let txt;
    if (S.phase === 'running') {
      txt = S.timeLeft == null ? '🏁 حتى خط النهاية' : `⏱ ${fmtTime(S.timeLeft)}`;
    } else if (S.phase === 'countdown') {
      txt = '🚦 استعدوا';
    } else if (S.phase === 'finished') {
      txt = '🏆 انتهى السباق';
    } else {
      txt = S.duration > 0 ? `⏱ ${fmtTime(S.duration)}` : '🏁 وقت مفتوح';
    }
    elTimer.textContent = txt;
    elTimer.classList.toggle('low', S.phase === 'running' && S.timeLeft != null && S.timeLeft <= 10);
  }

  function updateLeaderboard() {
    const sorted = S.racers.slice().sort((a, b) => a.rank - b.rank);
    const seen = new Set();
    for (const r of sorted) {
      seen.add(r.id);
      let el = lbRows.get(r.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'lb-row';
        el.innerHTML = '<div class="rank"></div><div class="ava"></div><div class="nm"></div><div class="pct"></div>';
        el.querySelector('.nm').textContent = r.name;
        if (r.avatar) el.querySelector('.ava').style.backgroundImage = `url("${r.avatar.replace(/"/g, '%22')}")`;
        const slot0 = r.rank - 1;
        el.style.transform = `translate(${slot0 < 5 ? 0 : 510}px, ${(slot0 % 5) * 62}px)`;
        elLbRows.appendChild(el);
        lbRows.set(r.id, el);
      }
      const slot = r.rank - 1;
      el.style.transform = `translate(${slot < 5 ? 0 : 510}px, ${(slot % 5) * 62}px)`;
      const cls = 'lb-row' + (r.rank <= 3 ? ` r${r.rank}` : '');
      if (el.className.replace(' flash', '') !== cls) el.className = cls;
      el.querySelector('.rank').textContent = r.rank;
      const pct = S.phase === 'waiting' || S.phase === 'countdown'
        ? `♥ ${r.likes}`
        : r.finished ? '🏁' : `${Math.floor((r.pos / S.trackLen) * 100)}%`;
      el.querySelector('.pct').textContent = pct;
    }
    for (const [id, el] of lbRows) {
      if (!seen.has(id)) { el.remove(); lbRows.delete(id); }
    }
  }

  function updateOverlay() {
    let key = S.phase;
    if (S.phase === 'waiting') key += `|${S.racers.length}|${S.duration}`;
    if (S.phase === 'countdown') key += `|${S.countdown}`;
    if (S.phase === 'finished') key += '|' + S.racers.filter((r) => r.rank <= 3).map((r) => r.id + r.rank).join(',');

    if (S.phase === 'running') {
      elOverlay.classList.add('hidden');
      overlayKey = key;
      return;
    }

    if (key !== overlayKey) {
      overlayKey = key;
      let html = '';
      if (S.phase === 'waiting') {
        const left = S.maxRacers - S.racers.length;
        const dur = S.duration > 0 ? `مدة السباق ${fmtTime(S.duration)}` : 'السباق مفتوح حتى خط النهاية';
        html = `<h2>ضع إعجاب <span class="heart">❤</span> للانضمام!</h2>
                <p>${S.racers.length === 0 ? 'كن أول المنضمين للسباق' : `المتبقي ${left} ${left === 1 ? 'مقعد' : 'مقاعد'}`}</p>
                <p>${dur}</p>
                <p>🎁 الهدايا تمنح سرعة خارقة 🚀</p>`;
      } else if (S.phase === 'countdown') {
        html = `<h2>🚦 استعدوا!</h2><div class="big">${S.countdown || 'GO'}</div>`;
      } else if (S.phase === 'finished') {
        const top = S.racers.filter((r) => r.rank <= 3).sort((a, b) => a.rank - b.rank);
        const medals = ['🥇', '🥈', '🥉'];
        const order = [top[1], top[0], top[2]].filter(Boolean);
        html = `<h2>🏆 الفائز: <span style="color:#ffd54a;direction:ltr;display:inline-block">${esc(top[0] ? top[0].name : '-')}</span></h2>
                <div class="podium">${order.map((r) => `
                  <div class="step p${r.rank}">
                    <div class="medal">${medals[r.rank - 1]}</div>
                    <div class="who">${esc(r.name)}</div>
                    <div class="sub">♥ ${r.likes} · 💎 ${r.diamonds}</div>
                  </div>`).join('')}</div>
                <p id="reset-in"></p>`;
      }
      elCard.innerHTML = html;
      // إعادة تشغيل حركة الظهور
      elCard.style.animation = 'none';
      void elCard.offsetWidth;
      elCard.style.animation = '';
    }

    if (S.phase === 'finished') {
      const el = document.getElementById('reset-in');
      if (el) el.textContent = S.resetIn != null ? `جولة جديدة بعد ${S.resetIn} ث` : 'بانتظار المضيف لبدء جولة جديدة';
    }
    elOverlay.classList.remove('hidden');
  }
})();
