/* ============================================================
   NEON PONG — GAME.JS
   Phân chia theo module:
   1.  Audio Engine  (Web Audio API - không cần file ngoài)
   2.  Intro Screen
   3.  Data / Skin definitions
   4.  Storage (LocalStorage)
   5.  Auth (Login / Register / Logout)
   6.  Main screen & header
   7.  Game Engine (physics, AI, loop)
   8.  Renderer (canvas draw)
   9.  Shop
   10. Stats & Leaderboard
   11. Toast notifications
   12. Panel switching
   13. Boot / Init
============================================================ */


/* ════════════════════════════════════════════════════════════
   1. AUDIO ENGINE
   Toàn bộ âm thanh được tổng hợp bằng Web Audio API.
   Không cần tải file mp3/wav bên ngoài.
════════════════════════════════════════════════════════════ */

let audioCtx = null;
let musicMuted = false;
let menuMusicNodes = null;
let gameMusicNodes = null;
let activeMusic = null;

/** Khởi tạo AudioContext (phải do user gesture kích hoạt) */
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

/** Tạo oscillator đơn giản */
function makeOsc(type, freq, gainVal, dest) {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type      = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
  osc.connect(gain);
  gain.connect(dest || audioCtx.destination);
  return { osc, gain };
}

/* ── Âm thanh hiệu ứng ── */

/** Bóng nảy tường */
function sfxWall() {
  if (!audioCtx || musicMuted) return;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.18, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
  g.connect(audioCtx.destination);
  const o = audioCtx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(320, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.1);
  o.connect(g); o.start(); o.stop(audioCtx.currentTime + 0.1);
}

/** Bóng chạm thanh đỡ */
function sfxPaddle() {
  if (!audioCtx || musicMuted) return;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.22, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  g.connect(audioCtx.destination);
  const o = audioCtx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(440, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.15);
  o.connect(g); o.start(); o.stop(audioCtx.currentTime + 0.15);
}

/** Ghi điểm */
function sfxScore() {
  if (!audioCtx || musicMuted) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const t  = audioCtx.currentTime + i * 0.1;
    const g  = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    g.connect(audioCtx.destination);
    const o  = audioCtx.createOscillator();
    o.type   = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + 0.12);
  });
}

/** Thắng trận */
function sfxWin() {
  if (!audioCtx || musicMuted) return;
  const melody = [523,659,784,523,659,784,1047];
  melody.forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.13;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    g.connect(audioCtx.destination);
    const o = audioCtx.createOscillator();
    o.type  = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + 0.2);
  });
}

/** Thua trận */
function sfxLose() {
  if (!audioCtx || musicMuted) return;
  const notes = [400, 320, 240, 180];
  notes.forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.15;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    g.connect(audioCtx.destination);
    const o = audioCtx.createOscillator();
    o.type  = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + 0.18);
  });
}

/** Mua thành công */
function sfxBuy() {
  if (!audioCtx || musicMuted) return;
  [660, 880].forEach((freq, i) => {
    const t = audioCtx.currentTime + i * 0.1;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    g.connect(audioCtx.destination);
    const o = audioCtx.createOscillator();
    o.type  = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + 0.12);
  });
}

/* ── Nhạc nền dạng arpeggio lặp ── */

/**
 * Tạo nhạc nền kiểu chiptune arpeggio
 * @param {number[]} scale   - mảng tần số hợp âm
 * @param {number}   bpm     - nhịp độ
 * @param {number}   vol     - âm lượng master
 * @param {string}   oscType - loại sóng
 */
function createArpeggioMusic(scale, bpm, vol, oscType = 'square') {
  if (!audioCtx) return null;

  const masterGain = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();
  masterGain.gain.setValueAtTime(vol, audioCtx.currentTime);
  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);

  // Reverb nhẹ
  const convolver = audioCtx.createConvolver();
  const reverbLen = audioCtx.sampleRate * 1.2;
  const reverbBuf = audioCtx.createBuffer(2, reverbLen, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = reverbBuf.getChannelData(ch);
    for (let i = 0; i < reverbLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLen, 2);
  }
  convolver.buffer = reverbBuf;
  const reverbGain = audioCtx.createGain();
  reverbGain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  convolver.connect(reverbGain);
  reverbGain.connect(masterGain);

  const stepSec  = 60 / bpm / 2;
  let   stepIdx  = 0;
  let   stopped  = false;

  // Bass line
  const bassOsc  = audioCtx.createOscillator();
  const bassGain = audioCtx.createGain();
  bassOsc.type   = 'sine';
  bassOsc.frequency.setValueAtTime(scale[0] / 2, audioCtx.currentTime);
  bassGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
  bassOsc.connect(bassGain);
  bassGain.connect(masterGain);
  bassOsc.start();

  // Arpeggio scheduler
  function scheduleStep() {
    if (stopped) return;
    const t    = audioCtx.currentTime;
    const note = scale[stepIdx % scale.length];
    const o    = audioCtx.createOscillator();
    const g    = audioCtx.createGain();
    o.type     = oscType;
    o.frequency.setValueAtTime(note, t);
    o.frequency.setValueAtTime(note * 1.005, t + stepSec * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.01);
    g.gain.setValueAtTime(0.18, t + stepSec * 0.55);
    g.gain.linearRampToValueAtTime(0, t + stepSec * 0.85);
    o.connect(g);
    g.connect(masterGain);
    g.connect(convolver);
    o.start(t);
    o.stop(t + stepSec);

    // Bass root thay đổi mỗi 8 bước
    if (stepIdx % 8 === 0) {
      const root = scale[Math.floor(stepIdx / 8) % scale.length];
      bassOsc.frequency.setValueAtTime(root / 2, t);
    }

    stepIdx++;
    setTimeout(scheduleStep, stepSec * 800);
  }

  scheduleStep();

  return {
    stop() {
      stopped = true;
      masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
      setTimeout(() => {
        try { bassOsc.stop(); } catch(e) {}
        try { masterGain.disconnect(); } catch(e) {}
      }, 600);
    },
    setVolume(v) { masterGain.gain.setValueAtTime(v, audioCtx.currentTime); }
  };
}

// Định nghĩa các bộ âm thanh
const SCALES = {
  menu: [392, 440, 523, 587, 659, 784, 880, 1047],   // G maj arpeggio, nhanh vui
  game: [220, 277, 330, 370, 440, 554, 659, 740],     // A min arpeggio, căng thẳng
};

function startMenuMusic() {
  if (musicMuted || !audioCtx) return;
  stopAllMusic();
  menuMusicNodes = createArpeggioMusic(SCALES.menu, 200, 0.18, 'triangle');
  activeMusic = 'menu';
}

