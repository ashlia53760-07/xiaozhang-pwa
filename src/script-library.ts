import { characters } from "./characters";
import type { DateSession, GroupRecord, TheatreScript } from "./types";

const scenes = new Set(["walk", "shopping", "movie", "meal", "birthday", "festival", "rain", "night", "snow", "seaside", "camp", "custom"]);
const ids = new Set<string>(characters.map(row => row.id));
const bounded = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
/** Strict allowlist projection: imported instruction sheets cannot carry API credentials. */
export function validTheatreScript(input: unknown): TheatreScript | undefined {
  if (!input || typeof input !== "object") return;
  const row = input as TheatreScript;
  if (!bounded(row.id, 120) || !row.id || !Number.isSafeInteger(row.revision) || row.revision < 0
    || !bounded(row.title, 80) || !row.title.trim() || !scenes.has(row.scene)
    || !bounded(row.setting, 6000) || !row.setting.trim() || !bounded(row.atmosphere, 1000)
    || !bounded(row.arrangement, 4000) || !bounded(row.userName, 60)
    || !["single", "multi"].includes(row.mode) || !Array.isArray(row.characterIds)
    || row.characterIds.length < (row.mode === "multi" ? 2 : 1) || row.characterIds.length > (row.mode === "single" ? 1 : characters.length)
    || row.characterIds.some(id => !ids.has(id)) || new Set(row.characterIds).size !== row.characterIds.length
    || !Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt)
    || row.backgroundMediaId !== undefined && (!bounded(row.backgroundMediaId, 160) || !row.backgroundMediaId)) return;
  return { id: row.id, revision: row.revision, title: row.title.trim(), scene: row.scene, setting: row.setting.trim(),
    atmosphere: row.atmosphere.trim(), arrangement: row.arrangement.trim(), userName: row.userName.trim(), mode: row.mode,
    characterIds: [...row.characterIds], backgroundMediaId: row.backgroundMediaId, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** A temporary cast reuses the scene narrator; it is never inserted into the groups store. */
export function theatreCast(session: DateSession): GroupRecord {
  const script = validTheatreScript(session.scriptSnapshot);
  if (!script) throw Error("这场演出的剧本快照无效，原记录仍保留。");
  return { id: `theatre:${session.id}`, title: session.title, userName: script.userName || "我", background: script.arrangement,
    members: script.characterIds.map(id => { const character = characters.find(row => row.id === id)!;
      return { id, characterId: id, name: character.name, persona: character.persona, enabled: true }; }),
    createdAt: session.createdAt, updatedAt: session.updatedAt };
}

/** Recover an old instruction sheet without copying its chat, memories or public group background. */
export function scriptFromPerformance(session: DateSession, groups: GroupRecord[]): TheatreScript {
  const snapshot = validTheatreScript(session.scriptSnapshot);
  if (snapshot) return { ...snapshot, id: "", revision: 0, characterIds: [...snapshot.characterIds] };
  const group = groups.find(row => row.id === session.groupId);
  const cast = group ? group.members.filter(row => !session.memberIds || session.memberIds.includes(row.id))
    .map(row => row.characterId ?? characters.find(character => character.name === row.name)?.id).filter((id): id is string => !!id && ids.has(id))
    : [session.characterId || "zhang-qiling"];
  const characterIds = [...new Set(cast)].filter(id => ids.has(id));
  if (!characterIds.length) characterIds.push("zhang-qiling");
  return { id: "", revision: 0, title: session.title.slice(0, 80), scene: session.scene, setting: session.setting.slice(0, 6000), atmosphere: session.atmosphere.slice(0, 1000),
    arrangement: "", userName: "", mode: characterIds.length > 1 ? "multi" : "single", characterIds,
    backgroundMediaId: session.backgroundMediaId, createdAt: Date.now(), updatedAt: Date.now() };
}
