'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - azul pálido
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const BASE_TYPES = 7;
const POWERUP_EVERY_LINES = 10; // por defecto; def.everyLines lo sobrescribe
const POWERUPS = [];

// def: { id, name, color, shape, everyLines?, onLock?(piece), duration?, onStart?(), onEnd?(), modifyDropInterval?(ms) }
function registerPowerUp(def) {
  if (!def.everyLines) def.everyLines = POWERUP_EVERY_LINES;
  COLORS.push(def.color);
  def.cell = COLORS.length - 1;
  def.shape = def.shape.map(row => row.map(v => (v ? def.cell : 0)));
  POWERUPS.push(def);
  powerupSection.classList.remove('hidden');
  updateHUD();
}

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const powerupSection = document.getElementById('powerup-section');
const powerupEl = document.getElementById('powerup');
const powerupProgressEl = document.getElementById('powerup-progress');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let activeEffects, linesSince, powerUpQueue;
let combo, comboFx;
let audioCtx = null;
let muted = false;
let gridColor;

function updateGridColor() {
  gridColor = getComputedStyle(document.body).getPropertyValue('--board-grid').trim();
}

function applyTheme(isLight) {
  document.body.classList.toggle('light-theme', isLight);
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
  updateGridColor();
}

// ---- Combos (limpiar líneas en piezas consecutivas) ----
const COMBO_FX_MS = 900;

function getAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(a, freq, delay, dur) {
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.06, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

// Arpegio mayor que sube un tono por cada combo (tope en x9).
function playComboSound(n) {
  if (muted) return;
  const a = getAudio();
  if (!a) return;
  const root = 392 * Math.pow(2, (Math.min(n, 9) - 2) * 2 / 12);
  const notes = [1, 1.25, 1.5];
  if (n >= 4) notes.push(2);
  notes.forEach((m, i) => playTone(a, root * m, i * 0.07, 0.18));
}

function triggerCombo(n) {
  comboFx.push({ n, age: 0 });
  playComboSound(n);
}

function tickComboFx(dt) {
  if (!comboFx.length) return;
  for (const fx of comboFx) fx.age += dt;
  comboFx = comboFx.filter(fx => fx.age < COMBO_FX_MS);
}

function comboShake() {
  let m = 0;
  for (const fx of comboFx) m += (1 - fx.age / COMBO_FX_MS) * Math.min(fx.n, 6);
  return m;
}

function drawComboFx() {
  for (const fx of comboFx) {
    const t = fx.age / COMBO_FX_MS;
    ctx.fillStyle = `rgba(255,255,255,${0.3 * (1 - t) * (1 - t)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1 - t * t;
    ctx.font = `bold ${26 + Math.min(fx.n, 8) * 3}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = `hsl(${(fx.n * 40) % 360}, 100%, 65%)`;
    const y = canvas.height / 2 - t * 60;
    ctx.strokeText(`COMBO x${fx.n}`, canvas.width / 2, y);
    ctx.fillText(`COMBO x${fx.n}`, canvas.width / 2, y);
    ctx.globalAlpha = 1;
  }
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type, shape, powerUp) {
  shape = shape.map(row => [...row]);
  return { type, shape, powerUp, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  const type = Math.floor(Math.random() * BASE_TYPES) + 1;
  return makePiece(type, PIECES[type], null);
}

function nextPiece() {
  if (powerUpQueue.length) {
    const def = powerUpQueue.shift();
    return makePiece(def.cell, def.shape, def);
  }
  return randomPiece();
}

function activateEffect(def) {
  const active = activeEffects.find(e => e.def.id === def.id);
  if (active) {
    active.remaining = def.duration;
  } else {
    activeEffects.push({ def, remaining: def.duration });
    if (def.onStart) def.onStart();
  }
  updateHUD();
}

function tickEffects(dt) {
  if (!activeEffects.length) return;
  const before = activeEffects.map(e => Math.ceil(e.remaining / 1000)).join();
  for (const e of activeEffects) e.remaining -= dt;
  activeEffects = activeEffects.filter(e => {
    if (e.remaining > 0) return true;
    if (e.def.onEnd) e.def.onEnd();
    return false;
  });
  const after = activeEffects.map(e => Math.ceil(e.remaining / 1000)).join();
  if (before !== after) updateHUD();
}

function currentDropInterval() {
  let interval = dropInterval;
  for (const e of activeEffects)
    if (e.def.modifyDropInterval) interval = e.def.modifyDropInterval(interval);
  return interval;
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    for (const def of POWERUPS) {
      linesSince[def.id] = (linesSince[def.id] || 0) + cleared;
      while (linesSince[def.id] >= def.everyLines) {
        linesSince[def.id] -= def.everyLines;
        powerUpQueue.push(def);
      }
    }
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const pu = current.powerUp;
  if (pu && pu.onLock) pu.onLock(current);
  else merge();
  if (pu && pu.duration) activateEffect(pu);
  if (clearLines()) {
    combo++;
    if (combo >= 2) triggerCombo(combo);
  } else {
    combo = 0;
  }
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  if (!POWERUPS.length) return;
  if (activeEffects.length) {
    powerupEl.textContent = activeEffects
      .map(e => `${e.def.name} ${Math.ceil(e.remaining / 1000)}s`).join(', ');
  } else {
    powerupEl.textContent = '—';
  }
  powerupProgressEl.textContent = POWERUPS.map(def => {
    if (powerUpQueue.includes(def)) return `${def.name}: ¡listo!`;
    return `${def.name}: en ${def.everyLines - (linesSince[def.id] || 0)}`;
  }).join(' · ');
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (colorIndex > BASE_TYPES) {
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.strokeRect(x * size + 4, y * size + 4, size - 8, size - 8);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  const shake = comboShake();
  if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  ctx.restore();
  drawComboFx();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  tickEffects(dt);
  tickComboFx(dt);
  if (dropAccum >= currentDropInterval()) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  activeEffects = [];
  linesSince = {};
  powerUpQueue = [];
  combo = 0;
  comboFx = [];
  next = nextPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  getAudio();
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('change', () => applyTheme(themeToggle.checked));

// Bomba: al bloquearse no se fusiona; destruye siempre un área 3×3 completa.
// Empieza en su fila y se extiende hacia abajo (donde están los bloques
// impactados), centrada en su columna; junto a paredes/suelo se desplaza
// hacia dentro para no perder celdas.
const BOMB_SIZE = 3;

function bombArea(x, y) {
  return {
    top: Math.max(0, Math.min(y, ROWS - BOMB_SIZE)),
    left: Math.max(0, Math.min(x - 1, COLS - BOMB_SIZE)),
  };
}

const bomb = {
  id: 'bomb',
  name: 'Bomba',
  color: '#ff5252',
  shape: [[1]],
  everyLines: 3,
  onLock(piece) {
    const { top, left } = bombArea(piece.x, piece.y);
    for (let r = top; r < top + BOMB_SIZE; r++)
      for (let c = left; c < left + BOMB_SIZE; c++)
        board[r][c] = 0;
  },
};

// Rayo: al bloquearse no se fusiona; limpia por completo su fila y su columna.
const lightning = {
  id: 'lightning',
  name: 'Rayo',
  color: '#ffee00',
  shape: [[1]],
  everyLines: 2,
  onLock(piece) {
    for (let r = 0; r < ROWS; r++) board[r][piece.x] = 0;
    // Se elimina la fila (no solo se vacía) para que las de arriba bajen.
    if (piece.y >= 0) {
      board.splice(piece.y, 1);
      board.unshift(new Array(COLS).fill(0));
    }
  },
};

const savedTheme = localStorage.getItem('tetris-theme');
themeToggle.checked = savedTheme === 'light';
applyTheme(themeToggle.checked);

init();
registerPowerUp(bomb);
registerPowerUp(lightning);