function startGameMusic() {
  if (musicMuted || !audioCtx) return;
  stopAllMusic();
  gameMusicNodes = createArpeggioMusic(SCALES.game, 240, 0.14, 'square');
  activeMusic = 'game';
}

function stopAllMusic() {
  if (menuMusicNodes) { menuMusicNodes.stop(); menuMusicNodes = null; }
  if (gameMusicNodes) { gameMusicNodes.stop(); gameMusicNodes = null; }
  activeMusic = null;
}

function toggleMusic() {
  initAudio();
  musicMuted = !musicMuted;
  const btn  = document.getElementById('music-btn');
  const icon = document.getElementById('music-icon');
  if (musicMuted) {
    stopAllMusic();
    btn.classList.add('muted');
    icon.textContent = '♪';
    btn.title = 'Bật nhạc';
  } else {
    btn.classList.remove('muted');
    icon.textContent = '♫';
    btn.title = 'Tắt nhạc';
    // Khôi phục nhạc phù hợp ngữ cảnh
    if (gameRunning) startGameMusic();
    else startMenuMusic();
  }
}


/* ════════════════════════════════════════════════════════════
   2. INTRO SCREEN
════════════════════════════════════════════════════════════ */

let introReady = false;  // true khi loading bar hoàn thành

function bootIntro() {
  // Tạo particles
  const container = document.getElementById('intro-particles');
  const colors = ['#00f5ff', '#ff006e', '#ffbe0b', '#06d6a0', '#8338ec'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      bottom:${Math.random() * 30}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      box-shadow: 0 0 6px currentColor;
      animation-duration:${3 + Math.random() * 5}s;
      animation-delay:${Math.random() * 4}s;
    `;
    container.appendChild(p);
  }

  // Xuất hiện logo ký tự từng cái
  const letters = document.querySelectorAll('#intro-logo span');
  letters.forEach((el, i) => {
    setTimeout(() => el.classList.add('visible'), 200 + i * 80);
  });

  // Tagline
  setTimeout(() => {
    document.getElementById('intro-tagline').classList.add('visible');
  }, 900);

  // Demo canvas
  setTimeout(() => {
    document.querySelector('.intro-demo').classList.add('visible');
    startDemoAnimation();
  }, 1100);

  // Loading bar giả
  const fill    = document.getElementById('intro-loadbar-fill');
  const loadTxt = document.getElementById('intro-loadtext');
  const steps   = [
    [0,   0,    'ĐANG KHỞI ĐỘNG...'],
    [300, 22,   'NẠP ĐỒ HỌA...'],
    [600, 45,   'KHỞI TẠO ÂM THANH...'],
    [950, 68,   'KẾT NỐI SERVER...'],
    [1250,88,   'SẴN SÀNG!'],
    [1500,100,  'NHẤN ĐỂ BẮT ĐẦU'],
  ];

  steps.forEach(([delay, pct, txt]) => {
    setTimeout(() => {
      fill.style.width = pct + '%';
      loadTxt.textContent = txt;
      if (pct === 100) {
        introReady = true;
        document.getElementById('intro-press').classList.add('visible');
        document.getElementById('intro-loadbar-wrap').style.opacity = '0.4';
      }
    }, delay);
  });

  // Lắng nghe user gesture để vào game
  const onAnyKey = (e) => {
    if (!introReady) return;
    e.preventDefault();
    leaveIntro();
    window.removeEventListener('keydown', onAnyKey);
    window.removeEventListener('click',   onAnyKey);
    window.removeEventListener('touchstart', onAnyKey);
  };
  // Chờ tối thiểu 1.8s rồi mới listen
  setTimeout(() => {
    window.addEventListener('keydown',   onAnyKey);
    window.addEventListener('click',     onAnyKey);
    window.addEventListener('touchstart',onAnyKey);
  }, 1800);
}

function leaveIntro() {
  initAudio();
  const intro = document.getElementById('intro-screen');
  intro.classList.add('fade-out');

  // Kiểm tra session
  loadDB();
  const sess = getSession();
  const target = (sess && db[sess]) ? 'main' : 'auth';

  setTimeout(() => {
    intro.classList.add('hidden');
    stopDemoAnimation();
    if (target === 'main') {
      currentUser = sess; isGuest = false;
      enterMainScreen();
    } else {
      document.getElementById('auth-screen').classList.remove('hidden');
      startMenuMusic();
    }
  }, 800);
}

/* ── Demo animation (mini pong tự chơi) ── */
let demoRAF = null;

function startDemoAnimation() {
  const c   = document.getElementById('demoCanvas');
  const ctx = c.getContext('2d');
  const W = 340, H = 190;
  const PW = 8, PH = 50, BR = 6;
  let bx = W/2, by = H/2;
  let vx = 3.2, vy = 2.4;
  let ly = H/2, ry = H/2;

  function demoLoop() {
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    // Đường giữa
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Thanh đỡ trái (AI đơn giản)
    ly += (by - PH/2 - ly) * 0.12;
    ly = Math.max(0, Math.min(H - PH, ly));

    // Thanh đỡ phải (AI đơn giản)
    ry += (by - PH/2 - ry) * 0.10;
    ry = Math.max(0, Math.min(H - PH, ry));

    // Vẽ thanh đỡ
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#00f5ff';
    ctx.fillStyle = '#00f5ff';
    ctx.beginPath(); ctx.roundRect(10, ly, PW, PH, 3); ctx.fill();
    ctx.shadowColor = '#ff006e';
    ctx.fillStyle = '#ff006e';
    ctx.beginPath(); ctx.roundRect(W - 10 - PW, ry, PW, PH, 3); ctx.fill();
    ctx.shadowBlur = 0;

    // Di chuyển bóng
    bx += vx; by += vy;
    if (by - BR <= 0) { by = BR; vy *= -1; }
    if (by + BR >= H) { by = H - BR; vy *= -1; }

    // Va chạm thanh trái
    if (vx < 0 && bx - BR <= 10 + PW && by >= ly && by <= ly + PH) {
      bx = 10 + PW + BR;
      vx = Math.abs(vx) * 1.02;
      const rel = (by - (ly + PH/2)) / (PH/2);
      vy = rel * 3.5;
    }
    // Va chạm thanh phải
    if (vx > 0 && bx + BR >= W - 10 - PW && by >= ry && by <= ry + PH) {
      bx = W - 10 - PW - BR;
      vx = -Math.abs(vx) * 1.02;
      const rel = (by - (ry + PH/2)) / (PH/2);
      vy = rel * 3.5;
    }
    // Reset nếu ra biên
    if (bx < 0 || bx > W) { bx = W/2; by = H/2; vx = (Math.random()>0.5?1:-1)*3.2; vy = (Math.random()*2-1)*3; }

    // Vẽ bóng
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ffbe0b';
    ctx.fillStyle = '#ffbe0b';
    ctx.beginPath(); ctx.arc(bx, by, BR, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    demoRAF = requestAnimationFrame(demoLoop);
  }
  demoLoop();
}

function stopDemoAnimation() {
  if (demoRAF) { cancelAnimationFrame(demoRAF); demoRAF = null; }
}


/* ════════════════════════════════════════════════════════════
   3. DATA — SKIN & ITEM DEFINITIONS
════════════════════════════════════════════════════════════ */

const BALL_SVG = {
  default: `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg0" cx="38%" cy="32%"><stop offset="0%" stop-color="#ffffff"/><stop offset="60%" stop-color="#c8d8e8"/><stop offset="100%" stop-color="#7090a0"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg0)"/><ellipse cx="21" cy="20" rx="7" ry="4" fill="rgba(255,255,255,0.55)" transform="rotate(-30,21,20)"/></svg>`,
  fire:    `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg1" cx="50%" cy="60%"><stop offset="0%" stop-color="#ffee44"/><stop offset="40%" stop-color="#ff6600"/><stop offset="100%" stop-color="#aa1100"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg1)"/><path d="M28 10 Q32 18 28 22 Q24 18 28 10Z" fill="#fff176" opacity=".7"/><path d="M22 15 Q26 22 24 27 Q20 22 22 15Z" fill="#ffcc44" opacity=".5"/><ellipse cx="22" cy="23" rx="4" ry="3" fill="rgba(255,255,100,0.35)" transform="rotate(-20,22,23)"/></svg>`,
  neon:    `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg2" cx="40%" cy="35%"><stop offset="0%" stop-color="#afffff"/><stop offset="50%" stop-color="#00e5ff"/><stop offset="100%" stop-color="#005577"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg2)"/><circle cx="28" cy="28" r="22" fill="none" stroke="#00ffff" stroke-width="2" opacity=".5"/><circle cx="28" cy="28" r="16" fill="none" stroke="#00ffff" stroke-width="1" opacity=".3"/><ellipse cx="20" cy="19" rx="6" ry="3.5" fill="rgba(255,255,255,0.6)" transform="rotate(-35,20,19)"/></svg>`,
  plasma:  `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg3" cx="45%" cy="35%"><stop offset="0%" stop-color="#e0aaff"/><stop offset="45%" stop-color="#8338ec"/><stop offset="100%" stop-color="#2d006e"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg3)"/><path d="M28 8 L30 26 L48 28 L30 30 L28 48 L26 30 L8 28 L26 26Z" fill="rgba(255,200,255,0.18)"/><ellipse cx="20" cy="20" rx="5" ry="3" fill="rgba(255,255,255,0.45)" transform="rotate(-40,20,20)"/></svg>`,
  star:    `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg4" cx="40%" cy="35%"><stop offset="0%" stop-color="#fff9c4"/><stop offset="50%" stop-color="#ffbe0b"/><stop offset="100%" stop-color="#e65c00"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg4)"/><path d="M28 12 L30.5 22.5 L41 22.5 L32.8 28.8 L35.5 39.5 L28 33.5 L20.5 39.5 L23.2 28.8 L15 22.5 L25.5 22.5Z" fill="rgba(255,255,255,0.5)"/><ellipse cx="21" cy="20" rx="5" ry="3" fill="rgba(255,255,255,0.55)" transform="rotate(-30,21,20)"/></svg>`,
  void:    `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="bg5" cx="40%" cy="35%"><stop offset="0%" stop-color="#3a005a"/><stop offset="50%" stop-color="#0d0020"/><stop offset="100%" stop-color="#000000"/></radialGradient></defs><circle cx="28" cy="28" r="22" fill="url(#bg5)"/><circle cx="28" cy="28" r="16" fill="none" stroke="#6600aa" stroke-width="1.5" opacity=".6"/><circle cx="28" cy="28" r="8" fill="none" stroke="#4400aa" stroke-width="1" opacity=".4"/><ellipse cx="20" cy="20" rx="4" ry="2.5" fill="rgba(180,100,255,0.2)" transform="rotate(-35,20,20)"/></svg>`,
};

const BALL_SKINS = [
  { id:'default', name:'Bóng Trắng',  desc:'Bóng cổ điển',           price:0,   color:'#e6edf3', glow:'rgba(230,237,243,0.6)' },
  { id:'fire',    name:'Bóng Lửa',    desc:'Rực cháy trên sân',       price:100, color:'#ff4e00', glow:'rgba(255,78,0,0.8)'    },
  { id:'neon',    name:'Bóng Neon',   desc:'Siêu sáng cyan',          price:150, color:'#00f5ff', glow:'rgba(0,245,255,0.9)'   },
  { id:'plasma',  name:'Bóng Plasma', desc:'Năng lượng thuần khiết',  price:250, color:'#8338ec', glow:'rgba(131,56,236,0.9)'  },
  { id:'star',    name:'Sao Băng',    desc:'Nhanh như sao băng',      price:300, color:'#ffbe0b', glow:'rgba(255,190,11,0.9)'  },
  { id:'void',    name:'Hố Đen',      desc:'Hấp thụ mọi ánh sáng',   price:500, color:'#1a0030', glow:'rgba(131,56,236,0.3)'  },
];

const PADDLE_SVG = {
  default: `<svg width="24" height="64" viewBox="0 0 24 64"><defs><linearGradient id="pg0" x1="0" x2="1"><stop offset="0%" stop-color="#e6edf3"/><stop offset="100%" stop-color="#8090a0"/></linearGradient></defs><rect x="2" y="2" width="20" height="60" rx="4" fill="url(#pg0)"/><rect x="5" y="10" width="4" height="44" rx="2" fill="rgba(255,255,255,0.3)"/></svg>`,
  cyan:    `<svg width="24" height="64" viewBox="0 0 24 64"><defs><linearGradient id="pg1" x1="0" x2="1"><stop offset="0%" stop-color="#00ffff"/><stop offset="100%" stop-color="#006688"/></linearGradient></defs><rect x="2" y="2" width="20" height="60" rx="4" fill="url(#pg1)"/><rect x="5" y="8" width="3" height="48" rx="2" fill="rgba(255,255,255,0.35)"/><rect x="2" y="2" width="20" height="60" rx="4" fill="none" stroke="#00f5ff" stroke-width="1.5" opacity=".6"/></svg>`,
  hot:     `<svg width="24" height="64" viewBox="0 0 24 64"><defs><linearGradient id="pg2" x1="0" x2="1"><stop offset="0%" stop-color="#ff006e"/><stop offset="100%" stop-color="#880033"/></linearGradient></defs><rect x="2" y="2" width="20" height="60" rx="4" fill="url(#pg2)"/><rect x="5" y="8" width="3" height="48" rx="2" fill="rgba(255,200,200,0.3)"/><rect x="2" y="2" width="20" height="60" rx="4" fill="none" stroke="#ff006e" stroke-width="1.5" opacity=".5"/></svg>`,
  gold:    `<svg width="24" height="64" viewBox="0 0 24 64"><defs><linearGradient id="pg3" x1="0" x2="1"><stop offset="0%" stop-color="#ffe566"/><stop offset="50%" stop-color="#ffbe0b"/><stop offset="100%" stop-color="#996600"/></linearGradient></defs><rect x="2" y="2" width="20" height="60" rx="4" fill="url(#pg3)"/><rect x="5" y="8" width="3" height="48" rx="2" fill="rgba(255,255,200,0.4)"/><line x1="12" y1="4" x2="12" y2="60" stroke="rgba(255,240,100,0.25)" stroke-width="1"/></svg>`,
  matrix:  `<svg width="24" height="64" viewBox="0 0 24 64"><defs><linearGradient id="pg4" x1="0" x2="1"><stop offset="0%" stop-color="#06d6a0"/><stop offset="100%" stop-color="#025940"/></linearGradient></defs><rect x="2" y="2" width="20" height="60" rx="4" fill="url(#pg4)"/><rect x="5" y="8" width="3" height="48" rx="2" fill="rgba(200,255,230,0.35)"/><rect x="2" y="2" width="20" height="60" rx="4" fill="none" stroke="#06d6a0" stroke-width="1.5" opacity=".5"/></svg>`,
};

const PADDLE_SKINS = [
  { id:'default', name:'Thanh Trắng',    desc:'Cổ điển',         price:0,   color:'#e6edf3', glow:'rgba(230,237,243,0.4)' },
  { id:'cyan',    name:'Thanh Cyan',     desc:'Neon xanh lạnh',  price:80,  color:'#00f5ff', glow:'rgba(0,245,255,0.6)'   },
  { id:'hot',     name:'Thanh Lửa',      desc:'Nóng bỏng tay',   price:120, color:'#ff006e', glow:'rgba(255,0,110,0.7)'   },
  { id:'gold',    name:'Thanh Vàng',     desc:'Sang trọng',      price:200, color:'#ffbe0b', glow:'rgba(255,190,11,0.7)'  },
  { id:'matrix',  name:'Thanh Ma Trận',  desc:'Xanh lá hacker',  price:180, color:'#06d6a0', glow:'rgba(6,214,160,0.7)'   },
];

const POWER_SVG = {
  big_paddle: `<svg width="56" height="56" viewBox="0 0 56 56"><rect x="8" y="12" width="40" height="32" rx="6" fill="#334"/><rect x="14" y="18" width="28" height="20" rx="4" fill="#556"/><rect x="18" y="20" width="20" height="16" rx="3" fill="#667" stroke="#8090b0" stroke-width="1"/><rect x="22" y="23" width="4" height="10" rx="2" fill="#00ccff" opacity=".8"/><rect x="30" y="23" width="4" height="10" rx="2" fill="#00ccff" opacity=".8"/><path d="M28 8 L32 14 L28 12 L24 14Z" fill="#00ccff"/></svg>`,
  slow_ball:  `<svg width="56" height="56" viewBox="0 0 56 56"><defs><radialGradient id="sg1" cx="45%" cy="40%"><stop offset="0%" stop-color="#aaffee"/><stop offset="100%" stop-color="#0088aa"/></radialGradient></defs><circle cx="28" cy="28" r="18" fill="url(#sg1)" opacity=".9"/><path d="M20 22 Q28 16 36 22 Q44 28 36 34 Q28 40 20 34 Q12 28 20 22Z" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/><circle cx="22" cy="22" r="3" fill="rgba(255,255,255,0.6)"/><path d="M36 20 L40 16 M38 28 L44 28 M36 36 L40 40" stroke="#00ddff" stroke-width="1.5" stroke-linecap="round" opacity=".5"/></svg>`,
  fast_serve: `<svg width="56" height="56" viewBox="0 0 56 56"><defs><linearGradient id="fg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffee00"/><stop offset="100%" stop-color="#ff6600"/></linearGradient></defs><polygon points="30,8 18,30 26,30 22,50 40,26 30,26" fill="url(#fg1)"/><polygon points="30,8 18,30 26,30 22,50 40,26 30,26" fill="none" stroke="rgba(255,255,200,0.5)" stroke-width="1.5"/></svg>`,
};

const POWER_ITEMS = [
  { id:'big_paddle', name:'Thanh To',    desc:'Thanh đỡ +50% trong 8 giây',           price:50, duration:8000 },
  { id:'slow_ball',  name:'Bóng Chậm',   desc:'Giảm tốc bóng trong 5 giây',           price:60, duration:5000 },
  { id:'fast_serve', name:'Giao Nhanh',  desc:'Tốc độ giao bóng tăng gấp đôi ngay',   price:40, duration:0    },
];


/* ════════════════════════════════════════════════════════════
   4. STORAGE
════════════════════════════════════════════════════════════ */

const DB_KEY      = 'neonpong_db';
const SESSION_KEY = 'neonpong_session';

let db = {};

function loadDB() {
  try { db = JSON.parse(localStorage.getItem(DB_KEY)) || {}; }
  catch(e) { db = {}; }
}

function saveDB() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function getUser(u)    { return db[u] || null; }

function createUser(u, p) {
  db[u] = {
    username:u, password:btoa(p), coins:100,
    wins:0, losses:0, ballsHit:0, highStreak:0, gamesPlayed:0,
    ownedBalls:['default'], ownedPaddles:['default'], powers:{},
    equippedBall:'default', equippedPaddle:'default',
    lastDaily:0, dailyStreak:0, createdAt:Date.now()
  };
  saveDB();
}

function saveSession(u) { localStorage.setItem(SESSION_KEY, u); }
function getSession()   { return localStorage.getItem(SESSION_KEY); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }


/* ════════════════════════════════════════════════════════════
   5. AUTH
════════════════════════════════════════════════════════════ */

let currentUser = null;
let isGuest     = false;

function switchAuthTab(t) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i===0 && t==='login') || (i===1 && t==='register'));
  });
  document.getElementById('login-form').style.display    = t==='login'    ? 'block' : 'none';
  document.getElementById('register-form').style.display = t==='register' ? 'block' : 'none';
  document.getElementById('auth-msg').textContent = '';
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className   = 'auth-msg ' + (type || 'error');
}

