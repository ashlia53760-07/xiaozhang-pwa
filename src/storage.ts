import type { ApiProfile, AudioAnalysisProfile, BirthdaySettings, CharacterSettings, ChatMessage, CustomGift, DateSession, DiaryRecord, FieldworkData, GameModelProfile, GroupRecord, ImageProfile, InteractionRecord, LifeEventRecord, LifeSceneState, MediaRecord, MemoryRecord, MomentRecord, MusicTrack, StickerRecord, TtsProfile } from "./types";
import type { TravelState, PlayState } from "./leisure-types";
import { characters, PRIMARY_CHARACTER, emptyCharacterSettings, ownsCharacter, characterById, lifeSession } from "./characters";
import type { ContactPreferences, SharedCharacterSettings } from "./types";
import { normalizeLegacyGroup } from "./groups";
import { emptyCalendar, validCalendar, type CalendarData } from "./calendar";

export interface LeisureEffects { messages?: ChatMessage[]; diary?: DiaryRecord[]; lifeEvents?: LifeEventRecord[]; memories?: MemoryRecord[]; moments?: MomentRecord[] }
export type SceneFloorScope = { kind: "life"; characterId: string } | { kind: "date"; characterId: string; id: string } | { kind: "adventure"; id: string };
export type SceneFloorRow = Pick<ChatMessage, "id" | "role" | "content" | "createdAt" | "speakerId" | "metadata">;
export type SceneFloorChange = { type: "edit"; content: string } | { type: "rewind" };
function floorSignature(rows: SceneFloorRow[]): string {
  return JSON.stringify(rows.map(row => [row.id, row.role, row.content, row.createdAt, row.speakerId]));
}

const DB_NAME = "xiaozhang-pwa";
const DB_VERSION = 4;
const PROFILE_KEY = "api-profile";
const IMAGE_PROFILE_KEY = "image-profile";
const BACKGROUND_KEY = "chat-background";
const AFFECTION_KEY = "affection-state";
const USER_AVATAR_KEY = "user-avatar";
const CHARACTER_AVATAR_KEY = "character-avatar";
const NPC_AVATARS_KEY = "npc-avatars";
const MOMENT_COVER_KEY = "moment-cover";
const MUSIC_TRACKS_KEY = "music-tracks";
const MUSIC_ACTIVE_KEY = "music-active";
const AUDIO_ANALYSIS_PROFILE_KEY = "audio-analysis-profile";
const GAME_MODEL_PROFILE_KEY = "game-model-profile";
const CUSTOM_GIFTS_KEY = "custom-gifts";
const CONTINUOUS_LIFE_KEY = "continuous-life";
const DATE_SESSIONS_KEY = "date-sessions";
const VIDEO_CALL_BACKGROUND_KEY = "video-call-background";
const SOCIAL_AUTOMATION_KEY = "social-automation-state";
const BIRTHDAY_SETTINGS_KEY = "birthday-settings";
const BIRTHDAY_CLAIMS_KEY = "birthday-claims";

export interface SocialAutomationState {
  momentNextAt?: number;
  momentClaimedAt?: number;
  momentLastAuthor?: string;
  diaryDay?: string;
  diaryRetryAt?: number;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("本地存储读取失败"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("本地存储写入失败"));
    tx.onabort = () => reject(tx.error ?? new Error("本地存储写入被取消"));
  });
}

