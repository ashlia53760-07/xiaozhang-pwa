export interface Trip {
  id: string; route: string; destination: string; kind: "ordinary" | "long" | "special";
  startedAt: number; endsAt: number; returnedAt?: number; journal?: string;
  journalId: string; itemIds: string[]; photoIds: string[]; wish: string;
  welcomedAt?: number; memoryAt?: number; sharedAt?: number;
  timeline?: { version: 1; stage: number; nextAt: number; durationMs: number; delayedMs: number };
}
export interface TravelItem {
  id: string; tripId: string; title: string; category: "life" | "clue" | "relic";
  acquisition: string; owner: "user" | "character" | "shared" | "record";
  status: "pending" | "kept"; displayed: boolean; story: string; createdAt: number;
}
export interface TravelState {
  version: 1; createdAt: number; homeSince: number; nextDepartureAt: number;
  currentId?: string; wish: string;
  settings: { enabled: boolean; homeMinDays: number; homeMaxDays: number; lengthBias?: "balanced" | "short" | "long" };
  trips: Trip[]; items: TravelItem[]; specialUsed?: boolean;
  journey?: {
    version: 1; events: JourneyEvent[]; threads: JourneyThread[];
    plan?: { id: string; route: string; noticeEventId: string; notifiedAt: number; notBefore: number };
  };
}
export interface JourneyEvent {
  id: string; tripId: string; kind: "notice" | "departure" | "observation" | "weather" | "detour" | "discovery" | "association" | "return" | "photo" | "thread";
  title: string; text: string; at: number; recordedAt: number;
  node?: { id: string; label: string; x: number; y: number; region: string };
  letter?: { text: string; messageId: string }; mediaIds?: string[]; threadId?: string; delayMs?: number;
}
export interface JourneyThread {
  id: string; sourceEventId: string; title: string; detail: string; routes: string[];
  status: "open" | "parked" | "resolved" | "abandoned";
  createdAt: number; updatedAt: number; tripIds: string[]; eventIds: string[];
}
export interface PuzzleState {
  id: string; size: number; image: string; title: string; tiles: number[];
  moves: number; hintCount: number; lastHelpMove: number; completedAt?: number; createdAt: number;
  /** Optional fields added for the cooperative, alternating mode. Old puzzles remain valid. */
  collaborative?: boolean;
  turn?: "user" | "character";
  userMoves?: number;
  characterMoves?: number;
  lastActor?: "user" | "character";
  lastAction?: string;
}
export interface GomokuState {
  id: string; board: number[]; turn: 1 | 2; difficulty: "easy" | "normal" | "challenge";
  moves: number; winner: 0 | 1 | 2 | 3; createdAt: number;
}
export interface FlightEvent { id: string; text: string; target: string; response: string; skipped?: boolean; variant: number }
export interface FlightState {
  id: string; pieces: [number[], number[]]; turn: 0 | 1; dice?: number; rolls: number; sixes: number;
  winner?: 0 | 1; level: number; interaction: "user" | "both" | "tease"; length: "short" | "normal";
  event?: FlightEvent; eventHistory: string[]; createdAt: number; finishedAt?: number;
}
export interface GameCompletion { id: string; game: "puzzle" | "gomoku" | "flight"; title: string; at: number; memoryAt?: number; puzzle?: PuzzleState }
export interface PlayState {
  version: 1; active: "puzzle" | "gomoku" | "flight"; puzzle?: PuzzleState; gomoku?: GomokuState; flight?: FlightState;
  completions: GameCompletion[];
  /** Optional, bounded side-talk; belongs to a game, never the daily chat or long-term memory. */
  dialogue?: Array<{ id: string; gameId: string; role: "user" | "assistant"; content: string; at: number }>;
  archives?: Array<{ game: "puzzle" | "gomoku" | "flight"; puzzle?: PuzzleState; gomoku?: GomokuState; flight?: FlightState }>;
}
