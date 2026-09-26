# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Classic Tetris in vanilla JavaScript + HTML5 Canvas + CSS. No dependencies, no package.json, no bundler, no build step, no test suite, no linter. The README and all UI text are in Spanish; keep new user-facing strings in Spanish.

## Running

Open `index.html` directly, or serve the folder statically and visit http://localhost:8000:

    python -m http.server 8000

Verify changes by playing the game in a browser; there are no automated tests.

## Architecture

Three files: `index.html` (DOM, two canvases, HUD, overlay), `style.css` (dark theme), `game.js` (all logic, single classic script with `'use strict'`, no modules).

Key points in `game.js`:

- All game state is module-level `let` globals (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `lastTime`, `dropAccum`, `dropInterval`, `animId`). `init()` resets every one of them and is also the restart handler. Any new state must be reset in `init()`.
- Board is a `ROWS × COLS` matrix of `0` or a piece type index (1–7). Piece matrices in `PIECES` store their own type index as cell values, so the same number indexes `COLORS`. Keep `PIECES` and `COLORS` indices aligned when adding or changing pieces.
- `collide(shape, x, y)` is the single collision check used by movement, rotation, drops, ghost and spawn. Cells with `y < 0` are allowed (above the board).
- Rotation: `rotateCW` builds a new matrix; `tryRotate` tests kicks `[0, -1, 1, -2, 2]` columns only (no SRS tables, no counter-clockwise).
- Locking flow: `lockPiece()` → `merge()` → `clearLines()` (updates score/lines/level/`dropInterval`) → `spawn()`. `spawn()` calls `endGame()` if the new piece collides immediately.
- Game loop: `loop(ts)` via `requestAnimationFrame`, accumulates `dropAccum` and steps gravity when it reaches `dropInterval`. Pause/game over stop the loop with `cancelAnimationFrame(animId)`; unpausing calls `loop()` directly.
- Speed: `dropInterval = max(100, 1000 - (level - 1) * 90)`; level = `floor(lines / 10) + 1`. Score: `LINE_SCORES[cleared] * level`, +1 per soft-drop row, +2 per hard-drop row.

## Coupled values

- `<canvas id="board">` width/height in `index.html` must equal `COLS * BLOCK` × `ROWS * BLOCK` (currently 300 × 600).
- `drawNext()` assumes a 4×4 preview grid with 30px cells, matching `<canvas id="next-canvas">` 120 × 120.
- Element IDs used by `game.js`: `board`, `next-canvas`, `score`, `lines`, `level`, `overlay`, `overlay-title`, `overlay-score`, `restart-btn`. Overlay visibility is toggled with the `hidden` class.
