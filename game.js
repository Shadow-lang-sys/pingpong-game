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

/* ── Danh sách bài nhạc có sẵn ── */
const MUSIC_TRACKS = [
  {
    id: 'cyber_arcade',
    name: 'Cyber Arcade',
    author: 'Neon Pong OST',
    tag: 'MENU',
    scale: [392, 440, 523, 587, 659, 784, 880, 1047],
    bpm: 200, vol: 0.18, osc: 'triangle',
  },
  {
    id: 'battle_zone',
    name: 'Battle Zone',
    author: 'Neon Pong OST',
    tag: 'GAME',
    scale: [220, 277, 330, 370, 440, 554, 659, 740],
    bpm: 240, vol: 0.14, osc: 'square',
  },
  {
    id: 'midnight_run',
    name: 'Midnight Run',
    author: 'Neon Pong OST',
    tag: 'CHILL',
    scale: [261, 311, 370, 392, 466, 523, 622, 740],
    bpm: 160, vol: 0.16, osc: 'sine',
  },
  {
    id: 'neon_storm',
    name: 'Neon Storm',
    author: 'Neon Pong OST',
    tag: 'INTENSE',
    scale: [180, 214, 270, 360, 404, 540, 720, 810],
    bpm: 280, vol: 0.13, osc: 'sawtooth',
  },
  {
    id: 'galaxy_drift',
    name: 'Galaxy Drift',
    author: 'Neon Pong OST',
    tag: 'AMBIENT',
    scale: [174, 220, 261, 329, 349, 440, 523, 659],
    bpm: 130, vol: 0.15, osc: 'triangle',
  },
  {
    id: 'retro_wave',
    name: 'Retro Wave',
    author: 'Neon Pong OST',
    tag: 'CLASSIC',
    scale: [330, 392, 494, 523, 659, 784, 988, 1047],
    bpm: 210, vol: 0.14, osc: 'square',
  },
];

let currentTrackIdx  = 0;  // chỉ số bài đang phát
let currentMusicNode = null;
let musicPlayerOpen  = false;

function startMenuMusic()  { playTrackIdx(0); }
function startGameMusic()  { playTrackIdx(1); }

function playTrackIdx(idx) {
  if (musicMuted || !audioCtx) return;
  currentTrackIdx = ((idx % MUSIC_TRACKS.length) + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
  stopAllMusic();
  const t = MUSIC_TRACKS[currentTrackIdx];
  currentMusicNode = createArpeggioMusic(t.scale, t.bpm, t.vol, t.osc);
  activeMusic = t.id;
  updateMusicPlayerUI();
}

function stopAllMusic() {
  if (menuMusicNodes)    { menuMusicNodes.stop();    menuMusicNodes = null; }
  if (gameMusicNodes)    { gameMusicNodes.stop();    gameMusicNodes = null; }
  if (currentMusicNode)  { currentMusicNode.stop();  currentMusicNode = null; }
  activeMusic = null;
}

function nextTrack() { playTrackIdx(currentTrackIdx + 1); }
function prevTrack() { playTrackIdx(currentTrackIdx - 1); }

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
    playTrackIdx(currentTrackIdx);
  }
  updateMusicPlayerUI();
}

function toggleMusicPlayer() {
  musicPlayerOpen = !musicPlayerOpen;
  const panel = document.getElementById('music-player-panel');
  if (panel) panel.classList.toggle('open', musicPlayerOpen);
  if (musicPlayerOpen) updateMusicPlayerUI();
}

function updateMusicPlayerUI() {
  const panel = document.getElementById('music-player-panel');
  if (!panel) return;
  const t = MUSIC_TRACKS[currentTrackIdx];
  panel.querySelector('#mp-title').textContent  = t.name;
  panel.querySelector('#mp-author').textContent = t.author;
  panel.querySelector('#mp-tag').textContent    = t.tag;
  const muteBtn = panel.querySelector('#mp-mute-btn');
  if (muteBtn) muteBtn.textContent = musicMuted ? '🔇' : '🔊';
  renderMusicTrackList();
}


/* ════════════════════════════════════════════════════════════
   2. INTRO SCREEN
════════════════════════════════════════════════════════════ */

let introReady = false;  // true khi loading bar hoàn thành

let _introHasSession = false;