function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  if (!u || !p) { showAuthMsg('Vui lòng điền đầy đủ thông tin'); return; }
  loadDB();
  const usr = getUser(u);
  if (!usr || usr.password !== btoa(p)) { showAuthMsg('Sai tên đăng nhập hoặc mật khẩu'); return; }
  currentUser = u; isGuest = false;
  saveSession(u);
  enterMainScreen();
}

function doRegister() {
  const u  = document.getElementById('reg-user').value.trim();
  const p  = document.getElementById('reg-pass').value;
  const p2 = document.getElementById('reg-pass2').value;
  if (!u || !p || !p2) { showAuthMsg('Vui lòng điền đầy đủ thông tin'); return; }
  if (u.length < 3)    { showAuthMsg('Tên đăng nhập phải có ít nhất 3 ký tự'); return; }
  if (p.length < 4)    { showAuthMsg('Mật khẩu phải có ít nhất 4 ký tự'); return; }
  if (p !== p2)        { showAuthMsg('Mật khẩu không khớp'); return; }
  loadDB();
  if (getUser(u))      { showAuthMsg('Tên đăng nhập đã tồn tại'); return; }
  createUser(u, p);
  showAuthMsg('Tạo tài khoản thành công! Đang đăng nhập...', 'success');
  setTimeout(() => {
    currentUser = u; isGuest = false;
    saveSession(u);
    enterMainScreen();
  }, 800);
}

