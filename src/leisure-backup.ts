import type { TravelState, PlayState } from "./leisure-types";
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 20_000;
export function validTravel(v: unknown): v is TravelState {
  if (!object(v) || v.version !== 1 || !number(v.createdAt) || !number(v.homeSince) || !number(v.nextDepartureAt) || !text(v.wish) || !object(v.settings)) return false;
  const p = v.settings;
  if (typeof p.enabled !== "boolean" || !Number.isInteger(p.homeMinDays) || !Number.isInteger(p.homeMaxDays) || p.homeMinDays < 1 || p.homeMaxDays > 60 || p.homeMinDays > p.homeMaxDays) return false;
  if (!Array.isArray(v.trips) || !Array.isArray(v.items) || v.trips.length > 5000 || v.items.length > 5000) return false;
  return (p.lengthBias === undefined || ["balanced", "short", "long"].includes(p.lengthBias)) && validJourney(v) && v.trips.every(t => object(t) && text(t.id) && t.id && ["motuo", "market", "ruins", "lake", "tomb", "village", "archive"].includes(t.route) && text(t.destination) && number(t.startedAt) && number(t.endsAt) && (!t.returnedAt || number(t.returnedAt)) && text(t.journalId) && text(t.wish) && Array.isArray(t.itemIds) && t.itemIds.every(text) && Array.isArray(t.photoIds) && t.photoIds.every(text) && (!t.journal || text(t.journal)))
    && v.items.every(i => object(i) && text(i.id) && text(i.tripId) && text(i.title) && ["life", "clue", "relic"].includes(i.category) && ["user", "character", "shared", "record"].includes(i.owner) && ["pending", "kept"].includes(i.status) && typeof i.displayed === "boolean" && text(i.story) && text(i.acquisition) && number(i.createdAt));
}
const routes = ["motuo", "market", "ruins", "lake", "tomb", "village", "archive"];
const unique = (ids: unknown[]) => new Set(ids).size === ids.length;
function validJourney(s: Record<string, any>): boolean {
  if (s.currentId !== undefined && (!text(s.currentId) || !s.trips.some((t: any) => t.id === s.currentId && !t.returnedAt))) return false;
  if (!unique(s.trips.map((t: any) => t?.id)) || !unique(s.items.map((t: any) => t?.id))) return false;
  for (const t of s.trips) if (t?.timeline !== undefined) {
    const p = t.timeline;
    if (!object(p) || p.version !== 1 || !Number.isInteger(p.stage) || p.stage < 0 || p.stage > 3 || !number(p.nextAt) || !number(p.durationMs) || p.durationMs <= 0 || !number(p.delayedMs)) return false;
  }
  if (s.journey === undefined) return !s.trips.some((t: any) => t?.timeline);
  const j = s.journey;
  if (!object(j) || j.version !== 1 || !Array.isArray(j.events) || !Array.isArray(j.threads) || j.events.length > 50000 || j.threads.length > 10000) return false;
  const ids = new Set(j.events.map((e: any) => e?.id)), trips = new Set(s.trips.map((t: any) => t.id));
  if (ids.size !== j.events.length || !unique(j.threads.map((t: any) => t?.id))) return false;
  if (j.plan !== undefined) {
    const p = j.plan;
    if (!object(p) || !text(p.id) || !p.id || trips.has(p.id) || s.currentId || !routes.includes(p.route) || !number(p.notifiedAt) || !number(p.notBefore) || p.notBefore <= p.notifiedAt || !j.events.some((e: any) => e.id === p.noticeEventId && e.tripId === p.id && e.kind === "notice" && e.letter)) return false;
  }
  const nodeIds: string[] = [], messageIds: string[] = [];
  for (const e of j.events) {
    if (!object(e) || !text(e.id) || !e.id || !text(e.tripId) || !e.tripId || !["notice", "departure", "observation", "weather", "detour", "discovery", "association", "return", "photo", "thread"].includes(e.kind) || !text(e.title) || !text(e.text) || !number(e.at) || !number(e.recordedAt) || e.at > e.recordedAt) return false;
    if (!trips.has(e.tripId) && !(e.kind === "notice")) return false;
    if (e.node !== undefined) {
      const n = e.node;
      if (!object(n) || !text(n.id) || !n.id || !text(n.label) || !text(n.region) || !number(n.x) || n.x > 100 || !number(n.y) || n.y > 100 || !s.trips.some((t: any) => t.id === e.tripId && t.timeline)) return false;
      nodeIds.push(n.id);
    }
    if (e.letter !== undefined) { if (!object(e.letter) || !text(e.letter.text) || !text(e.letter.messageId) || !e.letter.messageId) return false; messageIds.push(e.letter.messageId); }
    if (e.mediaIds !== undefined && (!Array.isArray(e.mediaIds) || !e.mediaIds.every(text))) return false;
    if (e.delayMs !== undefined && !number(e.delayMs)) return false;
    if (e.threadId !== undefined && !j.threads.some((t: any) => t.id === e.threadId)) return false;
  }
  return unique(nodeIds) && unique(messageIds) && j.threads.every((t: any) => object(t) && text(t.id) && t.id && text(t.title) && text(t.detail) && ids.has(t.sourceEventId) && ["open", "parked", "resolved", "abandoned"].includes(t.status) && number(t.createdAt) && number(t.updatedAt) && t.updatedAt >= t.createdAt && Array.isArray(t.routes) && t.routes.length > 0 && t.routes.every((r: string) => routes.includes(r)) && Array.isArray(t.tripIds) && unique(t.tripIds) && t.tripIds.every((id: string) => trips.has(id)) && Array.isArray(t.eventIds) && unique(t.eventIds) && t.eventIds.includes(t.sourceEventId) && t.eventIds.every((id: string) => ids.has(id)));
}
function validGame(game: string, s: unknown): boolean {
  if (!object(s) || !text(s.id) || !number(s.createdAt)) return false;
  if (game === "puzzle") return [3, 4, 5].includes(s.size) && text(s.image) && text(s.title) && Array.isArray(s.tiles) && s.tiles.length === s.size ** 2 && new Set(s.tiles).size === s.tiles.length && s.tiles.every((t: number) => Number.isInteger(t) && t >= 0 && t < s.tiles.length) && number(s.moves) && number(s.lastHelpMove) && number(s.hintCount) && (s.collaborative === undefined || typeof s.collaborative === "boolean") && (s.turn === undefined || ["user", "character"].includes(s.turn)) && (s.userMoves === undefined || number(s.userMoves)) && (s.characterMoves === undefined || number(s.characterMoves)) && (s.lastActor === undefined || ["user", "character"].includes(s.lastActor)) && (s.lastAction === undefined || text(s.lastAction)) && (!s.collaborative || s.turn !== undefined && number(s.userMoves) && number(s.characterMoves));
  if (game === "gomoku") return Array.isArray(s.board) && s.board.length === 225 && s.board.every((n: number) => [0, 1, 2].includes(n)) && [1, 2].includes(s.turn) && [0, 1, 2, 3].includes(s.winner) && ["easy", "normal", "challenge"].includes(s.difficulty) && number(s.moves);
  if (game === "flight") return Array.isArray(s.pieces) && s.pieces.length === 2 && s.pieces.every((ps: number[]) => Array.isArray(ps) && [2, 4].includes(ps.length) && ps.every(n => Number.isInteger(n) && n >= -1 && n <= 57)) && [0, 1].includes(s.turn) && (s.winner === undefined || [0, 1].includes(s.winner)) && (s.dice === undefined || [1, 2, 3, 4, 5, 6].includes(s.dice)) && [0, 1, 2, 3].includes(s.level) && ["user", "both", "tease"].includes(s.interaction) && ["short", "normal"].includes(s.length) && number(s.rolls) && number(s.sixes) && Array.isArray(s.eventHistory) && s.eventHistory.every(text) && (!s.event || object(s.event) && text(s.event.id) && text(s.event.text) && text(s.event.response) && text(s.event.target) && number(s.event.variant));
  return false;
}
export function validPlay(v: unknown): v is PlayState {
  if (object(v) && v.dialogue !== undefined && (!Array.isArray(v.dialogue) || v.dialogue.length > 240 || !v.dialogue.every(m => object(m) && text(m.id) && !!m.id && text(m.gameId) && !!m.gameId && ["user", "assistant"].includes(m.role) && text(m.content) && !!m.content.trim() && m.content.length <= 500 && number(m.at)))) return false;
  return object(v) && v.version === 1 && ["puzzle", "gomoku", "flight"].includes(v.active) && Array.isArray(v.completions) && v.completions.every(c => object(c) && text(c.id) && text(c.title) && ["puzzle", "gomoku", "flight"].includes(c.game) && number(c.at) && (!c.puzzle || validGame("puzzle", c.puzzle))) && ["puzzle", "gomoku", "flight"].every(game => v[game] === undefined || validGame(game, v[game])) && (!v.archives || Array.isArray(v.archives) && v.archives.length <= 1000 && v.archives.every(a => object(a) && ["puzzle", "gomoku", "flight"].includes(a.game) && validGame(a.game, a[a.game])));
}
export function mergeTravel(current: TravelState, incoming: TravelState) {
  for (const trip of incoming.trips) {
    const old = current.trips.find(t => t.id === trip.id);
    if (!old) current.trips.push(structuredClone(trip));
    else {
      if (trip.timeline && (!old.timeline || trip.timeline.stage > old.timeline.stage)) old.timeline = structuredClone(trip.timeline);
      old.endsAt = Math.max(old.endsAt, trip.endsAt);
      old.photoIds = [...new Set([...old.photoIds, ...trip.photoIds])];
      // Completion/claim acknowledgements are monotonic, never rewind and re-award after import.
      if (trip.returnedAt && !old.returnedAt) { old.returnedAt = trip.returnedAt; old.journal = trip.journal; old.itemIds = [...new Set([...old.itemIds, ...trip.itemIds])]; }
      old.welcomedAt ||= trip.welcomedAt; old.memoryAt ||= trip.memoryAt; old.sharedAt ||= trip.sharedAt;
    }
  }
  for (const item of incoming.items) {
    const old = current.items.find(i => i.id === item.id);
    if (!old) current.items.push(structuredClone(item));
    else if (item.status === "kept") old.status = "kept";
  }
  if (incoming.journey) {
    const j = current.journey ??= { version: 1, events: [], threads: [] };
    for (const event of incoming.journey.events) if (!j.events.some(e => e.id === event.id)) j.events.push(structuredClone(event));
    j.events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    for (const thread of incoming.journey.threads) {
      const old = j.threads.find(t => t.id === thread.id);
      if (!old) j.threads.push(structuredClone(thread));
      else {
        old.tripIds = [...new Set([...old.tripIds, ...thread.tripIds])]; old.eventIds = [...new Set([...old.eventIds, ...thread.eventIds])];
        if (thread.updatedAt > old.updatedAt) { old.status = thread.status; old.updatedAt = thread.updatedAt; }
      }
    }
    const p = incoming.journey.plan;
    if (!j.plan && !current.currentId && p && !current.trips.some(t => t.id === p.id)) j.plan = structuredClone(p);
  }
  if (current.journey?.plan && (current.currentId || current.trips.some(t => t.id === current.journey!.plan!.id))) current.journey.plan = undefined;
  // Existing schedule/current trip wins. Other unfinished trips stay available for explicit resume.
  current.specialUsed = current.specialUsed || incoming.specialUsed || current.trips.some(t => t.kind === "special");
  if (current.trips.some(t => t.id === current.currentId && t.returnedAt)) { current.currentId = undefined; current.nextDepartureAt = Math.max(current.nextDepartureAt, incoming.nextDepartureAt); }
}
export function mergePlay(current: PlayState, incoming: PlayState) {
  if (incoming.dialogue?.length) {
    const messages = new Map((current.dialogue ?? []).map(m => [m.id, m]));
    for (const m of incoming.dialogue) if (!messages.has(m.id)) messages.set(m.id, structuredClone(m));
    current.dialogue = [...messages.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-240);
  }
  current.archives ??= [];
  for (const game of ["puzzle", "gomoku", "flight"] as const) {
    const from = incoming[game]; if (!from) continue;
    if (!current[game]) Object.assign(current, { [game]: structuredClone(from) });
    else if (current[game]?.id !== from.id && !current.archives.some(a => a[a.game]?.id === from.id)) current.archives.push({ game, [game]: structuredClone(from) });
  }
  for (const a of incoming.archives ?? []) if (current[a.game]?.id !== a[a.game]?.id && !current.archives.some(b => b[b.game]?.id === a[a.game]?.id)) current.archives.push(structuredClone(a));
  for (const c of incoming.completions) {
    const old = current.completions.find(v => v.id === c.id);
    if (!old) current.completions.push(structuredClone(c));
    else { old.memoryAt ||= c.memoryAt; old.puzzle ??= structuredClone(c.puzzle); }
  }
}