function bootIntro(hasSession = false) {
  _introHasSession = hasSession;
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

  setTimeout(() => {
    intro.classList.add('hidden');
    stopDemoAnimation();
    if (_introHasSession) {
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
   4. API CLIENT
════════════════════════════════════════════════════════════ */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5000'
  : window.location.origin;

const TOKEN_KEY = 'neonpong_token';
function getToken()   { return localStorage.getItem(TOKEN_KEY); }
function saveToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token   = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API_BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Lỗi server');
  return data;
}

// legacy stubs (không còn dùng localStorage cho game data)
function loadDB() {}
function saveDB() {}
const DB_KEY      = 'neonpong_db_unused';
const SESSION_KEY = 'neonpong_session_unused';

/* ════════════════════════════════════════════════════════════
   5. AUTH
════════════════════════════════════════════════════════════ */

let currentUser = null;   // username string
let userData    = null;   // full profile object từ server
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

async function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  if (!u || !p) { showAuthMsg('Vui lòng điền đầy đủ thông tin'); return; }
  showAuthMsg('Đang đăng nhập...', 'success');
  try {
    const res   = await api('POST', '/api/login', { username: u, password: p });
    saveToken(res.token);
    currentUser = res.user.username;
    userData    = res.user;
    isGuest     = false;
    enterMainScreen();
  } catch(e) { showAuthMsg(e.message); }
}

async function doRegister() {
  const u  = document.getElementById('reg-user').value.trim();
  const p  = document.getElementById('reg-pass').value;
  const p2 = document.getElementById('reg-pass2').value;
  if (!u || !p || !p2) { showAuthMsg('Vui lòng điền đầy đủ thông tin'); return; }
  if (p !== p2)        { showAuthMsg('Mật khẩu không khớp'); return; }
  showAuthMsg('Đang tạo tài khoản...', 'success');
  try {
    const res   = await api('POST', '/api/register', { username: u, password: p, confirm: p2 });
    saveToken(res.token);
    currentUser = res.user.username;
    userData    = res.user;
    isGuest     = false;
    showAuthMsg('Tạo tài khoản thành công!', 'success');
    setTimeout(enterMainScreen, 600);
  } catch(e) { showAuthMsg(e.message); }
}

function playAsGuest() {
  currentUser = 'KHÁCH';
  userData    = { username:'KHÁCH', coins:0, wins:0, losses:0, high_streak:0,
                  games_played:0, owned_balls:['default'], owned_paddles:['default'],
                  powers:{}, equipped_ball:'default', equipped_paddle:'default',
                  last_daily:0, daily_streak:0 };
  isGuest = true;
  enterMainScreen();
}

async function doLogout() {
  stopGame(); stopAllMusic();
  try { if (!isGuest) await api('POST', '/api/logout'); } catch(e) {}
  clearToken();
  currentUser = null; userData = null; isGuest = false;
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
  if (activeMusic !== 'menu') startMenuMusic();
  // Render danh sách bài trong music player
  renderMusicTrackList();
  // Hiện chat bubble
  if (!isGuest) {
    document.getElementById('chat-bubble').classList.remove('hidden');
    refreshUnreadBadge();
    // Poll tin chưa đọc mỗi 30 giây
    setInterval(refreshUnreadBadge, 30000);
  }
  document.addEventListener('click', e => {
    const panel = document.getElementById('music-player-panel');
    const btn   = document.getElementById('music-btn');
    if (panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.classList.remove('open');
      musicPlayerOpen = false;
    }
  }, { capture: false });
}

function renderMusicTrackList() {
  const cont = document.getElementById('mp-tracks');
  if (!cont) return;
  cont.innerHTML = MUSIC_TRACKS.map((t, i) => `
    <div class="mp-track-item ${i === currentTrackIdx ? 'playing' : ''}"
         onclick="playTrackIdx(${i})">
      <div class="mp-track-num">${i === currentTrackIdx ? '▶' : (i+1)}</div>
      <div class="mp-track-name">${t.name}</div>
      <div class="mp-track-tag-sm">${t.tag}</div>
    </div>`).join('');
}

function syncUserData() {
  equippedBall   = userData.equipped_ball   || 'default';
  equippedPaddle = userData.equipped_paddle || 'default';
  powers         = userData.powers          || {};
}

function updateHeader() {
  document.getElementById('hdr-user').textContent  = currentUser;
  document.getElementById('hdr-coins').textContent = isGuest ? 0 : (userData?.coins || 0);
}

async function addCoins(n) {
  if (isGuest) { showToast('+' + n + ' XU (không lưu ở chế độ khách)', 'info'); return; }
  userData.coins = (userData.coins || 0) + n;
  updateHeader();
  try {
    const res = await api('POST', '/api/coins/add', { amount: n });
    userData.coins = res.coins; updateHeader();
  } catch(e) {}
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

async function endGame(winner) {
  gameRunning = false;
  stopAllMusic();
  const isWin = (gameMode==='ai' && winner==='Bạn') || gameMode==='2p';
  if (isWin) sfxWin(); else sfxLose();

  let coinsEarned = 0;
  if (!isGuest) {
    try {
      const res = await api('POST', '/api/game/result', {
        result:     isWin ? 'win' : 'loss',
        score_mine: scoreLeft,
        score_opp:  scoreRight,
        combo, mode: gameMode
      });
      coinsEarned = res.coins_earned || 0;
      userData    = res.user;
      updateHeader();
    } catch(e) { showToast('Lỗi lưu kết quả: ' + e.message, 'error'); }
  }

  document.getElementById('win-title').textContent  = winner + ' THẮNG!';
  document.getElementById('win-title').style.color  = isWin ? 'var(--neon-cyan)' : 'var(--neon-pink)';
  document.getElementById('win-reward').textContent = coinsEarned > 0 ? '+' + coinsEarned + ' XU' : '';
  document.getElementById('win-stats').textContent  = 'TỶ SỐ: ' + scoreLeft + ' - ' + scoreRight + '  •  CHUỖI: ' + combo;
  document.getElementById('win-overlay').classList.remove('hidden');
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
  const owned = userData?.owned_balls || ['default'];
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
  const owned = userData?.owned_paddles || ['default'];
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
  const pw = userData?.powers || {};
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
  const bar   = document.getElementById('power-bar');
  const pw    = userData?.powers || {};
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

async function buyOrEquipBall(id) {
  const skin = BALL_SKINS.find(s => s.id === id); if (!skin) return;
  if (isGuest) { showToast('Đăng nhập để mua skin', 'error'); return; }
  const owned = userData.owned_balls || ['default'];
  try {
    if (owned.includes(id)) {
      const res  = await api('POST', '/api/shop/equip/ball', { skin_id: id });
      userData.equipped_ball = res.equipped_ball;
      equippedBall = id;
      showToast('Đã trang bị ' + skin.name, 'success');
    } else {
      const res  = await api('POST', '/api/shop/buy/ball', { skin_id: id });
      userData   = res.user;
      equippedBall = id;
      sfxBuy(); showToast('Mua thành công ' + skin.name, 'success');
    }
    syncUserData(); renderBallShop(); updateHeader();
  } catch(e) { showToast(e.message, 'error'); }
}

async function buyOrEquipPaddle(id) {
  const skin = PADDLE_SKINS.find(s => s.id === id); if (!skin) return;
  if (isGuest) { showToast('Đăng nhập để mua skin', 'error'); return; }
  const owned = userData.owned_paddles || ['default'];
  try {
    if (owned.includes(id)) {
      const res  = await api('POST', '/api/shop/equip/paddle', { skin_id: id });
      userData.equipped_paddle = res.equipped_paddle;
      equippedPaddle = id;
      showToast('Đã trang bị ' + skin.name, 'success');
    } else {
      const res  = await api('POST', '/api/shop/buy/paddle', { skin_id: id });
      userData   = res.user;
      equippedPaddle = id;
      sfxBuy(); showToast('Mua thành công ' + skin.name, 'success');
    }
    syncUserData(); renderPaddleShop(); updateHeader();
  } catch(e) { showToast(e.message, 'error'); }
}

async function buyPower(id) {
  if (isGuest) { showToast('Đăng nhập để mua vật phẩm', 'error'); return; }
  try {
    const res = await api('POST', '/api/shop/buy/power', { power_id: id });
    userData  = res.user;
    powers    = userData.powers;
    syncUserData(); renderPowerShop(); renderPowerBar(); updateHeader();
    sfxBuy(); showToast('Mua thành công ' + POWER_ITEMS.find(x=>x.id===id)?.name, 'success');
  } catch(e) { showToast(e.message, 'error'); }
}

async function usePower(id) {
  if (!gameRunning) { showToast('Hãy bắt đầu game trước', 'error'); return; }
  if (isGuest) return;
  const p  = POWER_ITEMS.find(x => x.id === id);
  const pw = userData?.powers || {};
  if (!pw[id] || pw[id] <= 0) { showToast('Không còn ' + p.name, 'error'); return; }
  try {
    const res = await api('POST', '/api/shop/use/power', { power_id: id });
    userData  = res.user;
    powers    = userData.powers;
  } catch(e) { showToast(e.message, 'error'); return; }

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

async function checkDailyReward() {
  if (isGuest) {
    document.getElementById('daily-btn').disabled     = true;
    document.getElementById('daily-sub').textContent  = 'Đăng nhập để nhận thưởng hàng ngày';
    return;
  }
  const lastDaily  = (userData.last_daily  || 0) * 1000;
  const now        = Date.now();
  const ONE_DAY_MS = 86400000;
  if (now - lastDaily < ONE_DAY_MS) {
    const remain = ONE_DAY_MS - (now - lastDaily);
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    document.getElementById('daily-sub').textContent = `Đã nhận hôm nay. Còn ${h}h ${m}m`;
    document.getElementById('daily-btn').disabled    = true;
  } else {
    const streak = userData.daily_streak || 0;
    const bonus  = 30 + streak * 5;
    document.getElementById('daily-sub').textContent = `Chuỗi: ${streak} ngày  •  Nhận +${bonus} xu hôm nay!`;
    document.getElementById('daily-btn').disabled    = false;
  }
}

async function claimDaily() {
  if (isGuest) return;
  try {
    const res = await api('POST', '/api/daily');
    userData  = res.user;
    updateHeader(); syncUserData();
    sfxBuy();
    showToast(`Nhận thưởng: +${res.bonus} xu! (Chuỗi: ${res.streak} ngày)`, 'success');
    checkDailyReward();
  } catch(e) { showToast(e.message, 'error'); }
}


/* ════════════════════════════════════════════════════════════
   10. STATS & LEADERBOARD
════════════════════════════════════════════════════════════ */

async function renderStats() {
  if (isGuest) {
    document.getElementById('stats-grid').innerHTML  = '<p style="color:var(--text2);font-size:12px">Đăng nhập để xem thống kê của bạn</p>';
    document.getElementById('leaderboard').innerHTML = '';
    return;
  }
  const u = userData;
  const stats = [
    { label:'TRẬN THẮNG',     value: u.wins         || 0, color:'var(--neon-cyan)'   },
    { label:'TRẬN THUA',      value: u.losses        || 0, color:'var(--neon-pink)'   },
    { label:'TỔNG XU',        value: u.coins         || 0, color:'var(--neon-yellow)' },
    { label:'CHUỖI CAO NHẤT', value: u.high_streak   || 0, color:'var(--neon-purple)' },
    { label:'TỔNG TRẬN',      value: u.games_played  || 0, color:'var(--neon-green)'  },
    { label:'TỶ LỆ THẮNG',   value: u.games_played
        ? Math.round((u.wins||0)/u.games_played*100)+'%' : '0%', color:'var(--text)' },
  ];
  document.getElementById('stats-grid').innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value" style="color:${s.color}">${s.value}</div>
    </div>`).join('');
  // Leaderboard nhỏ gọn trong stats
  try {
    const res = await api('GET', '/api/leaderboard');
    document.getElementById('leaderboard').innerHTML =
      `<tr><th>HẠNG</th><th>TÊN</th><th>THẮNG</th><th>XU</th><th>CHUỖI</th></tr>` +
      res.leaderboard.slice(0,5).map((u, i) => {
        const cls  = ['rank-1','rank-2','rank-3'][i] || 'rank-n';
        const isMe = u.username === currentUser;
        return `<tr>
          <td><span class="rank-badge ${cls}">${i+1}</span></td>
          <td style="color:${isMe?'var(--neon-cyan)':'var(--text)'};cursor:pointer"
              onclick="viewProfile('${u.username}')">${u.username}${isMe?' (bạn)':''}</td>
          <td style="color:var(--neon-green)">${u.wins||0}</td>
          <td style="color:var(--neon-yellow)">${u.coins||0}</td>
          <td style="color:var(--neon-purple)">${u.high_streak||0}</td>
        </tr>`;
      }).join('') +
      `<tr><td colspan="5" style="text-align:center;padding:10px;">
        <span style="font-size:11px;color:var(--neon-cyan);cursor:pointer;letter-spacing:1px"
              onclick="switchPanel('friends')">XEM ĐẦY ĐỦ →</span>
      </td></tr>`;
  } catch(e) {
    document.getElementById('leaderboard').innerHTML =
      '<tr><td colspan="5" style="color:var(--text2);padding:16px;text-align:center">Không thể tải</td></tr>';
  }
}


/* ════════════════════════════════════════════════════════════
   10b. KẾT BẠN
════════════════════════════════════════════════════════════ */

let friendsData    = { friends: [], sent: [], received: [] };
let friendsTabOpen = 'leaderboard';  // 'leaderboard' | 'friends' | 'requests'

async function loadFriends() {
  if (isGuest) return;
  try {
    const res  = await api('GET', '/api/friends');
    friendsData = res;
  } catch(e) { /* silent */ }
}

async function sendFriendRequest(username) {
  if (isGuest) { showToast('Đăng nhập để kết bạn', 'error'); return; }
  if (username === currentUser) { showToast('Không thể kết bạn với chính mình', 'error'); return; }
  try {
    await api('POST', '/api/friends/request', { to_username: username });
    showToast('Đã gửi lời mời tới ' + username, 'success');
    sfxBuy();
    await loadFriends();
    renderFriendsTabs();
  } catch(e) { showToast(e.message, 'error'); }
}

async function respondFriendRequest(fromUsername, accept) {
  try {
    await api('POST', '/api/friends/respond', { from_username: fromUsername, accept });
    showToast(accept ? 'Đã chấp nhận lời mời từ ' + fromUsername : 'Đã từ chối', accept ? 'success' : 'info');
    if (accept) sfxBuy();
    await loadFriends();
    renderFriendsTabs();
  } catch(e) { showToast(e.message, 'error'); }
}

async function removeFriend(username) {
  try {
    await api('POST', '/api/friends/remove', { username });
    showToast('Đã xoá bạn ' + username, 'info');
    await loadFriends();
    renderFriendsTabs();
  } catch(e) { showToast(e.message, 'error'); }
}

async function viewProfile(username) {
  try {
    const res = await api('GET', '/api/profile/' + username);
    showProfileModal(res.profile);
  } catch(e) { showToast('Không thể tải profile', 'error'); }
}

function showProfileModal(p) {
  const existing = document.getElementById('profile-modal');
  if (existing) existing.remove();

  const isFriend = friendsData.friends.some(f => f.username === p.username);
  const isSent   = friendsData.sent.some(f => f.username === p.username);
  const isMe     = p.username === currentUser;

  const modal = document.createElement('div');
  modal.id = 'profile-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:500;
    background:rgba(3,7,18,0.85);
    display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid rgba(0,245,255,0.3);border-radius:16px;
                padding:32px;width:360px;max-width:90vw;position:relative;">
      <button onclick="document.getElementById('profile-modal').remove()"
              style="position:absolute;top:12px;right:12px;background:transparent;border:none;
                     color:var(--text2);font-size:20px;cursor:pointer;line-height:1;">×</button>

      <!-- Avatar -->
      <div style="text-align:center;margin-bottom:20px;">
        <div style="width:72px;height:72px;border-radius:50%;
                    background:linear-gradient(135deg,var(--neon-cyan),var(--neon-purple));
                    display:flex;align-items:center;justify-content:center;
                    font-family:'Orbitron',monospace;font-size:24px;font-weight:900;
                    color:#fff;margin:0 auto 12px;">
          ${p.username[0].toUpperCase()}
        </div>
        <div style="font-family:'Orbitron',monospace;font-size:16px;font-weight:700;color:var(--neon-cyan);">
          ${p.username}
        </div>
        <div style="font-size:11px;color:var(--text2);letter-spacing:2px;margin-top:4px;">
          Tham gia ${new Date(p.created_at * 1000).toLocaleDateString('vi-VN')}
        </div>
      </div>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
        ${[
          ['THẮNG', p.wins||0, 'var(--neon-cyan)'],
          ['XU', p.coins||0, 'var(--neon-yellow)'],
          ['CHUỖI', p.high_streak||0, 'var(--neon-purple)'],
        ].map(([label, val, color]) => `
          <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);
                      border-radius:8px;padding:10px;text-align:center;">
            <div style="font-size:10px;color:var(--text2);letter-spacing:1px;margin-bottom:4px;">${label}</div>
            <div style="font-family:'Orbitron',monospace;font-size:18px;font-weight:700;color:${color};">${val}</div>
          </div>`).join('')}
      </div>

      ${isMe ? '' : `
        <div style="display:flex;gap:8px;margin-top:0;">
          ${isFriend
            ? `<button onclick="openDirectMessage('${p.username}')"
                       style="flex:1;padding:11px;background:rgba(0,245,255,0.1);
                              border:1px solid rgba(0,245,255,0.4);border-radius:8px;
                              color:var(--neon-cyan);font-family:'Share Tech Mono',monospace;
                              font-size:12px;letter-spacing:2px;cursor:pointer;">
                 💬 NHẮN TIN
               </button>
               <button onclick="removeFriend('${p.username}');document.getElementById('profile-modal').remove()"
                       style="padding:11px 16px;background:rgba(255,0,110,0.1);
                              border:1px solid rgba(255,0,110,0.4);border-radius:8px;
                              color:var(--neon-pink);font-family:'Share Tech Mono',monospace;
                              font-size:12px;letter-spacing:2px;cursor:pointer;">
                 XOÁ BẠN
               </button>`
            : isSent
            ? `<button disabled style="flex:1;padding:11px;background:rgba(255,255,255,0.04);
                              border:1px solid var(--border);border-radius:8px;
                              color:var(--text2);font-family:'Share Tech Mono',monospace;
                              font-size:12px;letter-spacing:2px;">
                 ĐÃ GỬI LỜI MỜI
               </button>`
            : `<button onclick="sendFriendRequest('${p.username}');document.getElementById('profile-modal').remove()"
                       style="flex:1;padding:11px;background:rgba(0,245,255,0.1);
                              border:1px solid rgba(0,245,255,0.4);border-radius:8px;
                              color:var(--neon-cyan);font-family:'Share Tech Mono',monospace;
                              font-size:12px;letter-spacing:2px;cursor:pointer;">
                 + KẾT BẠN
               </button>`}
        </div>`}
    </div>
  `;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function renderFriendsTabs() {
  const container = document.getElementById('friends-section');
  if (!container) return;

  const tabs = ['leaderboard','friends','requests'];
  const labels = ['🌍 Toàn cầu', '👥 Bạn bè', `🔔 Lời mời${friendsData.received?.length ? ' ('+friendsData.received.length+')' : ''}`];

  container.innerHTML = `
    <!-- Tab switcher -->
    <div style="display:flex;gap:0;margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
      ${tabs.map((t,i) => `
        <button onclick="setFriendsTab('${t}')" id="ftab-${t}"
                style="flex:1;padding:9px 4px;background:${friendsTabOpen===t?'rgba(0,245,255,0.1)':'transparent'};
                       border:none;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:11px;
                       letter-spacing:1px;color:${friendsTabOpen===t?'var(--neon-cyan)':'var(--text2)'};
                       border-bottom:${friendsTabOpen===t?'2px solid var(--neon-cyan)':'2px solid transparent'};">
          ${labels[i]}
        </button>`).join('')}
    </div>
    <div id="friends-tab-content"></div>
  `;
  renderFriendsTabContent();
}

async function setFriendsTab(tab) {
  friendsTabOpen = tab;
  renderFriendsTabs();
  if (tab === 'leaderboard') renderGlobalLeaderboard();
  else if (tab === 'friends') renderFriendsList();
  else renderFriendRequests();
}

async function renderGlobalLeaderboard() {
  const cont = document.getElementById('friends-tab-content');
  if (!cont) return;

  // Search box
  cont.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input id="user-search" placeholder="Tìm người chơi để kết bạn..."
             oninput="searchUsers(this.value)"
             style="flex:1;padding:10px 14px;background:rgba(255,255,255,0.03);
                    border:1px solid var(--border);border-radius:8px;
                    color:var(--text);font-family:'Share Tech Mono',monospace;font-size:12px;outline:none;">
    </div>
    <div id="search-results"></div>
    <table class="leaderboard-table" id="leaderboard"></table>
  `;
  try {
    const res = await api('GET', '/api/leaderboard');
    document.getElementById('leaderboard').innerHTML =
      `<tr><th>HẠNG</th><th>TÊN</th><th>THẮNG</th><th>XU</th><th>CHUỖI</th><th></th></tr>` +
      res.leaderboard.map((u, i) => {
        const cls    = ['rank-1','rank-2','rank-3'][i] || 'rank-n';
        const isMe   = !isGuest && u.username === currentUser;
        const isFr   = friendsData.friends?.some(f => f.username === u.username);
        const isSent = friendsData.sent?.some(f => f.username === u.username);
        return `<tr>
          <td><span class="rank-badge ${cls}">${i+1}</span></td>
          <td><span style="color:${isMe?'var(--neon-cyan)':'var(--text)'};cursor:pointer"
                    onclick="viewProfile('${u.username}')">${u.username}${isMe?' (bạn)':''}</span></td>
          <td style="color:var(--neon-green)">${u.wins||0}</td>
          <td style="color:var(--neon-yellow)">${u.coins||0}</td>
          <td style="color:var(--neon-purple)">${u.high_streak||0}</td>
          <td>${isMe||isFr ? '' : isSent
              ? `<span style="font-size:10px;color:var(--text2)">Đã gửi</span>`
              : `<button onclick="sendFriendRequest('${u.username}')"
                         style="padding:4px 10px;background:rgba(0,245,255,0.08);
                                border:1px solid rgba(0,245,255,0.3);border-radius:5px;
                                color:var(--neon-cyan);font-size:10px;cursor:pointer;
                                font-family:'Share Tech Mono',monospace;">+KẾT BẠN</button>`}
          </td>
        </tr>`;
      }).join('');
  } catch(e) {
    const lb = document.getElementById('leaderboard');
    if (lb) lb.innerHTML = '<tr><td colspan="6" style="color:var(--text2);padding:16px;text-align:center">Không thể tải</td></tr>';
  }
}

let searchTimer = null;
async function searchUsers(q) {
  const cont = document.getElementById('search-results');
  if (!cont) return;
  if (!q.trim()) { cont.innerHTML = ''; return; }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const res = await api('GET', '/api/users/search?q=' + encodeURIComponent(q));
      cont.innerHTML = res.users.length === 0
        ? `<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">Không tìm thấy người dùng</div>`
        : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">` +
          res.users.map(u => {
            const isMe   = u.username === currentUser;
            const isFr   = friendsData.friends?.some(f => f.username === u.username);
            const isSent = friendsData.sent?.some(f => f.username === u.username);
            return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
                                background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;">
              <span style="font-size:13px;color:var(--text);cursor:pointer"
                    onclick="viewProfile('${u.username}')">${u.username}</span>
              <span style="font-size:10px;color:var(--neon-green)">W:${u.wins||0}</span>
              ${isMe||isFr ? '' : isSent
                ? `<span style="font-size:10px;color:var(--text2)">Đã gửi</span>`
                : `<button onclick="sendFriendRequest('${u.username}')"
                           style="padding:3px 8px;background:rgba(0,245,255,0.08);
                                  border:1px solid rgba(0,245,255,0.3);border-radius:5px;
                                  color:var(--neon-cyan);font-size:10px;cursor:pointer;
                                  font-family:'Share Tech Mono',monospace;">+KẾT BẠN</button>`}
            </div>`;
          }).join('') + `</div>`;
    } catch(e) {}
  }, 400);
}

function renderFriendsList() {
  const cont = document.getElementById('friends-tab-content');
  if (!cont) return;
  const friends = friendsData.friends || [];
  if (friends.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text2);font-size:13px;">
      Chưa có bạn bè nào. Tìm kiếm và gửi lời mời ở tab Toàn cầu!
    </div>`;
    return;
  }
  // Sắp xếp theo wins
  const sorted = [...friends].sort((a,b) => (b.wins||0)-(a.wins||0));
  cont.innerHTML = `
    <div style="font-size:11px;color:var(--text2);letter-spacing:2px;margin-bottom:12px;">
      BẢNG XẾP HẠNG BẠN BÈ — ${sorted.length} NGƯỜI
    </div>
    <table class="leaderboard-table">
      <tr><th>HẠNG</th><th>TÊN</th><th>THẮNG</th><th>XU</th><th>CHUỖI</th><th></th></tr>
      ${sorted.map((u, i) => {
        const cls  = ['rank-1','rank-2','rank-3'][i] || 'rank-n';
        return `<tr>
          <td><span class="rank-badge ${cls}">${i+1}</span></td>
          <td><span style="cursor:pointer;color:var(--text)" onclick="viewProfile('${u.username}')">${u.username}</span></td>
          <td style="color:var(--neon-green)">${u.wins||0}</td>
          <td style="color:var(--neon-yellow)">${u.coins||0}</td>
          <td style="color:var(--neon-purple)">${u.high_streak||0}</td>
          <td><button onclick="removeFriend('${u.username}')"
                      style="padding:3px 8px;background:rgba(255,0,110,0.06);
                             border:1px solid rgba(255,0,110,0.25);border-radius:5px;
                             color:var(--neon-pink);font-size:10px;cursor:pointer;
                             font-family:'Share Tech Mono',monospace;">XOÁ</button></td>
        </tr>`;
      }).join('')}
    </table>
  `;
}

function renderFriendRequests() {
  const cont = document.getElementById('friends-tab-content');
  if (!cont) return;
  const received = friendsData.received || [];
  const sent     = friendsData.sent     || [];
  cont.innerHTML = `
    ${received.length > 0 ? `
      <div style="font-size:11px;color:var(--text2);letter-spacing:2px;margin-bottom:10px;">LỜI MỜI NHẬN ĐƯỢC</div>
      ${received.map(u => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                    background:rgba(0,245,255,0.04);border:1px solid rgba(0,245,255,0.2);
                    border-radius:8px;margin-bottom:8px;">
          <span style="flex:1;font-size:13px;color:var(--text);cursor:pointer"
                onclick="viewProfile('${u.username}')">${u.username}</span>
          <span style="font-size:11px;color:var(--neon-green)">W:${u.wins||0}</span>
          <button onclick="respondFriendRequest('${u.username}',true)"
                  style="padding:6px 12px;background:rgba(6,214,160,0.1);
                         border:1px solid rgba(6,214,160,0.4);border-radius:6px;
                         color:var(--neon-green);font-size:11px;cursor:pointer;
                         font-family:'Share Tech Mono',monospace;">✓ ĐỒNG Ý</button>
          <button onclick="respondFriendRequest('${u.username}',false)"
                  style="padding:6px 12px;background:rgba(255,0,110,0.06);
                         border:1px solid rgba(255,0,110,0.3);border-radius:6px;
                         color:var(--neon-pink);font-size:11px;cursor:pointer;
                         font-family:'Share Tech Mono',monospace;">✕ TỪ CHỐI</button>
        </div>`).join('')}
      <div style="margin-bottom:16px;"></div>` : ''}

    <div style="font-size:11px;color:var(--text2);letter-spacing:2px;margin-bottom:10px;">
      LỜI MỜI ĐÃ GỬI ${sent.length > 0 ? '('+sent.length+')' : ''}
    </div>
    ${sent.length === 0
      ? `<div style="font-size:12px;color:var(--text2);padding:12px 0;">Chưa có lời mời nào đang chờ</div>`
      : sent.map(u => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                    background:rgba(255,255,255,0.02);border:1px solid var(--border);
                    border-radius:8px;margin-bottom:6px;">
          <span style="flex:1;font-size:13px;color:var(--text2)">${u.username}</span>
          <span style="font-size:10px;color:var(--text2);letter-spacing:1px;">CHỜ PHẢN HỒI...</span>
        </div>`).join('')}
  `;
}

function renderFriendsTabContent() {
  if (friendsTabOpen === 'leaderboard') renderGlobalLeaderboard();
  else if (friendsTabOpen === 'friends') renderFriendsList();
  else renderFriendRequests();
}

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
  const idx = { game:0, shop:1, stats:2, friends:3 }[p];
  document.querySelectorAll('.nav-tab')[idx]?.classList.add('active');
  if (p === 'shop')    renderShop();
  if (p === 'stats')   renderStats();
  if (p === 'friends') { loadFriends().then(renderFriendsTabs); }
}


/* ════════════════════════════════════════════════════════════
   12b. CHAT (Direct Message)
════════════════════════════════════════════════════════════ */

let chatOpenWith   = null;   // username đang chat
let chatPollTimer  = null;   // interval polling tin nhắn mới
let chatListOpen   = false;

/* ── Mở / đóng danh sách hội thoại ── */
function toggleChatList() {
  chatListOpen = !chatListOpen;
  document.getElementById('chat-list-panel').classList.toggle('hidden', !chatListOpen);
  document.getElementById('chat-window').classList.add('hidden');
  chatOpenWith = null;
  if (chatListOpen) loadConversations();
}

function closeChatList() {
  chatListOpen = false;
  document.getElementById('chat-list-panel').classList.add('hidden');
}

function closeChatWindow() {
  document.getElementById('chat-window').classList.add('hidden');
  chatOpenWith = null;
  stopChatPoll();
  // Quay lại list
  document.getElementById('chat-list-panel').classList.remove('hidden');
  chatListOpen = true;
  loadConversations();
}

function backToChatList() {
  document.getElementById('chat-window').classList.add('hidden');
  chatOpenWith = null;
  stopChatPoll();
  document.getElementById('chat-list-panel').classList.remove('hidden');
  loadConversations();
}

/* ── Load danh sách hội thoại ── */
async function loadConversations() {
  if (isGuest) return;
  const cont = document.getElementById('chat-conversations');
  try {
    const res   = await api('GET', '/api/chat/conversations');
    const convos = res.conversations;
    if (convos.length === 0) {
      cont.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text2);font-size:12px;">
        Kết bạn với ai đó để bắt đầu chat!
      </div>`;
      return;
    }
    cont.innerHTML = convos.map(c => {
      const initials = c.username[0].toUpperCase();
      const timeStr  = c.last_at ? formatChatTime(c.last_at) : '';
      const preview  = c.last_msg
        ? (c.last_msg.length > 28 ? c.last_msg.slice(0,28)+'…' : c.last_msg)
        : '<span style="color:var(--text2);font-style:italic">Chưa có tin nhắn</span>';
      return `
        <div class="chat-convo-item" onclick="openChatWith('${c.username}')">
          <div class="chat-convo-avatar">${initials}</div>
          <div class="chat-convo-info">
            <div class="chat-convo-name">${c.username}</div>
            <div class="chat-convo-last">${preview}</div>
          </div>
          <div class="chat-convo-meta">
            <div class="chat-convo-time">${timeStr}</div>
            ${c.unread > 0
              ? `<div class="chat-convo-unread">${c.unread}</div>`
              : ''}
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    cont.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text2);font-size:12px;">Không thể tải tin nhắn</div>`;
  }
  // Cập nhật badge tổng
  refreshUnreadBadge();
}

/* ── Mở chat với 1 người ── */
async function openChatWith(username) {
  chatOpenWith = username;
  document.getElementById('chat-list-panel').classList.add('hidden');
  const win = document.getElementById('chat-window');
  win.classList.remove('hidden');
  document.getElementById('chat-window-name').textContent = username;
  document.getElementById('chat-messages').innerHTML =
    '<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px;">Đang tải...</div>';
  await loadMessages(username);
  document.getElementById('chat-input').focus();
  // Polling mỗi 5 giây
  stopChatPoll();
  chatPollTimer = setInterval(() => {
    if (chatOpenWith === username) loadMessages(username, true);
  }, 5000);
}

/* ── Load tin nhắn ── */
async function loadMessages(username, silent = false) {
  try {
    const res  = await api('GET', '/api/chat/history/' + username);
    const msgs = res.messages;
    const cont = document.getElementById('chat-messages');
    const wasAtBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40;

    if (msgs.length === 0) {
      if (!silent) cont.innerHTML =
        '<div style="text-align:center;padding:32px;color:var(--text2);font-size:12px;">Hãy gửi tin nhắn đầu tiên!</div>';
      return;
    }

    let html = '';
    let lastDate = '';
    msgs.forEach(m => {
      const d       = new Date(m.created_at * 1000);
      const dateStr = d.toLocaleDateString('vi-VN');
      if (dateStr !== lastDate) {
        html += `<div class="chat-date-divider">${dateStr}</div>`;
        lastDate = dateStr;
      }
      const isMine = m.from === currentUser;
      const timeStr = d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
      html += `
        <div class="chat-msg ${isMine ? 'mine' : 'theirs'}">
          <div class="chat-msg-bubble">${escapeHtml(m.content)}</div>
          <div class="chat-msg-time">${timeStr}</div>
        </div>`;
    });
    cont.innerHTML = html;

    // Cuộn xuống cuối nếu đang ở dưới hoặc lần đầu load
    if (!silent || wasAtBottom) {
      cont.scrollTop = cont.scrollHeight;
    }
    // Cập nhật badge
    refreshUnreadBadge();
  } catch(e) { /* silent */ }
}

/* ── Gửi tin nhắn ── */
async function sendMessage() {
  if (!chatOpenWith) return;
  const input   = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';

  // Hiện tin ngay (optimistic)
  const cont    = document.getElementById('chat-messages');
  const now     = Math.floor(Date.now() / 1000);
  const timeStr = new Date().toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
  cont.innerHTML += `
    <div class="chat-msg mine">
      <div class="chat-msg-bubble">${escapeHtml(content)}</div>
      <div class="chat-msg-time">${timeStr}</div>
    </div>`;
  cont.scrollTop = cont.scrollHeight;

  try {
    await api('POST', '/api/chat/send', { to_username: chatOpenWith, content });
  } catch(e) {
    showToast(e.message, 'error');
  }
}

/* ── Badge số tin chưa đọc ── */
async function refreshUnreadBadge() {
  if (isGuest) return;
  try {
    const res    = await api('GET', '/api/chat/unread');
    const total  = res.total || 0;
    const badge  = document.getElementById('chat-unread-badge');
    if (badge) {
      badge.textContent    = total > 9 ? '9+' : total;
      badge.style.display  = total > 0 ? 'flex' : 'none';
    }
  } catch(e) {}
}

function stopChatPoll() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}

/* ── Helper ── */
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatChatTime(ts) {
  const d   = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
  }
  return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit' });
}

/* Mở chat trực tiếp từ profile modal hoặc danh sách bạn bè */
function openDirectMessage(username) {
  // Đóng modal nếu có
  document.getElementById('profile-modal')?.remove();
  // Hiện bubble + mở chat
  document.getElementById('chat-bubble').classList.remove('hidden');
  chatListOpen = false;
  openChatWith(username);
}



async function boot() {
  initPads();
  initBall(1);
  draw();        // Vẽ preview canvas ngay

  // Kiểm tra token cũ còn hợp lệ không
  const token = getToken();
  if (token) {
    try {
      const res   = await api('GET', '/api/me');
      currentUser = res.user.username;
      userData    = res.user;
      isGuest     = false;
      bootIntro(true);   // true = có session → sau intro vào thẳng main
      return;
    } catch(e) {
      clearToken();  // token hết hạn
    }
  }
  bootIntro(false);  // false = không có session → vào auth
}

boot();