function playAsGuest() {
  currentUser = 'KHÁCH'; isGuest = true;
  enterMainScreen();
}

function doLogout() {
  stopGame(); stopAllMusic();
  currentUser = null; isGuest = false;
  clearSession();
  document.getElementById('main-screen').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('auth-msg').textContent = '';
  startMenuMusic();
}


/* ════════════════════════════════════════════════════════════
   6. MAIN SCREEN & HEADER
════════════════════════════════════════════════════════════ */

let equippedBall   = 'default';
let equippedPaddle = 'default';
let powers         = {};

function enterMainScreen() {
  syncUserData();
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  updateHeader();
  renderShop();
  renderStats();
  renderPowerBar();
  checkDailyReward();
  resetGame();
  switchPanel('game');
  // Đổi sang nhạc menu
  if (activeMusic !== 'menu') startMenuMusic();
}

function syncUserData() {
  if (isGuest) { equippedBall='default'; equippedPaddle='default'; powers={}; return; }
  const u      = db[currentUser];
  equippedBall   = u.equippedBall   || 'default';
  equippedPaddle = u.equippedPaddle || 'default';
  powers         = u.powers         || {};
}

function updateHeader() {
  document.getElementById('hdr-user').textContent  = currentUser;
  const coins = isGuest ? 0 : (db[currentUser]?.coins || 0);
  document.getElementById('hdr-coins').textContent = coins;
}