const ARCHIVE_POINTER = "xiaozhang-relationship-archive";
const LEGACY_ARCHIVE = "original";
const storedArchive = sessionStorage.getItem(ARCHIVE_POINTER) ?? localStorage.getItem(ARCHIVE_POINTER) ?? LEGACY_ARCHIVE;
// A page keeps one immutable database binding. Replies in another tab cannot cross archives.
const pageArchiveId = /^(original|archive-[a-z0-9-]{10,80})$/.test(storedArchive) ? storedArchive : LEGACY_ARCHIVE;
sessionStorage.setItem(ARCHIVE_POINTER, pageArchiveId);
const databases = new Map<string, Promise<IDBDatabase>>();
function archiveDatabaseName(id: string) { return id === LEGACY_ARCHIVE ? DB_NAME : `${DB_NAME}-${id}`; }
function openDatabase(name: string): Promise<IDBDatabase> {
  const cached = databases.get(name);
  if (cached) return cached;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const value = open.result;
      if (!value.objectStoreNames.contains("kv")) value.createObjectStore("kv", { keyPath: "key" });
      if (!value.objectStoreNames.contains("messages")) {
        const store = value.createObjectStore("messages", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!value.objectStoreNames.contains("media")) value.createObjectStore("media", { keyPath: "id" });
      if (!value.objectStoreNames.contains("stickers")) value.createObjectStore("stickers", { keyPath: "id" });
      if (!value.objectStoreNames.contains("memories")) value.createObjectStore("memories", { keyPath: "id" });
      if (!value.objectStoreNames.contains("experiences")) value.createObjectStore("experiences", { keyPath: "id" });
      if (!value.objectStoreNames.contains("moments")) value.createObjectStore("moments", { keyPath: "id" });
      if (!value.objectStoreNames.contains("affection")) value.createObjectStore("affection", { keyPath: "id" });
      if (!value.objectStoreNames.contains("interactions")) {
        const store = value.createObjectStore("interactions", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!value.objectStoreNames.contains("lifeEvents")) {
        const store = value.createObjectStore("lifeEvents", { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!value.objectStoreNames.contains("groups")) value.createObjectStore("groups", { keyPath: "id" });
      if (!value.objectStoreNames.contains("diary")) {
        const store = value.createObjectStore("diary", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    open.onsuccess = () => { open.result.onversionchange = () => { open.result.close(); databases.delete(name); }; resolve(open.result); };
    open.onerror = () => reject(open.error ?? new Error("无法打开本地数据库"));
    open.onblocked = () => reject(new Error("请关闭其他旧版本页面后重试，本地记录尚未更改"));
  });
  databases.set(name, promise);
  void promise.catch(() => databases.delete(name));
  return promise;
}
function db(): Promise<IDBDatabase> { return openDatabase(archiveDatabaseName(pageArchiveId)); }
function sharedDb(): Promise<IDBDatabase> { return openDatabase(DB_NAME); }

const SHARED_KEYS = new Set([PROFILE_KEY, IMAGE_PROFILE_KEY, "tts-profile", AUDIO_ANALYSIS_PROFILE_KEY, GAME_MODEL_PROFILE_KEY,
  BACKGROUND_KEY, USER_AVATAR_KEY, CHARACTER_AVATAR_KEY, NPC_AVATARS_KEY, MOMENT_COVER_KEY, VIDEO_CALL_BACKGROUND_KEY, CUSTOM_GIFTS_KEY]);
function sharedKey(key: string) { return SHARED_KEYS.has(key) || key.startsWith("contact-service:") || key.startsWith("archive-meta:"); }

async function readKv<T>(key: string): Promise<T | undefined> {
  const value = await (sharedKey(key) ? sharedDb() : db());
  const tx = value.transaction("kv", "readonly");
  const row = await request(tx.objectStore("kv").get(key) as IDBRequest<{ key: string; value: T } | undefined>);
  return row?.value;
}

async function writeKv<T>(key: string, value: T): Promise<void> {
  const database = await (sharedKey(key) ? sharedDb() : db());
  const tx = database.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key, value });
  await transactionDone(tx);
}

export interface RelationshipArchive {
  id: string;
  name: string;
  kind: "live" | "checkpoint";
  createdAt: number;
  sourceId?: string;
  reason?: string;
  messageCount: number;
  memoryCount: number;
  /** Soft-deleted archives stay recoverable in the local recycle bin. */
  archivedAt?: number;
}
const RELATION_STORES = ["kv", "messages", "memories", "experiences", "moments", "affection", "interactions", "lifeEvents", "groups", "diary"] as const;
type RelationStore = typeof RELATION_STORES[number];
type ArchiveRows = Record<RelationStore, Array<Record<string, unknown>>>;
export interface RelationshipArchiveFile {
  format: "xiaozhang-relationship-archive";
  version: 1;
  archive: RelationshipArchive;
  rows: ArchiveRows;
  media: Array<{ id: string; data: string; mime: string; origin: string; createdAt: number }>;
  stickers: StickerRecord[];
}
function cleanArchiveKv(rows: ArchiveRows["kv"]): ArchiveRows["kv"] {
  return rows.filter(row => typeof row.key === "string" && !sharedKey(row.key)
    && /^(?:calendar-data|character-settings|birthday-settings|birthday-claims|affection-state|music-tracks|music-active|continuous-life(?::[^\s]+)?|date-sessions|fieldwork-data|active-session|travel-state|play-state|social-automation-state|starter-moments-seeded|contact:[^\s]+|draft:[^\s]+|read:[^\s]+|conversation-revision:[^\s]+)$/.test(row.key)).map(row => {
      if (!String(row.key).startsWith("contact:")) return row;
      const prefs = row.value as ContactPreferences;
      return { key: row.key, value: { settings: prefs.settings, affection: prefs.affection, updatedAt: prefs.updatedAt } };
    });
}
async function readArchiveRows(database: IDBDatabase): Promise<ArchiveRows> {
  // Read all stores in the same transaction: a checkpoint cannot contain half of a reply.
  const tx = database.transaction([...RELATION_STORES], "readonly");
  const done = transactionDone(tx);
  const reads = RELATION_STORES.map(name => request(tx.objectStore(name).getAll()));
  const values = await Promise.all(reads);
  await done;
  const rows = Object.fromEntries(RELATION_STORES.map((name, index) => [name, values[index]])) as ArchiveRows;
  rows.kv = cleanArchiveKv(rows.kv);
  return rows;
}
async function writeArchiveRows(database: IDBDatabase, rows: ArchiveRows): Promise<void> {
  const tx = database.transaction([...RELATION_STORES], "readwrite");
  for (const name of RELATION_STORES) for (const row of rows[name]) tx.objectStore(name).add(row);
  await transactionDone(tx);
}
function bumpConversationRevision(tx: IDBTransaction, session: string) {
  const store = tx.objectStore("kv"), key = `conversation-revision:${session}`;
  const get = store.get(key); get.onsuccess = () => store.put({ key, value: (Number(get.result?.value) || 0) + 1 });
}
function invalidateConversation(tx: IDBTransaction, removedIds: Set<string>, removedTexts: string[], session?: string) {
  const messages = tx.objectStore("messages").openCursor();
  messages.onsuccess = () => {
    const row = messages.result; if (!row) return;
    const message = row.value as ChatMessage;
    const quote = message.metadata?.groupQuote as { messageId?: string } | undefined;
    if (quote?.messageId && removedIds.has(quote.messageId)) {
      message.metadata = { ...message.metadata, groupQuote: undefined }; row.update(message);
    }
    row.continue();
  };
  const cursor = tx.objectStore("kv").openCursor();
  cursor.onsuccess = () => {
    const row = cursor.result; if (!row) return;
    if (/^context-(?:summary|lease):/.test(String(row.key))) row.delete();
    if (session && row.key === `draft:${session}`) row.delete();
    row.continue();
  };
  const memoryCursor = tx.objectStore("memories").openCursor();
  memoryCursor.onsuccess = () => {
    const row = memoryCursor.result; if (!row) return;
    const memory = row.value as MemoryRecord;
    const related = memory.sourceMessageIds?.some(id => removedIds.has(id))
      || (memory.source === "conversation" && !memory.sourceMessageIds?.length);
    const possiblyManual = memory.source !== "conversation" && (memory.sourceMessageIds?.some(id => removedIds.has(id))
      || removedTexts.some(text => text.length >= 6 && (memory.content.includes(text) || text.includes(memory.content))));
    if (related || possiblyManual) {
      memory.reviewReason = "来源对话已撤回或分支调整，请核对这条记忆";
      if (memory.source === "conversation") memory.enabled = false;
      row.update(memory);
    }
    row.continue();
  };
  const groups = tx.objectStore("groups").openCursor();
  groups.onsuccess = () => {
    const row = groups.result; if (!row) return;
    const group = row.value as GroupRecord;
    // Source-linked public memories/favorites must not re-inject a withdrawn quote.
    group.memories = group.memories?.map(m => m.messageIds?.some(id => removedIds.has(id))
      ? { ...m, enabled: m.source === "conversation" ? false : m.enabled, reviewReason: "来源消息已调整，请核对" } : m);
    group.favorites = group.favorites?.filter(m => !removedIds.has(m.messageId));
    row.update(group); row.continue();
  };
}

export const storage = {
  activeArchiveId(): string { return pageArchiveId; },
  async ensureArchive(): Promise<void> {
    if (!await readKv<RelationshipArchive>(`archive-meta:${LEGACY_ARCHIVE}`)) {
      await writeKv(`archive-meta:${LEGACY_ARCHIVE}`, { id: LEGACY_ARCHIVE, name: "最初的我们", kind: "live", createdAt: Date.now(), messageCount: 0, memoryCount: 0 } satisfies RelationshipArchive);
    }
    if (pageArchiveId !== LEGACY_ARCHIVE) {
      const meta = await readKv<RelationshipArchive>(`archive-meta:${pageArchiveId}`);
      if (!meta || meta.kind !== "live" || meta.archivedAt) {
        sessionStorage.setItem(ARCHIVE_POINTER, LEGACY_ARCHIVE); localStorage.setItem(ARCHIVE_POINTER, LEGACY_ARCHIVE);
        location.reload(); throw Error("档案未找到，正在返回原始档案；记录未清空");
      }
    }
  },
  async archives(includeArchived = false): Promise<RelationshipArchive[]> {
    await this.ensureArchive();
    const values = await request((await sharedDb()).transaction("kv", "readonly").objectStore("kv").getAll());
    return values.filter(row => row.key.startsWith("archive-meta:")).map(row => row.value as RelationshipArchive)
      .filter(value => includeArchived || !value.archivedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async renameArchive(id: string, name: string): Promise<void> {
    const value = await readKv<RelationshipArchive>(`archive-meta:${id}`);
    if (!value) throw Error("找不到这份档案");
    name = name.trim().slice(0, 60); if (!name) throw Error("请填写档案名称");
    await writeKv(`archive-meta:${id}`, { ...value, name });
  },
  async archiveToRecycleBin(id: string): Promise<void> {
    if (!id || id === LEGACY_ARCHIVE || id === pageArchiveId) throw Error("当前档案不能删除，请先切换到其他档案");
    const value = await readKv<RelationshipArchive>(`archive-meta:${id}`);
    if (!value) throw Error("找不到关系档案");
    if (value.archivedAt) return;
    await writeKv(`archive-meta:${id}`, { ...value, archivedAt: Date.now() });
  },
  async restoreArchivedArchive(id: string): Promise<void> {
    const value = await readKv<RelationshipArchive>(`archive-meta:${id}`);
    if (!value || !value.archivedAt) throw Error("找不到回收站档案");
    const { archivedAt: _archivedAt, ...active } = value;
    await writeKv(`archive-meta:${id}`, active);
  },
  async archiveStats(): Promise<{ messages: number; memories: number }> {
    return { messages: (await this.messages()).length, memories: (await this.allMemories()).length };
  },
  async makeArchive(name: string, mode: "fresh" | "checkpoint" | "fork", sourceId = pageArchiveId, keepIdentity = true): Promise<RelationshipArchive> {
    await this.ensureArchive();
    if (mode !== "fresh" && !await readKv(`archive-meta:${sourceId}`)) throw Error("源档案不存在，未创建新档案");
    const rows = mode === "fresh"
      ? Object.fromEntries(RELATION_STORES.map(key => [key, []])) as unknown as ArchiveRows
      : await readArchiveRows(await openDatabase(archiveDatabaseName(sourceId)));
    if (mode === "fresh") {
      if (keepIdentity) {
        const primary = await this.characterSettings();
        rows.kv.push({ key: "character-settings", value: { ...emptyCharacterSettings(), userName: primary.userName, userPreferences: primary.userPreferences } });
        const current = await readArchiveRows(await db());
        for (const row of current.kv.filter(row => String(row.key).startsWith("contact:"))) {
          const old = (row.value as ContactPreferences).settings;
          if (old) rows.kv.push({ key: row.key, value: { settings: { ...emptyCharacterSettings(), userName: old.userName, userPreferences: old.userPreferences }, updatedAt: Date.now() } });
        }
      }
      // Reuse the playlist and audio references, never a former partner's feedback cache.
      const tracks = (await this.musicTracks()).map(track => ({ ...track, feedback: undefined, feedbackByCharacter: undefined, feedbackSentAt: undefined }));
      rows.kv.push({ key: MUSIC_TRACKS_KEY, value: tracks });
    }
    const value: RelationshipArchive = { id: `archive-${crypto.randomUUID()}`, name: name.trim().slice(0, 60) || "新的我们", kind: mode === "checkpoint" ? "checkpoint" : "live",
      createdAt: Date.now(), sourceId: mode === "fresh" ? undefined : sourceId,
      messageCount: rows.messages.length, memoryCount: rows.memories.length };
    await writeArchiveRows(await openDatabase(archiveDatabaseName(value.id)), rows);
    // Publish only after the complete snapshot commits; failed quota writes don't expose partial archives.
    await writeKv(`archive-meta:${value.id}`, value);
    return value;
  },
  async selectArchive(id: string): Promise<void> {
    const value = await readKv<RelationshipArchive>(`archive-meta:${id}`);
    if (!value || value.kind !== "live") throw Error("请先将这个保存节点恢复为新分支");
    sessionStorage.setItem(ARCHIVE_POINTER, id); localStorage.setItem(ARCHIVE_POINTER, id);
    // Caller reloads the page. Never mutate the database binding under an in-flight operation.
  },
  async exportArchive(id: string): Promise<RelationshipArchiveFile> {
    const archive = await readKv<RelationshipArchive>(`archive-meta:${id}`);
    if (!archive) throw Error("找不到这份档案");
    const rows = await readArchiveRows(await openDatabase(archiveDatabaseName(id)));
    const strings = new Set<string>();
    const visit = (value: unknown): void => { if (typeof value === "string") strings.add(value); else if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") Object.values(value).forEach(visit); };
    visit(rows);
    const stickers = await this.stickers(); stickers.forEach(s => strings.add(s.mediaId));
    const records = await this.mediaRecords([...strings]);
    const media = await Promise.all(records.map(async record => ({ id: record.id, mime: record.mime, origin: record.origin, createdAt: record.createdAt,
      data: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error("附件读取失败")); reader.readAsDataURL(record.blob); }) })));
    return { format: "xiaozhang-relationship-archive", version: 1, archive: { ...archive, messageCount: rows.messages.length, memoryCount: rows.memories.length }, rows, media, stickers };
  },
  async importArchive(payload: RelationshipArchiveFile): Promise<RelationshipArchive> {
    if (payload?.format !== "xiaozhang-relationship-archive" || payload.version !== 1 || !payload.rows || !payload.archive?.name) throw Error("不是有效的关系档案文件");
    for (const name of RELATION_STORES) {
      if (!Array.isArray(payload.rows[name]) || payload.rows[name].some(row => !row || typeof row !== "object" || typeof row[name === "kv" ? "key" : "id"] !== "string")) throw Error("档案结构不完整，未导入");
    }
    for (const name of RELATION_STORES) {
      const keys = payload.rows[name].map(row => row[name === "kv" ? "key" : "id"]);
      if (new Set(keys).size !== keys.length) throw Error("档案包含重复记录，未导入");
    }
    const rows = structuredClone(payload.rows); rows.kv = cleanArchiveKv(rows.kv);
    // Portable archives cannot smuggle a model key or overwrite any shared service configuration.
    rows.kv = rows.kv.filter(row => !sharedKey(String(row.key)));
    const attachments: MediaRecord[] = [];
    for (const value of payload.media ?? []) {
      if (!value?.id || typeof value.data !== "string" || !/^data:[^,]*;base64,/.test(value.data)) throw Error("档案包含无效附件");
      const blob = await (await fetch(value.data)).blob();
      attachments.push({ id: value.id, blob, mime: value.mime, origin: value.origin, createdAt: value.createdAt });
    }

    const meta: RelationshipArchive = { id: `archive-${crypto.randomUUID()}`, name: `${payload.archive.name.slice(0, 50)} · 导入`, kind: "live", createdAt: Date.now(), messageCount: rows.messages.length, memoryCount: rows.memories.length };
    await writeArchiveRows(await openDatabase(archiveDatabaseName(meta.id)), rows);
    for (const attachment of attachments) await this.mergeRecord("media", attachment);
    for (const value of payload.stickers ?? []) if (value?.id && value.mediaId && value.label) await this.mergeRecord("stickers", value);
    await writeKv(`archive-meta:${meta.id}`, meta);
    return meta;
  },
  conversationRevision(session: string): Promise<number | undefined> { return readKv<number>(`conversation-revision:${session}`); },
  async retractMessage(id: string, wholeReply = false): Promise<{ count: number; reviewCount: number }> {
    const rows = await this.rawMessages();
    const target = rows.find(row => row.id === id);
    if (!target || target.metadata?.retractedAt || target.metadata?.hiddenAt) throw Error("这条消息已调整，请刷新后再试");
    if (target.metadata?.event === "pet_interaction") throw Error("互动结算请使用存档恢复，不能作为普通消息撤回");
    const selected = rows.filter(row => row.id === id || (wholeReply && target.metadata?.replyBatchId && row.metadata?.replyBatchId === target.metadata.replyBatchId
      && row.sessionId === target.sessionId && row.speakerId === target.speakerId));
    const tx = (await db()).transaction(["messages", "kv", "memories", "groups"], "readwrite");
    const removedIds = new Set(selected.map(row => row.id));
    const at = Date.now();
    for (const row of selected) tx.objectStore("messages").put({ ...row, metadata: { ...row.metadata, retractedAt: at } });
    bumpConversationRevision(tx, target.sessionId ?? "private");
    invalidateConversation(tx, removedIds, selected.map(row => row.content));
    await transactionDone(tx);
    return { count: selected.length, reviewCount: (await this.allMemories()).filter(m => m.reviewReason).length };
  },
  async branchConversation(id: string): Promise<RelationshipArchive> {
    const rows = await this.rawMessages();
    const index = rows.findIndex(row => row.id === id && !row.metadata?.hiddenAt && !row.metadata?.retractedAt);
    if (index < 0) throw Error("找不到这条消息");
    const target = rows[index], session = target.sessionId ?? "private";
    // Branch before the selected logical reply, so one reply batch is never cut in half.
    const batch = target.metadata?.replyBatchId;
    const start = batch ? rows.findIndex(row => row.metadata?.replyBatchId === batch && (row.sessionId ?? "private") === session) : index;
    const removed = rows.slice(start).filter(row => (row.sessionId ?? "private") === session && row.metadata?.event !== "pet_interaction");
    const checkpoint = await this.makeArchive(`重新聊之前 · ${new Date().toLocaleString()}`, "checkpoint");
    const tx = (await db()).transaction(["messages", "kv", "memories", "groups"], "readwrite");
    const at = Date.now();
    for (const row of removed) tx.objectStore("messages").put({ ...row, metadata: { ...row.metadata, hiddenAt: at, branchArchiveId: checkpoint.id } });
    bumpConversationRevision(tx, session);
    invalidateConversation(tx, new Set(removed.map(row => row.id)), removed.map(row => row.content), session);
    await transactionDone(tx);
    return checkpoint;
  },
  contextCache<T>(key: string): Promise<T | undefined> { return readKv<T>(key); },
  saveContextCache<T>(key: string, value: T): Promise<void> { return writeKv(key, value); },
  /** IndexedDB transaction lease prevents duplicate paid summaries in different tabs. */
  async claimContextLease(scope: string): Promise<string | undefined> {
    const tx = (await db()).transaction("kv", "readwrite"), store = tx.objectStore("kv");
    const token = newId("summary-lease");
    let acquired = false;
    const get = store.get(`context-lease:${scope}`);
    get.onsuccess = () => {
      if ((get.result?.value?.until ?? 0) > Date.now()) return;
      acquired = true; store.put({ key: `context-lease:${scope}`, value: { token, until: Date.now() + 30_000 } });
    };
    await transactionDone(tx);
    return acquired ? token : undefined;
  },
  async releaseContextLease(scope: string, token: string): Promise<void> {
    const tx = (await db()).transaction("kv", "readwrite"), store = tx.objectStore("kv");
    const get = store.get(`context-lease:${scope}`);
    get.onsuccess = () => { if (get.result?.value?.token === token) store.delete(`context-lease:${scope}`); };
    await transactionDone(tx);
  },
  async hasSetting(key: string): Promise<boolean> { return (await request((await (sharedKey(key) ? sharedDb() : db())).transaction("kv", "readonly").objectStore("kv").get(key))) !== undefined; },
  async contactPreferences(id: string): Promise<ContactPreferences> {
    const local = (await readKv<ContactPreferences>(`contact:${id}`)) ?? { updatedAt: 0 };
    const shared = await readKv<Pick<ContactPreferences, "api" | "voiceIds">>(`contact-service:${id}`);
    const legacy = pageArchiveId !== LEGACY_ARCHIVE && !shared ? await request((await sharedDb()).transaction("kv", "readonly").objectStore("kv").get(`contact:${id}`)) : undefined;
    return { ...local, api: shared ? shared.api : legacy?.value?.api ?? local.api, voiceIds: shared ? shared.voiceIds : legacy?.value?.voiceIds ?? local.voiceIds };
  },
  async saveContactPreferences(id: string, value: ContactPreferences): Promise<void> {
    await writeKv(`contact-service:${id}`, { api: value.api, voiceIds: value.voiceIds });
    await writeKv(`contact:${id}`, { remark: typeof value.remark === "string" ? value.remark.trim().slice(0, 40) : undefined, settings: value.settings, affection: value.affection, updatedAt: value.updatedAt });
  },
  async contactSettings(id: string): Promise<CharacterSettings> {
    return id === PRIMARY_CHARACTER ? this.characterSettings() : (await this.contactPreferences(id)).settings ?? emptyCharacterSettings();
  },
  async saveContactSettings(id: string, settings: CharacterSettings): Promise<void> {
    if (id === PRIMARY_CHARACTER) return this.saveCharacterSettings(settings);
    await this.saveContactPreferences(id, { ...await this.contactPreferences(id), settings, updatedAt: Date.now() });
  },
  /** One-time copy within this archive; whitelist keeps relationships and service data separate. */
  async syncSharedSettingsToAll(source: SharedCharacterSettings): Promise<number> {
    const shared: SharedCharacterSettings = {
      userName: source.userName, userPreferences: source.userPreferences,
      customPrompt: source.customPrompt, worldBook: source.worldBook,
      lifeSupplementPrompt: source.lifeSupplementPrompt ?? "", dateSupplementPrompt: source.dateSupplementPrompt ?? "",
      lifeTheatreEnabled: source.lifeTheatreEnabled === true, dateTheatreEnabled: source.dateTheatreEnabled !== false,
      dateXpRelationship: source.dateXpRelationship ?? "", dateObserverRequests: source.dateObserverRequests ?? "",
      dateStyleRequirements: source.dateStyleRequirements ?? ""
    };
    const tx = (await db()).transaction("kv", "readwrite");
    const done = transactionDone(tx), store = tx.objectStore("kv"), updatedAt = Date.now();
    for (const character of characters) {
      const primary = character.id === PRIMARY_CHARACTER;
      const key = primary ? "character-settings" : `contact:${character.id}`;
      const get = store.get(key);
      get.onsuccess = () => {
        const row = get.result;
        const previous = row?.value;
        const settings = { ...emptyCharacterSettings(), ...(primary ? previous : previous?.settings), ...shared, updatedAt };
        store.put({ ...row, key, value: primary ? settings : { ...previous, settings, updatedAt } });
      };
    }
    await done;
    return characters.length;
  },
  async contactProfile(id: string): Promise<ApiProfile> { return (await this.contactPreferences(id)).api ?? this.profile(); },
  async contactTtsProfile(id: string): Promise<TtsProfile> {
    const [profile, prefs] = await Promise.all([this.ttsProfile(), this.contactPreferences(id)]);
    const voiceId = prefs.voiceIds?.[profile.provider];
    return { ...profile, voiceId: typeof voiceId === "string" && voiceId.trim() ? voiceId.trim() : profile.voiceId };
  },
  async contactMemories(id: string): Promise<MemoryRecord[]> { return (await this.memories()).filter(value => ownsCharacter(value, id)); },
  async contactAvatar(id: string): Promise<MediaRecord | undefined> {
    if (id === PRIMARY_CHARACTER) return this.characterAvatar();
    const mediaId = (await this.npcAvatars())[characterById(id).avatarName];
    return mediaId ? this.media(mediaId) : undefined;
  },
  async contactAffection(id: string): Promise<number> { return id === PRIMARY_CHARACTER ? (await this.affection()).value : (await this.contactPreferences(id)).affection ?? 0; },
  async addContactAffection(id: string, gain = 1): Promise<number> {
    if (id === PRIMARY_CHARACTER) return this.addAffection(gain);
    const prefs = await this.contactPreferences(id);
    const value = Math.min(100, (prefs.affection ?? 0) + Math.max(0, gain));
    await this.saveContactPreferences(id, { ...prefs, affection: value, updatedAt: Date.now() });
    return value;
  },
  async draft(session: string): Promise<string> { return await readKv<string>(`draft:${session}`) ?? ""; },
  saveDraft(session: string, value: string): Promise<void> { return writeKv(`draft:${session}`, value.slice(0, 4000)); },
  async lastRead(session: string): Promise<number> { return await readKv<number>(`read:${session}`) ?? 0; },
  markRead(session: string): Promise<void> { return writeKv(`read:${session}`, Date.now()); },
  async contactBackup(): Promise<{ contacts: Record<string, Omit<ContactPreferences, "api"> & { api?: Omit<ApiProfile, "apiKey"> }>; drafts: Record<string, string>; life: Record<string, LifeSceneState> }> {
    const database = await db();
    const rows = await request(database.transaction("kv", "readonly").objectStore("kv").getAll()) as Array<{ key: string; value: unknown }>;
    const contacts: Record<string, Omit<ContactPreferences, "api"> & { api?: Omit<ApiProfile, "apiKey"> }> = {}, drafts: Record<string, string> = {}, life: Record<string, LifeSceneState> = {};
    for (const row of rows) {
      if (row.key.startsWith("contact:")) {
        const value = await this.contactPreferences(row.key.slice(8));
        // Explicit allowlist: API keys are never exported, even in a per-contact override.
        contacts[row.key.slice(8)] = { remark: value.remark, settings: value.settings, affection: value.affection, updatedAt: value.updatedAt,
          voiceIds: value.voiceIds ? { minimax: value.voiceIds.minimax, elevenlabs: value.voiceIds.elevenlabs } : undefined,
          api: value.api ? { baseUrl: value.api.baseUrl, model: value.api.model, temperature: value.api.temperature, protocol: value.api.protocol } : undefined };
      }
      if (row.key.startsWith("draft:")) drafts[row.key.slice(6)] = String(row.value ?? "");
      if (row.key.startsWith("continuous-life:")) life[row.key.slice(16)] = row.value as LifeSceneState;
    }
    return { contacts, drafts, life };
  },
  /** Backup collisions preserve local rows; restoring a file never replaces newer local edits. */
  async mergeRecord(store: "messages" | "memories" | "media" | "stickers" | "moments" | "diary" | "interactions" | "lifeEvents" | "groups", value: { id: string }): Promise<void> {
    const database = await (store === "media" || store === "stickers" ? sharedDb() : db());
    const tx = database.transaction(store, "readwrite"), rows = tx.objectStore(store);
    const get = rows.get(value.id);
    get.onsuccess = () => { if (!get.result) rows.put(value); };
    await transactionDone(tx);
  },
  async leisure<T extends TravelState | PlayState>(key: "travel-state" | "play-state"): Promise<T | undefined> { return readKv<T>(key); },
  async fieldwork<T extends FieldworkData>(): Promise<T | undefined> { return readKv<T>("fieldwork-data"); },
  saveFieldwork<T extends FieldworkData>(value: T): Promise<void> { return writeKv("fieldwork-data", value); },
  /** Serialize read/modify/write across tabs; write resulting events in the same transaction. */
  async changeLeisure<T extends TravelState | PlayState>(key: "travel-state" | "play-state", initial: () => T, change: (state: T) => LeisureEffects | void): Promise<T> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(["kv", "messages", "diary", "lifeEvents", "memories", "moments"], "readwrite");
      let result: T; let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error("本地记录保存失败，未提交本次操作"));
      const get = tx.objectStore("kv").get(key);
      get.onsuccess = () => {
        try {
          result = (get.result?.value as T | undefined) ?? initial();
          const effects = change(result);
          tx.objectStore("kv").put({ key, value: result });
          if (effects) for (const name of ["messages", "diary", "lifeEvents", "memories", "moments"] as const) {
            for (const value of effects[name] ?? []) tx.objectStore(name).put(value);
          }
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  },
  async rawMessages(): Promise<ChatMessage[]> {
    const database = await db();
    const rows = await request(database.transaction("messages", "readonly").objectStore("messages").getAll());
    return (rows as ChatMessage[]).sort((a, b) => a.createdAt - b.createdAt);
  },
  async messages(): Promise<ChatMessage[]> {
    return (await this.rawMessages()).filter(row => !row.metadata?.retractedAt && !row.metadata?.hiddenAt);
  },
  async addMessage(message: ChatMessage): Promise<void> {
    return this.addMessages([message]);
  },
  async addMessages(messages: ChatMessage[], guard?: { session: string; revision: number }): Promise<void> {
    const database = await db();
    const tx = database.transaction(["messages", "kv"], "readwrite");
    const done = transactionDone(tx);
    const rows = tx.objectStore("messages");
    const write = () => {
      for (const message of messages) {
        const get = rows.get(message.id);
        get.onsuccess = () => {
          const old = get.result as ChatMessage | undefined;
          if (old?.metadata?.retractedAt || old?.metadata?.hiddenAt) return;
          rows.put(message);
        };
      }
    };
    if (guard) {
      const revision = tx.objectStore("kv").get(`conversation-revision:${guard.session}`);
      revision.onsuccess = () => { if ((revision.result?.value ?? 0) !== guard.revision) tx.abort(); else write(); };
    } else write();
    try { await done; } catch (error) {
      if (guard && (await this.conversationRevision(guard.session) ?? 0) !== guard.revision) throw Error("会话已在其他页面调整，未保存过期回复，请刷新后重试");
      throw error;
    }
  },
  async deleteMessage(id: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("messages", "readwrite");
    tx.objectStore("messages").delete(id);
    await transactionDone(tx);
  },
  async deleteMessages(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const database = await db();
    const tx = database.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    for (const id of ids) store.delete(id);
    await transactionDone(tx);
  },
  async sessionMessages(sessionId = "private", includeRetracted = false): Promise<ChatMessage[]> {
    const values = includeRetracted ? await this.rawMessages() : await this.messages();
    return values.filter((message) => !message.metadata?.hiddenAt && (message.sessionId ?? "private") === sessionId);
  },
  async clearMessages(): Promise<void> {
    const database = await db();
    const tx = database.transaction("messages", "readwrite");
    tx.objectStore("messages").clear();
    await transactionDone(tx);
  },
  async clearSessionMessages(sessionId: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("messages", "readwrite");
    const cursor = tx.objectStore("messages").openCursor();
    cursor.onsuccess = () => { const row = cursor.result; if (!row) return; if ((row.value.sessionId ?? "private") === sessionId) row.delete(); row.continue(); };
    await transactionDone(tx);
  },
  async profile(): Promise<ApiProfile> {
    return (await readKv<ApiProfile>(PROFILE_KEY)) ?? {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "",
      temperature: 0.8,
      protocol: "openai"
    };
  },
  saveProfile(profile: ApiProfile): Promise<void> {
    return writeKv(PROFILE_KEY, profile);
  },
  async gameModelProfile(): Promise<GameModelProfile> {
    return (await readKv<GameModelProfile>(GAME_MODEL_PROFILE_KEY)) ?? {
      baseUrl: "",
      model: "",
      apiKey: "",
      temperature: 0.5,
      protocol: "openai"
    };
  },
  saveGameModelProfile(profile: GameModelProfile): Promise<void> {
    return writeKv(GAME_MODEL_PROFILE_KEY, profile);
  },
  async imageProfile(): Promise<ImageProfile> {
    return (await readKv<ImageProfile>(IMAGE_PROFILE_KEY)) ?? {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-image-1",
      apiKey: ""
    };
  },
  saveImageProfile(profile: ImageProfile): Promise<void> {
    return writeKv(IMAGE_PROFILE_KEY, profile);
  },
  async ttsProfile(): Promise<TtsProfile> {
    return (await readKv<TtsProfile>("tts-profile")) ?? { provider: "minimax", baseUrl: "https://api.minimaxi.com", model: "speech-2.8-hd", apiKey: "", voiceId: "" };
  },
  saveTtsProfile(profile: TtsProfile): Promise<void> {
    return writeKv("tts-profile", profile);
  },
  async audioAnalysisProfile(): Promise<AudioAnalysisProfile> {
    return (await readKv<AudioAnalysisProfile>(AUDIO_ANALYSIS_PROFILE_KEY)) ?? { provider: "gemini", baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash", apiKey: "", autoAnalyze: false };
  },
  saveAudioAnalysisProfile(profile: AudioAnalysisProfile): Promise<void> {
    return writeKv(AUDIO_ANALYSIS_PROFILE_KEY, profile);
  },
  async affection(): Promise<{ value: number; lastDay?: string }> {
    return (await readKv<{ value: number; lastDay?: string }>(AFFECTION_KEY)) ?? { value: 50 };
  },
  async addAffection(gain = 1): Promise<number> {
    const current = await this.affection();
    const today = new Date().toISOString().slice(0, 10);
    const value = Math.min(100, current.value + Math.max(0, gain));
    await writeKv(AFFECTION_KEY, { value, lastDay: today });
    return value;
  },
  async setAffection(value: number, lastDay?: string): Promise<void> {
    await writeKv(AFFECTION_KEY, { value: Math.max(0, Math.min(100, value)), lastDay });
  },
  async interactions(): Promise<InteractionRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("interactions", "readonly").objectStore("interactions").getAll());
    return (rows as InteractionRecord[]).sort((a, b) => b.createdAt - a.createdAt);
  },
  async addInteraction(value: InteractionRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("interactions", "readwrite");
    tx.objectStore("interactions").put(value);
    await transactionDone(tx);
  },
  async addInteractionWithMessage(value: InteractionRecord, message: ChatMessage): Promise<void> {
    const database = await db();
    const tx = database.transaction(["interactions", "messages"], "readwrite");
    tx.objectStore("interactions").put(value);
    tx.objectStore("messages").put(message);
    await transactionDone(tx);
  },
  async customGifts(): Promise<CustomGift[]> {
    return (await readKv<CustomGift[]>(CUSTOM_GIFTS_KEY) ?? []).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  },
  async saveCustomGift(value: CustomGift): Promise<void> {
    const gifts = (await this.customGifts()).filter((gift) => gift.id !== value.id);
    gifts.push(value);
    await writeKv(CUSTOM_GIFTS_KEY, gifts);
  },
  async deleteCustomGift(id: string): Promise<void> {
    await writeKv(CUSTOM_GIFTS_KEY, (await this.customGifts()).filter((gift) => gift.id !== id));
  },
  async lifeEvents(): Promise<LifeEventRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("lifeEvents", "readonly").objectStore("lifeEvents").getAll());
    return (rows as LifeEventRecord[]).sort((a, b) => b.createdAt - a.createdAt);
  },
  async saveLifeEvent(value: LifeEventRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("lifeEvents", "readwrite");
    tx.objectStore("lifeEvents").put(value);
    await transactionDone(tx);
  },
  /** A card and its event commit together; retries with the same event ID are no-ops. */
  async createLifeEvent(value: LifeEventRecord, message: ChatMessage): Promise<void> {
    const database = await db();
    const tx = database.transaction(["lifeEvents", "messages"], "readwrite");
    const done = transactionDone(tx), store = tx.objectStore("lifeEvents");
    const read = store.get(value.id);
    read.onsuccess = () => { if (!read.result) { store.put(value); tx.objectStore("messages").put(message); } };
    await done;
  },
  /** Synchronous reducer runs on the latest row, preventing double joins and lost updates. */
  async changeLifeEvent(id: string, change: (value: LifeEventRecord) => { event: LifeEventRecord; message?: ChatMessage } | undefined): Promise<LifeEventRecord | undefined> {
    const database = await db();
    const tx = database.transaction(["lifeEvents", "messages"], "readwrite");
    const done = transactionDone(tx), store = tx.objectStore("lifeEvents");
    let result: LifeEventRecord | undefined;
    const read = store.get(id);
    read.onsuccess = () => {
      if (!read.result) return;
      const next = change(read.result);
      if (!next) return;
      result = next.event; store.put(next.event);
      if (next.message) tx.objectStore("messages").put(next.message);
    };
    await done; return result;
  },
  async deleteLifeEvent(id: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("lifeEvents", "readwrite");
    tx.objectStore("lifeEvents").delete(id);
    await transactionDone(tx);
  },
  async characterSettings(): Promise<CharacterSettings> {
    return (await readKv<CharacterSettings>("character-settings")) ?? emptyCharacterSettings();
  },
  saveCharacterSettings(value: CharacterSettings): Promise<void> {
    return writeKv("character-settings", value);
  },
  async birthdaySettings(): Promise<BirthdaySettings> {
    const value = await readKv<BirthdaySettings>(BIRTHDAY_SETTINGS_KEY);
    if (!value || typeof value !== "object") return { enabled: true, contacts: {}, updatedAt: 0 };
    return { enabled: value.enabled !== false, user: value.user, contacts: value.contacts ?? {}, updatedAt: value.updatedAt ?? 0 };
  },
  async calendar(): Promise<CalendarData> {
    const value = await readKv<CalendarData>("calendar-data");
    return validCalendar(value) ? value : emptyCalendar();
  },
  /** Read-modify-write in one transaction so different tabs do not drop each other's days. */
  async updateCalendar(update: (data: CalendarData) => CalendarData): Promise<void> {
    const database = await db();
    const tx = database.transaction("kv", "readwrite"), done = transactionDone(tx), store = tx.objectStore("kv");
    const get = store.get("calendar-data");
    let failure: unknown;
    get.onsuccess = () => {
      try {
        const current: unknown = get.result?.value;
        const value = { ...update(validCalendar(current) ? current : emptyCalendar()), updatedAt: Date.now() };
        if (!validCalendar(value)) throw Error("日历记录格式无效，尚未保存");
        store.put({ key: "calendar-data", value });
      } catch (error) { failure = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw failure ?? error; }
  },
  saveBirthdaySettings(value: BirthdaySettings): Promise<void> {
    return writeKv(BIRTHDAY_SETTINGS_KEY, { enabled: value.enabled !== false, user: value.user, contacts: value.contacts ?? {}, updatedAt: value.updatedAt || Date.now() });
  },
  /** Atomically claim one local birthday event per calendar year and subject. */
  async claimBirthday(key: string, now = Date.now()): Promise<boolean> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("kv", "readwrite"), store = tx.objectStore("kv");
      const get = store.get(BIRTHDAY_CLAIMS_KEY);
      let claimed = false;
      get.onsuccess = () => {
        const claims = (get.result?.value as Record<string, number> | undefined) ?? {};
        if (claims[key]) return;
        claims[key] = now;
        // Keep the local state bounded while retaining enough history for duplicate protection.
        const cutoff = now - 3 * 366 * 24 * 60 * 60 * 1000;
        for (const [claim, at] of Object.entries(claims)) if (at < cutoff) delete claims[claim];
        store.put({ key: BIRTHDAY_CLAIMS_KEY, value: claims });
        claimed = true;
      };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("生日状态保存失败"));
    });
  },
  async activeSession(): Promise<string> {
    return (await readKv<string>("active-session")) ?? "private";
  },
  saveActiveSession(value: string): Promise<void> {
    return writeKv("active-session", value);
  },
  async groups(): Promise<GroupRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("groups", "readonly").objectStore("groups").getAll());
    return (rows as GroupRecord[]).map(normalizeLegacyGroup).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async saveGroup(value: GroupRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("groups", "readwrite");
    tx.objectStore("groups").put(value);
    await transactionDone(tx);
  },
  /** Serialize small group edits so memories, settings and foreground claims cannot overwrite each other. */
  async changeGroup(id: string, change: (group: GroupRecord) => void): Promise<GroupRecord | undefined> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("groups", "readwrite"), rows = tx.objectStore("groups");
      let result: GroupRecord | undefined;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? Error("群资料保存失败"));
      const get = rows.get(id);
      get.onsuccess = () => {
        try { if (get.result) { result = normalizeLegacyGroup(get.result); change(result!); rows.put(result); } }
        catch (error) { tx.abort(); reject(error); }
      };
    });
  },
  async deleteGroup(id: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("groups", "readwrite");
    tx.objectStore("groups").delete(id);
    await transactionDone(tx);
  },
  async diaries(): Promise<DiaryRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("diary", "readonly").objectStore("diary").getAll());
    return (rows as DiaryRecord[]).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async saveDiary(value: DiaryRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("diary", "readwrite");
    tx.objectStore("diary").put(value);
    await transactionDone(tx);
  },
  async deleteDiary(id: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("diary", "readwrite");
    tx.objectStore("diary").delete(id);
    await transactionDone(tx);
  },
  async socialAutomation(): Promise<SocialAutomationState> {
    return (await readKv<SocialAutomationState>(SOCIAL_AUTOMATION_KEY)) ?? {};
  },
  async saveMomentAuthor(author: string): Promise<void> {
    const state = await this.socialAutomation();
    state.momentLastAuthor = author;
    await writeKv(SOCIAL_AUTOMATION_KEY, state);
  },
  /** Claim a due automatic moment in one IndexedDB transaction so two tabs cannot post twice. */
  async claimAutomaticMoment(now: number): Promise<boolean> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("kv", "readwrite");
      const get = tx.objectStore("kv").get(SOCIAL_AUTOMATION_KEY);
      let claimed = false;
      get.onsuccess = () => {
        const state = (get.result?.value as SocialAutomationState | undefined) ?? {};
        if (!state.momentNextAt) {
          state.momentNextAt = now + (3 + Math.floor(Math.random() * 6)) * 60 * 60 * 1000;
          tx.objectStore("kv").put({ key: SOCIAL_AUTOMATION_KEY, value: state });
          return;
        }
        if (state.momentNextAt > now) return;
        state.momentClaimedAt = now;
        state.momentNextAt = now + (4 + Math.floor(Math.random() * 7)) * 60 * 60 * 1000;
        tx.objectStore("kv").put({ key: SOCIAL_AUTOMATION_KEY, value: state });
        claimed = true;
      };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("自动朋友圈状态保存失败"));
    });
  },
  async retryAutomaticMoment(now: number, delay = 30 * 60 * 1000): Promise<void> {
    const state = await this.socialAutomation();
    state.momentNextAt = now + delay;
    await writeKv(SOCIAL_AUTOMATION_KEY, state);
  },
  /** Claim one diary for the local calendar day; reopening after 20:00 remains idempotent. */
  async claimAutomaticDiary(day: string): Promise<boolean> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("kv", "readwrite");
      const get = tx.objectStore("kv").get(SOCIAL_AUTOMATION_KEY);
      let claimed = false;
      get.onsuccess = () => {
        const state = (get.result?.value as SocialAutomationState | undefined) ?? {};
        if (state.diaryDay === day) return;
        if (state.diaryRetryAt && state.diaryRetryAt > Date.now()) return;
        delete state.diaryRetryAt;
        state.diaryDay = day;
        tx.objectStore("kv").put({ key: SOCIAL_AUTOMATION_KEY, value: state });
        claimed = true;
      };
      tx.oncomplete = () => resolve(claimed);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("自动日记状态保存失败"));
    });
  },
  async releaseAutomaticDiary(day: string, retryAfter?: number): Promise<void> {
    const state = await this.socialAutomation();
    if (state.diaryDay === day) {
      delete state.diaryDay;
      if (retryAfter) state.diaryRetryAt = retryAfter;
      await writeKv(SOCIAL_AUTOMATION_KEY, state);
    }
  },
  async userAvatar(): Promise<MediaRecord | undefined> {
    const id = await readKv<string>(USER_AVATAR_KEY);
    return id ? this.media(id) : undefined;
  },
  async saveUserAvatar(record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    await writeKv(USER_AVATAR_KEY, record.id);
  },
  async clearUserAvatar(): Promise<void> { await writeKv(USER_AVATAR_KEY, ""); },
  async characterAvatar(): Promise<MediaRecord | undefined> {
    const id = await readKv<string>(CHARACTER_AVATAR_KEY);
    return id ? this.media(id) : undefined;
  },
  async saveCharacterAvatar(record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    await writeKv(CHARACTER_AVATAR_KEY, record.id);
  },
  async clearCharacterAvatar(): Promise<void> { await writeKv(CHARACTER_AVATAR_KEY, ""); },
  async npcAvatars(): Promise<Record<string, string>> {
    return (await readKv<Record<string, string>>(NPC_AVATARS_KEY)) ?? {};
  },
  async saveNpcAvatar(name: string, record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    const values = await this.npcAvatars();
    values[name] = record.id;
    await writeKv(NPC_AVATARS_KEY, values);
  },
  async saveNpcAvatars(values: Record<string, string>): Promise<void> {
    await writeKv(NPC_AVATARS_KEY, { ...await this.npcAvatars(), ...values });
  },
  async clearNpcAvatar(name: string): Promise<void> {
    const values = await this.npcAvatars();
    delete values[name];
    await writeKv(NPC_AVATARS_KEY, values);
  },
  async momentCover(): Promise<MediaRecord | undefined> {
    const id = await readKv<string>(MOMENT_COVER_KEY);
    return id ? this.media(id) : undefined;
  },
  async saveMomentCover(record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    await writeKv(MOMENT_COVER_KEY, record.id);
  },
  async clearMomentCover(): Promise<void> { await writeKv(MOMENT_COVER_KEY, ""); },
  async musicTracks(): Promise<MusicTrack[]> {
    return (await readKv<MusicTrack[]>(MUSIC_TRACKS_KEY)) ?? [];
  },
  async saveMusicTrack(track: MusicTrack): Promise<void> {
    const tracks = (await this.musicTracks()).filter((value) => value.id !== track.id);
    tracks.push(track);
    await writeKv(MUSIC_TRACKS_KEY, tracks);
  },
  async deleteMusicTrack(id: string): Promise<void> {
    await writeKv(MUSIC_TRACKS_KEY, (await this.musicTracks()).filter((track) => track.id !== id));
  },
  async activeMusicTrack(): Promise<string | undefined> {
    return readKv<string>(MUSIC_ACTIVE_KEY);
  },
  async saveActiveMusicTrack(id: string | undefined): Promise<void> {
    await writeKv(MUSIC_ACTIVE_KEY, id ?? "");
  },
  async continuousLife(characterId = PRIMARY_CHARACTER): Promise<LifeSceneState | undefined> {
    return readKv<LifeSceneState>(characterId === PRIMARY_CHARACTER ? CONTINUOUS_LIFE_KEY : `${CONTINUOUS_LIFE_KEY}:${characterId}`);
  },
  async saveContinuousLife(value: LifeSceneState): Promise<void> {
    return writeKv(!value.characterId || value.characterId === PRIMARY_CHARACTER ? CONTINUOUS_LIFE_KEY : `${CONTINUOUS_LIFE_KEY}:${value.characterId}`, value);
  },
  async clearContinuousLife(): Promise<void> {
    await writeKv(CONTINUOUS_LIFE_KEY, undefined);
  },
  async videoCallBackground(): Promise<MediaRecord | undefined> {
    const id = await readKv<string>(VIDEO_CALL_BACKGROUND_KEY);
    return id ? this.media(id) : undefined;
  },
  async saveVideoCallBackground(record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    await writeKv(VIDEO_CALL_BACKGROUND_KEY, record.id);
  },
  async clearVideoCallBackground(): Promise<void> {
    await writeKv(VIDEO_CALL_BACKGROUND_KEY, "");
  },
  async dateSessions(): Promise<DateSession[]> {
    return (await readKv<DateSession[]>(DATE_SESSIONS_KEY) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async sceneFloors(scope: SceneFloorScope): Promise<SceneFloorRow[]> {
    if (scope.kind === "life") {
      if (!characters.some(character => character.id === scope.characterId)) throw Error("找不到这位线下联系人");
      return this.sessionMessages(lifeSession(scope.characterId));
    }
    if (scope.kind === "date") {
      const scene = (await this.dateSessions()).find(value => value.id === scope.id && ownsCharacter(value, scope.characterId));
      if (!scene) throw Error("这场约会已调整，请重新打开");
      return scene.messages;
    }
    const scene = (await this.fieldwork<FieldworkData>())?.adventures.find(value => value.id === scope.id);
    if (!scene) throw Error("找不到这次线下冒险");
    return scene.messages;
  },
  /** Compare and write in one transaction; another tab cannot silently overwrite this edit. */
  async changeSceneFloor(scope: SceneFloorScope, expected: SceneFloorRow[], id: string, change: SceneFloorChange): Promise<{ checkpoint?: string; removed: number }> {
    const signature = floorSignature(expected);
    const index = expected.findIndex(row => row.id === id);
    if (index < 0) throw Error("找不到这一层，记录未修改");
    if (change.type === "edit" && !change.content.trim()) throw Error("内容不能为空，原文仍保留");
    if (floorSignature(await this.sceneFloors(scope)) !== signature) throw Error("记录已在其他页面变化，请重新打开这一层；你的编辑内容仍保留");
    if (change.type === "edit" && change.content === expected[index].content) return { removed: 0 };
    if (change.type === "rewind" && index === expected.length - 1) throw Error("这里已经是最后一层，可以直接继续");
    const checkpoint = change.type === "rewind" ? await this.makeArchive(`${scope.kind === "date" ? "约会" : "线下"}回退前 · ${new Date().toLocaleString()}`, "checkpoint") : undefined;
    const database = await db(), tx = database.transaction(["messages", "kv", "memories"], "readwrite"), done = transactionDone(tx);
    const kv = tx.objectStore("kv"), at = Date.now();
    let failure: Error | undefined;
    const contextScope = scope.kind === "life" ? lifeSession(scope.characterId) : scope.kind === "date" ? `date:${scope.characterId}:${scope.id}` : `fieldwork:${scope.id}`;
    const apply = <T extends SceneFloorRow>(rows: T[]): T[] => {
      if (floorSignature(rows) !== signature) throw Error("记录已在其他页面变化，请重新打开这一层；你的编辑内容仍保留");
      if (change.type === "rewind") return rows.slice(0, index + 1);
      return rows.map(row => row.id === id ? { ...row, content: change.content, metadata: { ...row.metadata, editedAt: at } } : row);
    };
    const run = (write: () => void) => { try { write(); } catch (error) { failure = error instanceof Error ? error : Error("楼层保存失败"); tx.abort(); } };
    if (scope.kind === "life") {
      const get = tx.objectStore("messages").getAll();
      get.onsuccess = () => run(() => {
        const rows = (get.result as ChatMessage[]).filter(row => (row.sessionId ?? "private") === contextScope && !row.metadata?.hiddenAt && !row.metadata?.retractedAt).sort((a, b) => a.createdAt - b.createdAt);
        const next = apply(rows);
        if (change.type === "edit") tx.objectStore("messages").put(next[index]);
        else for (const row of rows.slice(index + 1)) tx.objectStore("messages").put({ ...row, metadata: { ...row.metadata, hiddenAt: at, branchArchiveId: checkpoint!.id } });
        const key = scope.characterId === PRIMARY_CHARACTER ? CONTINUOUS_LIFE_KEY : `${CONTINUOUS_LIFE_KEY}:${scope.characterId}`;
        const state = kv.get(key);
        state.onsuccess = () => run(() => {
          if (!state.result?.value) return;
          const latestUser = next.filter(row => row.role === "user").at(-1);
          if (change.type === "rewind" || latestUser?.id === id) kv.put({ key, value: { ...state.result.value, activity: latestUser?.content.slice(0, 120) || "从保留的现场记录继续", ...(change.type === "rewind" ? { unfinished: "" } : {}), updatedAt: at } });
        });
      });
    } else {
      const key = scope.kind === "date" ? DATE_SESSIONS_KEY : "fieldwork-data", get = kv.get(key);
      get.onsuccess = () => run(() => {
        if (scope.kind === "date") {
          const sessions = (get.result?.value ?? []) as DateSession[];
          const scene = sessions.find(value => value.id === scope.id && ownsCharacter(value, scope.characterId));
          if (!scene) throw Error("这场约会已变化，未修改记录");
          scene.messages = apply(scene.messages); scene.updatedAt = at;
          if (change.type === "rewind") {
            for (const other of sessions) if (other.id !== scene.id && ownsCharacter(other, scope.characterId)) other.active = false;
            scene.active = true;
          }
          kv.put({ key, value: sessions });
        } else {
          const data = get.result?.value as FieldworkData | undefined;
          const scene = data?.adventures.find(value => value.id === scope.id);
          if (!data || !scene) throw Error("这次冒险已变化，未修改记录");
          scene.messages = apply(scene.messages); scene.updatedAt = at;
          const latestUser = scene.messages.filter(row => row.role === "user").at(-1);
          if (change.type === "rewind" || latestUser?.id === id) scene.activity = latestUser?.content.slice(0, 120) || "从保留的现场记录继续";
          if (change.type === "rewind") {
            scene.active = true;
            const investigation = data.investigations.find(value => value.id === scene.investigationId);
            if (investigation) { investigation.status = "adventure"; investigation.updatedAt = at; }
          }
          kv.put({ key, value: data });
        }
      });
    }
    kv.delete(`context-summary:${contextScope}`); kv.delete(`context-lease:${contextScope}`);
    bumpConversationRevision(tx, contextScope);
    const changedIds = new Set(change.type === "edit" ? [id] : expected.slice(index + 1).map(row => row.id));
    const memories = tx.objectStore("memories").openCursor();
    memories.onsuccess = () => {
      const row = memories.result; if (!row) return;
      const memory = row.value as MemoryRecord;
      if (memory.sourceMessageIds?.some(source => changedIds.has(source))) {
        memory.reviewReason = "来源楼层已编辑或回退，请核对";
        if (memory.source === "conversation") memory.enabled = false;
        row.update(memory);
      }
      row.continue();
    };
    try { await done; } catch (error) { throw failure ?? error; }
    return { checkpoint: checkpoint?.id, removed: change.type === "rewind" ? expected.length - index - 1 : 0 };
  },
  async saveDateSession(value: DateSession): Promise<void> {
    const sessions = (await this.dateSessions()).filter((session) => session.id !== value.id);
    sessions.push(value);
    await writeKv(DATE_SESSIONS_KEY, sessions);
  },
  async deleteDateSession(id: string): Promise<void> {
    await writeKv(DATE_SESSIONS_KEY, (await this.dateSessions()).filter((session) => session.id !== id));
  },
  async background(): Promise<MediaRecord | undefined> {
    const id = await readKv<string>(BACKGROUND_KEY);
    if (!id) return undefined;
    return this.media(id);
  },
  async saveBackground(record: MediaRecord): Promise<void> {
    await this.saveMedia(record);
    await writeKv(BACKGROUND_KEY, record.id);
  },
  async clearBackground(): Promise<void> {
    await writeKv(BACKGROUND_KEY, "");
  },
  async saveMedia(record: MediaRecord): Promise<void> {
    const database = await sharedDb();
    const tx = database.transaction("media", "readwrite");
    tx.objectStore("media").put(record);
    await transactionDone(tx);
  },
  async media(id: string): Promise<MediaRecord | undefined> {
    const database = await sharedDb();
    return request(database.transaction("media", "readonly").objectStore("media").get(id));
  },
  async mediaRecords(ids: string[]): Promise<MediaRecord[]> {
    const values = await Promise.all(ids.map((id) => this.media(id)));
    return values.filter((value): value is MediaRecord => Boolean(value));
  },
  async stickers(): Promise<StickerRecord[]> {
    const database = await sharedDb();
    return request(database.transaction("stickers", "readonly").objectStore("stickers").getAll());
  },
  async saveSticker(value: StickerRecord): Promise<void> {
    const database = await sharedDb();
    const tx = database.transaction("stickers", "readwrite");
    tx.objectStore("stickers").put(value);
    await transactionDone(tx);
  },
  async memories(): Promise<MemoryRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("memories", "readonly").objectStore("memories").getAll());
    return (rows as MemoryRecord[]).filter((value) => value.enabled).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async allMemories(): Promise<MemoryRecord[]> {
    const database = await db();
    return request(database.transaction("memories", "readonly").objectStore("memories").getAll());
  },
  async saveMemory(value: MemoryRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("memories", "readwrite");
    tx.objectStore("memories").put(value);
    await transactionDone(tx);
  },
  async deleteMemory(id: string): Promise<void> {
    const database = await db();
    const tx = database.transaction("memories", "readwrite");
    tx.objectStore("memories").delete(id);
    await transactionDone(tx);
  },
  async moments(): Promise<MomentRecord[]> {
    const database = await db();
    const rows = await request(database.transaction("moments", "readonly").objectStore("moments").getAll());
    return (rows as MomentRecord[]).sort((a, b) => b.createdAt - a.createdAt);
  },
  async saveMoment(value: MomentRecord): Promise<void> {
    const database = await db();
    const tx = database.transaction("moments", "readwrite");
    tx.objectStore("moments").put(value);
    await transactionDone(tx);
  },
  async seedStarterMoments(values: MomentRecord[]): Promise<void> {
    const database = await db();
    const tx = database.transaction(["kv", "moments"], "readwrite");
    const kv = tx.objectStore("kv");
    const get = kv.get("starter-moments-seeded");
    get.onsuccess = () => {
      if (get.result?.value) return;
      const store = tx.objectStore("moments");
      const count = store.count();
      count.onsuccess = () => {
        if (count.result === 0) for (const value of values) store.put(value);
        kv.put({ key: "starter-moments-seeded", value: true });
      };
    };
    await transactionDone(tx);
  }
};

export function newId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}
