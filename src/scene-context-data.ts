export interface SceneSource { id: string; hash: string }
export interface SceneAbstract {
  id: string; number: number; text: string; sources: SceneSource[];
  from: number; to: number; createdAt: number; enabled: boolean;
}
export interface SceneSummaryDraft {
  fingerprint: string; processed: number; text: string; number: number;
}
export interface SceneContextState {
  version: 1; revision: number; excludedIds: string[]; abstracts: SceneAbstract[];
  draft?: SceneSummaryDraft;
}
export const emptySceneContext = (): SceneContextState => ({ version: 1, revision: 0, excludedIds: [], abstracts: [] });
export const validSceneScope = (key: string) => /^(?:life(?::[\w-]+)?|date:[\w-]+:[\w-]+|theatre:[\w-]+|group-life:[\w-]+|group-date:[\w-]+:[\w-]+|fieldwork:[\w-]+)$/.test(key);
export function sceneRowHash(row: { id: string; content: string; role: string; speakerId?: string }): string {
  let a = 2166136261, b = 5381;
  for (const c of JSON.stringify([row.id, row.content, row.role, row.speakerId])) { const n = c.codePointAt(0)!; a = Math.imul(a ^ n, 16777619); b = Math.imul(b,33) ^ n; }
  return `${a >>> 0}:${b >>> 0}`;
}
export function validSceneContext(input: unknown): input is SceneContextState {
  if (!input || typeof input !== "object") return false;
  const s = input as SceneContextState;
  const sources = (v: unknown): v is SceneSource[] => Array.isArray(v) && v.length <= 100000 && v.every(r => r && typeof r.id === "string" && typeof r.hash === "string");
  return s.version === 1 && Number.isSafeInteger(s.revision) && s.revision >= 0
    && Array.isArray(s.excludedIds) && s.excludedIds.length <= 100000 && s.excludedIds.every(id => typeof id === "string")
    && Array.isArray(s.abstracts) && s.abstracts.length <= 2000 && s.abstracts.every(r => r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= 100000 && Number.isSafeInteger(r.number) && r.number > 0 && Number.isFinite(r.createdAt) && Number.isSafeInteger(r.from) && Number.isSafeInteger(r.to) && r.from >= 1 && r.to >= r.from && typeof r.enabled === "boolean" && sources(r.sources))
    && (!s.draft || (typeof s.draft.fingerprint === "string" && Number.isSafeInteger(s.draft.processed) && s.draft.processed >= 0 && typeof s.draft.text === "string" && s.draft.text.length <= 100000 && Number.isSafeInteger(s.draft.number) && s.draft.number > 0));
}
export function abstractValid(summary: SceneAbstract, rows: Array<{ id: string; content: string; role: string; speakerId?: string }>): boolean {
  const hashes = new Map(rows.map(row => [row.id, sceneRowHash(row)]));
  return summary.sources.length > 0 && summary.sources.every(source => hashes.get(source.id) === source.hash);
}