function addCoins(n) {
  if (isGuest) { showToast('+' + n + ' XU (không lưu ở chế độ khách)', 'info'); return; }
  db[currentUser].coins = (db[currentUser].coins || 0) + n;
  saveDB(); updateHeader();
}

function spendCoins(n) {
  if (isGuest) { showToast('Đăng nhập để mua vật phẩm', 'error'); return false; }
  if ((db[currentUser].coins || 0) < n) { showToast('Không đủ xu!', 'error'); return false; }
  db[currentUser].coins -= n;
  saveDB(); updateHeader();
  return true;
}


/* ════════════════════════════════════════════════════════════
   7. GAME ENGINE
════════════════════════════════════════════════════════════ */

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// Kích thước sân
const CW = 800, CH = 500;
// Kích thước thanh / bóng
const PAD_W = 12, PAD_H = 90, BALL_R = 8;
const PAD_SPEED      = 6;
const BALL_START_SPD = 5;
const MAX_SPEED      = 14;
const WIN_SCORE      = 5;

// State game
let gameMode    = 'ai';
let difficulty  = 2;
let gameRunning = false;
let animFrame   = null;
let scoreLeft   = 0, scoreRight = 0;
let combo       = 0;
let activePower = null;
let powerTimeout = null;

// Đối tượng vật lý
let ball, lPad, rPad;

// Input
let mouseY = CH / 2;
let keys   = {};

function initBall(dir = 1) {
  const angle = Math.random() * Math.PI/3 - Math.PI/6;
  ball = {
    x: CW/2, y: CH/2,
    vx: BALL_START_SPD * dir * Math.cos(angle),
    vy: BALL_START_SPD * Math.sin(angle),
    r: BALL_R,
  };
}

function initPads() {
  lPad = { x: 20,            y: CH/2 - PAD_H/2, w: PAD_W, h: PAD_H };
  rPad = { x: CW - 20 - PAD_W, y: CH/2 - PAD_H/2, w: PAD_W, h: PAD_H };
}

function startGame() {
  document.getElementById('start-overlay').classList.add('hidden');
  scoreLeft = 0; scoreRight = 0; combo = 0;
  updateScoreDisplay();
  initPads(); initBall(1);
  gameRunning = true;
  // Chuyển sang nhạc game
  startGameMusic();
  loop();
}

function resetGame() {
  stopGame();
  scoreLeft = 0; scoreRight = 0; combo = 0;
  updateScoreDisplay();
  initPads(); initBall(1);
  document.getElementById('start-overlay').classList.remove('hidden');
  document.getElementById('win-overlay').classList.add('hidden');
  draw();
  // Về nhạc menu nếu đang trong main screen
  if (!document.getElementById('main-screen').classList.contains('hidden')) {
    if (activeMusic !== 'menu') startMenuMusic();
  }
}

function stopGame() {
  gameRunning = false;
  if (animFrame)    { cancelAnimationFrame(animFrame); animFrame = null; }
  if (powerTimeout) { clearTimeout(powerTimeout); powerTimeout = null; }
}

function setMode(m) {
  gameMode = m;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('diff-selector').style.display = m==='ai' ? 'flex' : 'none';
  document.getElementById('controls-hint').textContent   =
    m==='ai' ? 'CHUỘT / ↑↓  •  MÁY TỰ ĐỘNG' : 'NGƯỜI 1: W/S  •  NGƯỜI 2: ↑↓';
  resetGame();
}

function setDiff(d) {
  difficulty = d;
  document.querySelectorAll('.diff-star').forEach((s, i) => s.classList.toggle('on', i < d));
}

function loop() {
  if (!gameRunning) return;
  update();
  draw();
  animFrame = requestAnimationFrame(loop);
}

