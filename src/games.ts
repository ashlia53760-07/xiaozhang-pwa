import type { PuzzleState, GomokuState, FlightState, FlightEvent } from "./leisure-types";
import { hash } from "./travel";
export function newPuzzle(id: string, size: number, image: string, title: string, now: number, collaborative = true): PuzzleState {
  if (![3, 4, 5].includes(size)) throw Error("拼图难度无效");
  const tiles = Array.from({ length: size * size }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) { const j = hash(id + i) % (i + 1); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  if (tiles.every((v, i) => v === i)) [tiles[0], tiles[1]] = [tiles[1], tiles[0]];
  return { id, size, image, title, tiles, moves: 0, hintCount: 0, lastHelpMove: 0, createdAt: now,
    collaborative, turn: collaborative ? "user" : undefined, userMoves: 0, characterMoves: 0 };
}
export function swapPuzzle(s: PuzzleState, a: number, b: number, now: number): boolean {
  if (s.completedAt || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= s.tiles.length || b >= s.tiles.length || a === b) return false;
  [s.tiles[a], s.tiles[b]] = [s.tiles[b], s.tiles[a]]; s.moves++;
  if (s.tiles.every((v, i) => v === i)) s.completedAt = now;
  return true;
}

/**
 * A move in cooperative mode. The board rules stay deterministic and local;
 * the optional game model is never allowed to choose or validate a move.
 */
export function puzzleMove(s: PuzzleState, a: number, b: number, actor: "user" | "character", now: number): boolean {
  if (s.collaborative && (s.turn ?? "user") !== actor) return false;
  if (!swapPuzzle(s, a, b, now)) return false;
  if (s.collaborative) {
    s.lastActor = actor;
    s.lastAction = actor === "user" ? `你把第${a + 1}块和第${b + 1}块换到了一起` : `张起灵把第${a + 1}块和第${b + 1}块接上了`;
    if (actor === "user") s.userMoves = (s.userMoves ?? 0) + 1;
    else s.characterMoves = (s.characterMoves ?? 0) + 1;
    if (!s.completedAt) s.turn = actor === "user" ? "character" : "user";
  }
  return true;
}

/** Pick a local improvement for the character's turn. This is not an LLM move. */
export function puzzleCharacterMove(s: PuzzleState): [number, number] | undefined {
  if (s.completedAt || !s.collaborative || (s.turn ?? "user") !== "character") return;
  const size = s.tiles.length;
  const score = (tiles: number[]) => tiles.reduce((n, value, index) => n + (value === index ? 1 : 0), 0);
  const before = score(s.tiles);
  let best: [number, number] | undefined;
  let bestScore = before;
  for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) {
    const copy = [...s.tiles]; [copy[a], copy[b]] = [copy[b], copy[a]];
    const value = score(copy);
    if (value > bestScore) { bestScore = value; best = [a, b]; }
  }
  if (best) return best;
  const a = s.tiles.findIndex((value, index) => value !== index);
  if (a < 0) return;
  const b = s.tiles.indexOf(a);
  return b >= 0 && b !== a ? [a, b] : undefined;
}
export function puzzleHelp(s: PuzzleState, now: number): boolean {
  if (s.completedAt || s.moves - s.lastHelpMove < 6) return false;
  const a = s.tiles.findIndex((v, i) => v !== i); if (a < 0) return false;
  s.lastHelpMove = s.moves; s.hintCount++; return swapPuzzle(s, a, s.tiles.indexOf(a), now);
}
export function newGomoku(id: string, difficulty: GomokuState["difficulty"], now: number): GomokuState {
  return { id, difficulty, board: Array(225).fill(0), turn: 1, moves: 0, winner: 0, createdAt: now };
}
export function gomokuWinner(board: number[]): number {
  for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
    const c = board[y * 15 + x]; if (!c) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      let n = 1; while (n < 5 && x + dx * n >= 0 && x + dx * n < 15 && y + dy * n >= 0 && y + dy * n < 15 && board[(y + dy * n) * 15 + x + dx * n] === c) n++;
      if (n === 5) return c;
    }
  }
  return board.every(Boolean) ? 3 : 0;
}
export function gomokuMove(s: GomokuState, index: number, who: 1 | 2): boolean {
  if (s.winner || s.turn !== who || !Number.isInteger(index) || index < 0 || index >= 225 || s.board[index]) return false;
  s.board[index] = who; s.moves++; s.winner = gomokuWinner(s.board) as GomokuState["winner"]; s.turn = who === 1 ? 2 : 1; return true;
}
function candidates(board: number[]): number[] {
  if (board.every(v => !v)) return [112];
  return board.map((v, i) => !v && board.some((w, j) => w && Math.abs(j % 15 - i % 15) <= 2 && Math.abs(Math.floor(j / 15) - Math.floor(i / 15)) <= 2) ? i : -1).filter(i => i >= 0);
}
function pointScore(board: number[], at: number, who: number): number {
  const x = at % 15, y = Math.floor(at / 15); let total = 0;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let n = 1, open = 0;
    for (const sign of [-1, 1]) {
      let k = 1;
      while (x + dx * k * sign >= 0 && x + dx * k * sign < 15 && y + dy * k * sign >= 0 && y + dy * k * sign < 15 && board[(y + dy * k * sign) * 15 + x + dx * k * sign] === who) { n++; k++; }
      const xx = x + dx * k * sign, yy = y + dy * k * sign;
      if (xx >= 0 && xx < 15 && yy >= 0 && yy < 15 && !board[yy * 15 + xx]) open++;
    }
    total += n >= 5 ? 10_000_000 : open === 0 ? 0 : n === 4 ? open === 2 ? 300_000 : 40_000 : n === 3 ? open === 2 ? 15_000 : 900 : n === 2 ? open === 2 ? 600 : 50 : open * 5;
  }
  // Score broken four/three patterns, in addition to contiguous runs.
  const copy = [...board]; copy[at] = who;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) for (let start = -4; start <= 0; start++) {
    const line = Array.from({ length: 5 }, (_, k) => { const xx = x + (start + k) * dx, yy = y + (start + k) * dy; return xx < 0 || xx > 14 || yy < 0 || yy > 14 ? -1 : copy[yy * 15 + xx]; });
    if (line.every(c => c === who || c === 0)) { const n = line.filter(c => c === who).length; total += n === 4 ? 6000 : n === 3 ? 250 : 0; }
  }
  return total;
}
export function gomokuAI(s: GomokuState): number {
  if (s.winner || s.turn !== 2) return -1;
  const cs = candidates(s.board);
  for (const who of [2, 1]) for (const at of cs) { const b = [...s.board]; b[at] = who; if (gomokuWinner(b) === who) return at; }
  const rank = cs.map(at => ({ at, score: pointScore(s.board, at, 2) + pointScore(s.board, at, 1) * (s.difficulty === "easy" ? .8 : 1.15) - (Math.abs(at % 15 - 7) + Math.abs(Math.floor(at / 15) - 7)) })).sort((a, b) => b.score - a.score || a.at - b.at);
  if (s.difficulty !== "challenge" || rank.length === 1) return rank[0]?.at ?? -1;
  // Shallow local look-ahead penalizes the opponent's strongest reply. No LLM moves.
  return rank.slice(0, 8).map(r => { const board = [...s.board]; board[r.at] = 2; const danger = Math.max(0, ...candidates(board).map(at => pointScore(board, at, 1))); return { at: r.at, score: r.score - danger * 1.3 }; }).sort((a, b) => b.score - a.score || a.at - b.at)[0].at;
}
export function newFlight(id: string, level: number, interaction: FlightState["interaction"], length: FlightState["length"], now: number): FlightState {
  const count = length === "short" ? 2 : 4;
  return { id, pieces: [Array(count).fill(-1), Array(count).fill(-1)], turn: 0, rolls: 0, sixes: 0, level, interaction, length, eventHistory: [], createdAt: now };
}
export function flightLegal(s: FlightState): number[] {
  if (s.winner !== undefined || !s.dice) return [];
  return s.pieces[s.turn].map((v, i) => v === 57 || v === -1 && s.dice !== 6 ? -1 : i).filter(i => i >= 0);
}
function nextFlightTurn(s: FlightState) { if (s.dice !== 6) { s.turn = s.turn === 0 ? 1 : 0; s.sixes = 0; } s.dice = undefined; }
export function flightRoll(s: FlightState, dice: number): boolean {
  if (s.winner !== undefined || s.dice || !Number.isInteger(dice) || dice < 1 || dice > 6) return false;
  s.rolls++; s.dice = dice; s.sixes = dice === 6 ? s.sixes + 1 : 0;
  if (s.sixes >= 3) { s.dice = 1; nextFlightTurn(s); return true; }
  if (!flightLegal(s).length) nextFlightTurn(s); return true;
}
export function flightDestination(s: FlightState, index: number): number {
  const old = s.pieces[s.turn][index]; if (old === -1) return 0;
  let dest = old + s.dice!; if (dest > 57) dest = 114 - dest;
  if (dest < 52 && dest > 0 && dest % 4 === 0) dest += 4;
  if (dest === 18) dest = 30;
  return dest;
}
const eventPools = [
  ["夸对方一个具体的小习惯。", "想象一起走一段安静的路，会选哪里？", "说一种愿意分给对方的小零食。", "用一句话描述今天的心情，可以不回答。"],
  ["虚拟地牵一下手，也可以只伸出小指。", "如果并肩坐着，你会先说什么？", "说一件让你想靠近对方的小事。", "给下一次见面留一句话。"],
  ["想象雨停前共撑一把伞，写一句对话。", "可以提出一次虚拟拥抱，双方都可以拒绝。", "认真地说一句想念，不必很长。", "用一个细节表达心动，不替对方决定反应。"],
  ["如果愿意，邀请对方靠近一点；不替对方行动。", "给对方写一句直白但尊重边界的心动留言。", "想象一次只属于彼此的约会开场。", "可以提出一个虚拟亲近邀请，也可以说改天。"]
];
export function flightEvent(s: FlightState, mover: number, variant = 0): FlightEvent {
  const pool = eventPools[Math.max(0, Math.min(3, s.level))];
  const index = (hash(s.id + s.rolls) + variant) % pool.length;
  const target = s.interaction === "user" ? "你" : s.interaction === "tease" ? "张起灵" : mover === 0 ? "你" : "张起灵";
  const text = pool[index];
  const reply = /夸|习惯/.test(text) ? "他想了想：你做事时，很认真。" : /牵|靠近|拥抱|亲近/.test(text) ? "他没有替你做决定，只把手放在你够得到的地方：看你。" : /心动|想念|留言/.test(text) ? "他停了一下：想见你，会告诉你。" : "他把棋子摆正，抬眼等你：慢慢想，不急。";
  return { id: `${s.id}:event:${s.rolls}`, text, target, response: target === "张起灵" ? reply : "他安静地等着，没有催促。想跳过也可以。", variant };
}
export function flightMove(s: FlightState, index: number, now: number): boolean {
  if (!flightLegal(s).includes(index)) return false;
  const mover = s.turn; const destination = flightDestination(s, index); s.pieces[mover][index] = destination;
  if (destination < 52) {
    const absolute = (destination + mover * 26) % 52;
    if (absolute !== 0 && absolute !== 26) s.pieces[1 - mover] = s.pieces[1 - mover].map(v => v >= 0 && v < 52 && (v + (1 - mover) * 26) % 52 === absolute ? -1 : v);
  }
  if (s.pieces[mover].every(v => v === 57)) { s.winner = mover; s.finishedAt = now; s.dice = undefined; }
  else nextFlightTurn(s);
  if (destination > 0 && [5, 13, 22, 31, 39, 47, 55, 57].includes(destination) && s.rolls % 2 === 0) {
    s.event = flightEvent(s, mover); s.eventHistory.push(s.event.id); // does not block movement
  }
  return true;
}
export function flightAI(s: FlightState): number {
  const legal = flightLegal(s);
  return legal.map(index => {
    const dest = flightDestination(s, index), absolute = (dest + s.turn * 26) % 52;
    const capture = dest < 52 && absolute !== 0 && absolute !== 26 && s.pieces[1 - s.turn].some(v => v >= 0 && v < 52 && (v + (1 - s.turn) * 26) % 52 === absolute);
    return { index, score: dest === 57 ? 1000 : (capture ? 300 : 0) + (s.pieces[s.turn][index] === -1 ? 150 : dest) };
  }).sort((a, b) => b.score - a.score || a.index - b.index)[0]?.index ?? -1;
}
export function rollDie(): number { const bytes = new Uint32Array(1); do { crypto.getRandomValues(bytes); } while (bytes[0] >= 4_294_967_292); return bytes[0] % 6 + 1; }