function update() {
  // Điều khiển thanh đỡ
  if (gameMode === '2p') {
    if (keys['KeyW'])      lPad.y = Math.max(0, lPad.y - PAD_SPEED);
    if (keys['KeyS'])      lPad.y = Math.min(CH - lPad.h, lPad.y + PAD_SPEED);
    if (keys['ArrowUp'])   rPad.y = Math.max(0, rPad.y - PAD_SPEED);
    if (keys['ArrowDown']) rPad.y = Math.min(CH - rPad.h, rPad.y + PAD_SPEED);
  } else {
    // Người chơi (trái) — chuột hoặc phím
    if (keys['ArrowUp'])   mouseY = Math.max(0, mouseY - PAD_SPEED);
    if (keys['ArrowDown']) mouseY = Math.min(CH, mouseY + PAD_SPEED);
    lPad.y = Math.max(0, Math.min(CH - lPad.h, mouseY - lPad.h / 2));

    // AI (phải) — bám theo bóng với độ trễ
    const aiSpeeds = [2.5, 3.8, 5.2];
    const lagRatio = [0.75, 0.88, 0.96];
    const spd      = aiSpeeds[difficulty - 1];
    const lag      = lagRatio[difficulty - 1];
    const target   = ball.y - rPad.h / 2;
    const diff     = target - rPad.y;
    rPad.y += Math.sign(diff) * Math.min(Math.abs(diff) * lag, spd);
    rPad.y  = Math.max(0, Math.min(CH - rPad.h, rPad.y));
  }

  // Di chuyển bóng
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Nảy tường trên / dưới
  if (ball.y - ball.r <= 0)  { ball.y = ball.r;      ball.vy *= -1; sfxWall(); }
  if (ball.y + ball.r >= CH) { ball.y = CH - ball.r; ball.vy *= -1; sfxWall(); }

  // Va chạm thanh đỡ trái
  if (ball.vx < 0
    && ball.x - ball.r <= lPad.x + lPad.w
    && ball.x + ball.r >= lPad.x
    && ball.y >= lPad.y - ball.r
    && ball.y <= lPad.y + lPad.h + ball.r)
  {
    ball.x = lPad.x + lPad.w + ball.r;
    const rel   = (ball.y - (lPad.y + lPad.h / 2)) / (lPad.h / 2);
    const angle = rel * Math.PI / 3;
    const spd   = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.04);
    ball.vx = spd * Math.cos(angle);
    ball.vy = spd * Math.sin(angle);
    sfxPaddle();
    onPaddleHit();
  }

  // Va chạm thanh đỡ phải
  if (ball.vx > 0
    && ball.x + ball.r >= rPad.x
    && ball.x - ball.r <= rPad.x + rPad.w
    && ball.y >= rPad.y - ball.r
    && ball.y <= rPad.y + rPad.h + ball.r)
  {
    ball.x = rPad.x - ball.r;
    const rel   = (ball.y - (rPad.y + rPad.h / 2)) / (rPad.h / 2);
    const angle = Math.PI - rel * Math.PI / 3;
    const spd   = Math.min(MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.04);
    ball.vx = -spd * Math.cos(angle - Math.PI);
    ball.vy =  spd * Math.sin(angle - Math.PI);
    sfxPaddle();
    if (gameMode === '2p') onPaddleHit();
    else { combo++; addCoins(1); showToast('+1 xu (đỡ bóng)', 'info'); }
  }

  // Ra biên trái → máy/người 2 ghi điểm
  if (ball.x - ball.r < 0) {
    scoreRight++;
    updateScoreDisplay();
    sfxScore();
    if (scoreRight >= WIN_SCORE) { endGame(gameMode === 'ai' ? 'AI' : 'Người 2'); return; }
    combo = 0; initBall(1);
  }

  // Ra biên phải → người chơi/người 1 ghi điểm
  if (ball.x + ball.r > CW) {
    scoreLeft++;
    updateScoreDisplay();
    sfxScore();
    if (scoreLeft >= WIN_SCORE) { endGame(gameMode === 'ai' ? 'Bạn' : 'Người 1'); return; }
    initBall(-1);
  }
}

function onPaddleHit() {
  combo++;
  if (combo % 5 === 0) { addCoins(1); showToast('+1 xu (combo x' + combo + ')', 'info'); }
}

function updateScoreDisplay() {
  document.getElementById('score-left').textContent  = scoreLeft;
  document.getElementById('score-right').textContent = scoreRight;
}

function endGame(winner) {
  gameRunning = false;
  stopAllMusic();

  const isWin = (gameMode==='ai' && winner==='Bạn') || gameMode==='2p';
  let coinsEarned = 0;

  if (!isGuest) {
    if (isWin) {
      coinsEarned = 50; addCoins(50);
      db[currentUser].wins = (db[currentUser].wins || 0) + 1;
    } else {
      db[currentUser].losses = (db[currentUser].losses || 0) + 1;
    }
    db[currentUser].gamesPlayed  = (db[currentUser].gamesPlayed  || 0) + 1;
    db[currentUser].highStreak   = Math.max(db[currentUser].highStreak || 0, combo);
    saveDB();
  }

  // Âm thanh kết thúc
  if (isWin) sfxWin(); else sfxLose();

  // Hiển thị overlay
  const ov = document.getElementById('win-overlay');
  document.getElementById('win-title').textContent  = winner + ' THẮNG!';
  document.getElementById('win-title').style.color  = isWin ? 'var(--neon-cyan)' : 'var(--neon-pink)';
  document.getElementById('win-reward').textContent = coinsEarned > 0 ? '+' + coinsEarned + ' XU' : '';
  document.getElementById('win-stats').textContent  = 'TỶ SỐ: ' + scoreLeft + ' - ' + scoreRight + '  •  CHUỖI: ' + combo;
  ov.classList.remove('hidden');

  renderStats();
}


/* ════════════════════════════════════════════════════════════
   8. RENDERER
════════════════════════════════════════════════════════════ */

function getBallSkin()   { return BALL_SKINS.find(s => s.id === equippedBall)   || BALL_SKINS[0]; }
function getPaddleSkin() { return PADDLE_SKINS.find(s => s.id === equippedPaddle) || PADDLE_SKINS[0]; }

function draw() {
  // Nền
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, CW, CH);

  // Đường giữa sân
  ctx.setLineDash([8, 12]);
  ctx.strokeStyle = 'rgba(230,237,243,0.08)';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(CW/2, 0); ctx.lineTo(CW/2, CH); ctx.stroke();
  ctx.setLineDash([]);

  const ps = getPaddleSkin();
  const bs = getBallSkin();

  // Vẽ thanh đỡ
  drawPaddle(lPad, ps);
  drawPaddle(rPad, ps);

  // Vẽ bóng
  ctx.shadowBlur  = 24;
  ctx.shadowColor = bs.glow;
  ctx.fillStyle   = bs.color;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur  = 0;
}

function drawPaddle(pad, skin) {
  ctx.shadowBlur  = 20;
  ctx.shadowColor = skin.glow;
  const grad = ctx.createLinearGradient(pad.x, pad.y, pad.x + pad.w, pad.y);
  grad.addColorStop(0, skin.color);
  grad.addColorStop(1, skin.color + '99');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(pad.x, pad.y, pad.w, pad.h, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// Theo dõi chuột trên canvas wrapper
document.getElementById('canvas-wrapper').addEventListener('mousemove', e => {
  const rect   = canvas.getBoundingClientRect();
  const scaleY = CH / rect.height;
  mouseY = (e.clientY - rect.top) * scaleY;
});

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
});

document.addEventListener('keyup', e => { keys[e.code] = false; });


/* ════════════════════════════════════════════════════════════
   9. SHOP
════════════════════════════════════════════════════════════ */

function renderShop() {
  renderBallShop();
  renderPaddleShop();
  renderPowerShop();
}

function renderBallShop() {
  const el    = document.getElementById('ball-shop');
  const owned = isGuest ? ['default'] : (db[currentUser]?.ownedBalls || ['default']);
  el.innerHTML = BALL_SKINS.map(s => {
    const isOwned = owned.includes(s.id);
    const isEq    = equippedBall === s.id;
    return `
      <div class="shop-item ${isOwned?'owned':''} ${isEq?'equipped':''}" onclick="buyOrEquipBall('${s.id}')">
        ${isEq    ? '<span class="shop-item-badge badge-equipped">TRANG BỊ</span>' :
          isOwned ? '<span class="shop-item-badge badge-owned">SỞ HỮU</span>'     : ''}
        <div class="shop-item-preview">${BALL_SVG[s.id] || ''}</div>
        <div class="shop-item-name">${s.name}</div>
        <div class="shop-item-desc">${s.desc}</div>
        ${isOwned
          ? `<div style="font-size:11px;color:var(--neon-green)">${isEq ? '✓ Đang trang bị' : 'Nhấn để trang bị'}</div>`
          : `<div class="shop-item-price">⬡ ${s.price} XU</div>`}
      </div>`;
  }).join('');
}

function renderPaddleShop() {
  const el    = document.getElementById('paddle-shop');
  const owned = isGuest ? ['default'] : (db[currentUser]?.ownedPaddles || ['default']);
  el.innerHTML = PADDLE_SKINS.map(s => {
    const isOwned = owned.includes(s.id);
    const isEq    = equippedPaddle === s.id;
    return `
      <div class="shop-item ${isOwned?'owned':''} ${isEq?'equipped':''}" onclick="buyOrEquipPaddle('${s.id}')">
        ${isEq    ? '<span class="shop-item-badge badge-equipped">TRANG BỊ</span>' :
          isOwned ? '<span class="shop-item-badge badge-owned">SỞ HỮU</span>'     : ''}
        <div class="shop-item-preview">${PADDLE_SVG[s.id] || ''}</div>
        <div class="shop-item-name">${s.name}</div>
        <div class="shop-item-desc">${s.desc}</div>
        ${isOwned
          ? `<div style="font-size:11px;color:var(--neon-green)">${isEq ? '✓ Đang trang bị' : 'Nhấn để trang bị'}</div>`
          : `<div class="shop-item-price">⬡ ${s.price} XU</div>`}
      </div>`;
  }).join('');
}

function renderPowerShop() {
  const el = document.getElementById('power-shop');
  const pw = isGuest ? {} : (db[currentUser]?.powers || {});
  el.innerHTML = POWER_ITEMS.map(s => {
    const qty = pw[s.id] || 0;
    return `
      <div class="shop-item" onclick="buyPower('${s.id}')">
        <div class="shop-item-preview">${POWER_SVG[s.id] || ''}</div>
        <div class="shop-item-name">${s.name}${qty > 0 ? ' <span style="color:var(--neon-green)">x' + qty + '</span>' : ''}</div>
        <div class="shop-item-desc">${s.desc}</div>
        <div class="shop-item-price">⬡ ${s.price} XU</div>
      </div>`;
  }).join('');
}

function renderPowerBar() {
  const bar = document.getElementById('power-bar');
  const pw  = isGuest ? {} : (db[currentUser]?.powers || {});
  const items = POWER_ITEMS.filter(p => (pw[p.id] || 0) > 0);

  if (items.length === 0) {
    bar.innerHTML = '<span style="font-size:11px;color:var(--text2);letter-spacing:2px">Không có vật phẩm • Mua ở Cửa Hàng</span>';
  } else {
    bar.innerHTML =
      '<span style="font-size:11px;color:var(--text2);letter-spacing:2px">VẬT PHẨM:</span>' +
      items.map(p => `
        <div class="power-item" id="pi-${p.id}" onclick="usePower('${p.id}')">
          <span style="display:inline-flex;align-items:center;width:20px;height:20px">
            ${(POWER_SVG[p.id]||'').replace(/width="56" height="56"/g,'width="20" height="20"')}
          </span>
          ${p.name} <span style="opacity:.5">x${pw[p.id]}</span>
        </div>`).join('');
  }
}

function buyOrEquipBall(id) {
  const skin = BALL_SKINS.find(s => s.id === id); if (!skin) return;
  if (isGuest) { showToast('Đăng nhập để mua skin', 'error'); return; }
  const owned = db[currentUser].ownedBalls || ['default'];
  if (owned.includes(id)) {
    equippedBall = id; db[currentUser].equippedBall = id;
    saveDB(); renderBallShop();
    showToast('Đã trang bị ' + skin.name, 'success');
  } else {
    if (!spendCoins(skin.price)) return;
    db[currentUser].ownedBalls = [...owned, id];
    db[currentUser].equippedBall = id; equippedBall = id;
    saveDB(); renderBallShop();
    sfxBuy(); showToast('Mua thành công ' + skin.name, 'success');
  }
}

function buyOrEquipPaddle(id) {
  const skin = PADDLE_SKINS.find(s => s.id === id); if (!skin) return;
  if (isGuest) { showToast('Đăng nhập để mua skin', 'error'); return; }
  const owned = db[currentUser].ownedPaddles || ['default'];
  if (owned.includes(id)) {
    equippedPaddle = id; db[currentUser].equippedPaddle = id;
    saveDB(); renderPaddleShop();
    showToast('Đã trang bị ' + skin.name, 'success');
  } else {
    if (!spendCoins(skin.price)) return;
    db[currentUser].ownedPaddles = [...owned, id];
    db[currentUser].equippedPaddle = id; equippedPaddle = id;
    saveDB(); renderPaddleShop();
    sfxBuy(); showToast('Mua thành công ' + skin.name, 'success');
  }
}

function buyPower(id) {
  if (isGuest) { showToast('Đăng nhập để mua vật phẩm', 'error'); return; }
  const p = POWER_ITEMS.find(x => x.id === id);
  if (!spendCoins(p.price)) return;
  db[currentUser].powers = db[currentUser].powers || {};
  db[currentUser].powers[id] = (db[currentUser].powers[id] || 0) + 1;
  powers = db[currentUser].powers;
  saveDB(); renderPowerShop(); renderPowerBar();
  sfxBuy(); showToast('Mua thành công ' + p.name, 'success');
}

function usePower(id) {
  if (!gameRunning) { showToast('Hãy bắt đầu game trước', 'error'); return; }
  if (isGuest) return;
  const p = POWER_ITEMS.find(x => x.id === id);
  if (!db[currentUser].powers[id] || db[currentUser].powers[id] <= 0) {
    showToast('Không còn ' + p.name, 'error'); return;
  }
  db[currentUser].powers[id]--;
  powers = db[currentUser].powers; saveDB();

  if (powerTimeout) clearTimeout(powerTimeout);
  activePower = id;
  document.getElementById('pi-' + id)?.classList.add('active');

  if (id === 'big_paddle') {
    lPad.h = 135;
    powerTimeout = setTimeout(() => { lPad.h = PAD_H; activePower = null; renderPowerBar(); }, p.duration);
  } else if (id === 'slow_ball') {
    const f = 0.5; ball.vx *= f; ball.vy *= f;
    powerTimeout = setTimeout(() => { ball.vx /= f; ball.vy /= f; activePower = null; renderPowerBar(); }, p.duration);
  } else if (id === 'fast_serve') {
    ball.vx *= 2; ball.vy *= 2; activePower = null;
  }
  renderPowerBar();
  showToast('Kích hoạt: ' + p.name, 'success');
}

function checkDailyReward() {
  if (isGuest) {
    document.getElementById('daily-btn').disabled = true;
    document.getElementById('daily-sub').textContent = 'Đăng nhập để nhận thưởng hàng ngày';
    return;
  }
  const u = db[currentUser];
  const now = Date.now();
  const last = u.lastDaily || 0;
  const ONE_DAY = 86400000;
  if (now - last < ONE_DAY) {
    const remain = ONE_DAY - (now - last);
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    document.getElementById('daily-sub').textContent = `Đã nhận hôm nay. Còn ${h}h ${m}m`;
    document.getElementById('daily-btn').disabled = true;
  } else {
    const streak = u.dailyStreak || 0;
    const bonus  = 30 + streak * 5;
    document.getElementById('daily-sub').textContent = `Chuỗi đăng nhập: ${streak} ngày  •  Nhận +${bonus} xu hôm nay!`;
    document.getElementById('daily-btn').disabled = false;
  }
}

function claimDaily() {
  if (isGuest) return;
  const u      = db[currentUser];
  const streak = (u.dailyStreak || 0) + 1;
  const bonus  = 30 + streak * 5;
  u.lastDaily    = Date.now();
  u.dailyStreak  = streak;
  u.coins        = (u.coins || 0) + bonus;
  saveDB(); updateHeader();
  sfxBuy();
  showToast(`Nhận thưởng hàng ngày: +${bonus} xu! (Chuỗi: ${streak} ngày)`, 'success');
  checkDailyReward();
}


/* ════════════════════════════════════════════════════════════
   10. STATS & LEADERBOARD
════════════════════════════════════════════════════════════ */

function renderStats() {
  if (isGuest) {
    document.getElementById('stats-grid').innerHTML  = '<p style="color:var(--text2);font-size:12px">Đăng nhập để xem thống kê</p>';
    document.getElementById('leaderboard').innerHTML = '';
    return;
  }
  const u = db[currentUser];
  const stats = [
    { label:'TRẬN THẮNG',     value: u.wins || 0,        color:'var(--neon-cyan)'   },
    { label:'TRẬN THUA',      value: u.losses || 0,      color:'var(--neon-pink)'   },
    { label:'TỔNG XU',        value: u.coins || 0,       color:'var(--neon-yellow)' },
    { label:'CHUỖI CAO NHẤT', value: u.highStreak || 0,  color:'var(--neon-purple)' },
    { label:'TỔNG TRẬN',      value: u.gamesPlayed || 0, color:'var(--neon-green)'  },
    { label:'TỶ LỆ THẮNG',   value: u.gamesPlayed
        ? Math.round((u.wins || 0) / u.gamesPlayed * 100) + '%' : '0%',
      color:'var(--text)' },
  ];

  document.getElementById('stats-grid').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value" style="color:${s.color}">${s.value}</div>
    </div>`).join('');

  const users = Object.values(db).sort((a, b) => (b.wins || 0) - (a.wins || 0)).slice(0, 10);
  document.getElementById('leaderboard').innerHTML =
    `<tr><th>HẠNG</th><th>TÊN</th><th>THẮNG</th><th>XU</th><th>CHUỖI</th></tr>` +
    users.map((u, i) => {
      const cls = ['rank-1','rank-2','rank-3'][i] || 'rank-n';
      return `<tr>
        <td><span class="rank-badge ${cls}">${i+1}</span></td>
        <td style="color:${u.username===currentUser?'var(--neon-cyan)':'var(--text)'}">${u.username}${u.username===currentUser?' (bạn)':''}</td>
        <td style="color:var(--neon-green)">${u.wins||0}</td>
        <td style="color:var(--neon-yellow)">${u.coins||0}</td>
        <td style="color:var(--neon-purple)">${u.highStreak||0}</td>
      </tr>`;
    }).join('');
}


/* ════════════════════════════════════════════════════════════
   11. TOAST
════════════════════════════════════════════════════════════ */

let toastTimer = null;

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast toast-' + type + ' show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}


/* ════════════════════════════════════════════════════════════
   12. PANEL SWITCHING
════════════════════════════════════════════════════════════ */

function switchPanel(p) {
  document.querySelectorAll('.panel').forEach(el  => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('panel-' + p).classList.add('active');
  const idx = { game:0, shop:1, stats:2 }[p];
  document.querySelectorAll('.nav-tab')[idx]?.classList.add('active');
  if (p === 'shop')  renderShop();
  if (p === 'stats') renderStats();
}


/* ════════════════════════════════════════════════════════════
   13. BOOT / INIT
════════════════════════════════════════════════════════════ */

loadDB();
initPads();
initBall(1);
draw();          // Vẽ preview canvas ngay
bootIntro();     // Khởi động màn hình intro
