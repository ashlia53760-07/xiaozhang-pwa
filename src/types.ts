export type ChatRole = "user" | "assistant";
export type MessageKind = "text" | "image" | "gallery" | "sticker" | "event";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  kind: MessageKind;
  mediaId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  sessionId?: string;
  speakerId?: string;
}

export interface ApiProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  protocol?: "openai" | "gemini";
}

/** Optional, separate profile used only for short game companionship lines. */
export interface GameModelProfile extends ApiProfile {}

export interface ImageProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface TtsProfile {
  provider: "minimax" | "elevenlabs";
  baseUrl: string;
  model: string;
  apiKey: string;
  voiceId: string;
  groupId?: string;
}

export interface MediaRecord {
  id: string;
  blob: Blob;
  mime: string;
  origin: string;
  createdAt: number;
}

export interface StickerRecord {
  id: string;
  mediaId: string;
  label: string;
  description?: string;
  tags?: string[];
  createdAt: number;
}

export interface MemoryRecord {
  sourceMessageIds?: string[];
  reviewReason?: string;
  /** Missing ownership in older records belongs to Zhang Qiling. */
  characterId?: string;
  id: string;
  content: string;
  category: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  source?: "user" | "conversation" | "imported";
}

export interface MomentComment {
  id: string;
  content: string;
  author: "user" | "xiaopingzi" | "npc";
  authorName?: string;
  createdAt: number;
}

export interface MomentRecord {
  id: string;
  content: string;
  author: "user" | "xiaopingzi" | "npc";
  authorName?: string;
  mediaId?: string;
  liked: boolean;
  comments: MomentComment[];
  createdAt: number;
  source?: "user" | "auto" | "sample";
  automationKey?: string;
  imagePrompt?: string;
}

export type InteractionKind = "touch" | "feed" | "hug" | "pose";

export interface InteractionRecord {
  characterId?: string;
  id: string;
  kind: InteractionKind;
  label: string;
  response: string;
  affectionGain: number;
  createdAt: number;
}

/** Local-only relationship events. Monetary values are virtual records, never payments. */
export type LifeEventKind = "gift" | "bill" | "transfer" | "group_collection" | "chain" | "birthday";

export interface LifeEventRecord {
  characterId?: string;
  id: string;
  kind: LifeEventKind;
  title: string;
  note?: string;
  amount?: number;
  category?: string;
  sender: "user" | "xiaopingzi";
  /** Optional recipient/group fields are absent on legacy gift and bill rows. */
  recipient?: string;
  sessionId?: string;
  initiatorId?: string;
  recipientId?: string;
  /** Display snapshots survive renamed/removed group members; avatars use characterId. */
  people?: Array<{ id: string; name: string; characterId?: string }>;
  shares?: Record<string, number>;
  updatedAt?: number;
  groupId?: string;
  participants?: string[];
  responses?: Record<string, "pending" | "joined" | "declined" | "settled">;
  chainItems?: Array<{ id: string; name: string; content: string; createdAt: number; ownerId?: string }>;
  status?: "pending" | "accepted" | "declined" | "settled";
  accepted?: boolean;
  createdAt: number;
}

export interface CustomGift {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BirthdayDate {
  month: number;
  day: number;
}

/** Birthday preferences are local relationship data; no year is stored. */
export interface BirthdaySettings {
  enabled: boolean;
  user?: BirthdayDate;
  contacts: Record<string, BirthdayDate>;
  updatedAt: number;
}

export interface CharacterSettings {
  relationshipMode?: "friendship" | "romance";
  userName: string;
  userPreferences: string;
  relationship: string;
  customPrompt: string;
  worldBook: string;
  /** Optional scene-only instructions. Stored locally and never sent to other conversation modes. */
  lifeSupplementPrompt?: string;
  dateSupplementPrompt?: string;
  /** Enables the built-in theatre protocol for each full-screen scene mode. */
  lifeTheatreEnabled?: boolean;
  dateTheatreEnabled?: boolean;
  /** Persistent preferences used by full-screen life/date theatre scenes. */
  dateXpRelationship?: string;
  dateObserverRequests?: string;
  dateStyleRequirements?: string;
  updatedAt: number;
}

/** User-editable common settings; actual relationship state/mode remain contact-specific. */
export type SharedCharacterSettings = Pick<CharacterSettings,
  "userName" | "userPreferences" | "customPrompt" | "worldBook" |
  "lifeSupplementPrompt" | "dateSupplementPrompt" | "lifeTheatreEnabled" | "dateTheatreEnabled" |
  "dateXpRelationship" | "dateObserverRequests" | "dateStyleRequirements"
>;

export interface ContactPreferences {
  /** Local display label only; never changes canonical identity or model persona. */
  remark?: string;
  settings?: CharacterSettings;
  api?: ApiProfile;
  /** Voice IDs are provider-specific; service credentials remain in the global TTS profile. */
  voiceIds?: Partial<Record<TtsProfile["provider"], string>>;
  affection?: number;
  updatedAt: number;
}

export interface DiaryRecord {
  id: string;
  /** Local calendar date. Legacy records derive it from automationKey/createdAt. */
  date?: string;
  title: string;
  content: string;
  mood?: string;
  createdAt: number;
  updatedAt: number;
  source?: "user" | "auto";
  automationKey?: string;
}

export interface MusicTrack {
  feedbackByCharacter?: Record<string, { text: string; sentAt: number }>;
  id: string;
  title: string;
  source: "local" | "url";
  mediaId?: string;
  url?: string;
  duration?: number;
  analysis?: string;
  feedback?: string;
  analysisError?: string;
  analysisStatus?: "ready" | "failed";
  feedbackSentAt?: number;
  coverMediaId?: string;
  order?: number;
  volume?: number;
  lastPosition?: number;
  createdAt: number;
}

export interface LifeSceneState {
  characterId?: string;
  id: "continuous-life";
  active: boolean;
  location: string;
  timeLabel: string;
  environment: string;
  activity: string;
  userPosition?: string;
  characterPosition?: string;
  unfinished?: string;
  lastEventAt?: number;
  updatedAt: number;
}

export type DateSceneKind = "walk" | "shopping" | "movie" | "meal" | "birthday" | "festival" | "rain" | "night" | "snow" | "seaside" | "camp" | "custom";

export interface GroupSceneCast {
  groupId: string;
  memberIds: string[];
  replyMode?: "inherit" | "natural" | "selected" | "all";
  selectedMemberIds?: string[];
  /** Legacy snapshot retained for backup compatibility; independent dates never consume it. */
  openingContext?: string;
  revision?: number;
  continuationState?: { id: string; memberIds: string[] };
}

export interface GroupLifeScene extends GroupSceneCast {
  id: string;
  active: boolean;
  location: string;
  timeLabel: string;
  environment: string;
  activity: string;
  messages: ChatMessage[];
  updatedAt: number;
}

/** A reusable instruction sheet. A performance owns an immutable snapshot of it. */
export interface TheatreScript {
  id: string;
  revision: number;
  title: string;
  scene: DateSceneKind;
  setting: string;
  atmosphere: string;
  arrangement: string;
  userName: string;
  mode: "single" | "multi";
  characterIds: string[];
  backgroundMediaId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DateSession {
  /** Present only for independent script-library performances, never a chat group. */
  scriptSnapshot?: TheatreScript;
  characterId?: string;
  groupId?: string;
  memberIds?: string[];
  replyMode?: GroupSceneCast["replyMode"];
  selectedMemberIds?: string[];
  openingContext?: string;
  /** Belongs exclusively to this date; source signatures prevent stale recall after floor edits. */
  localMemories?: { content: string; sourceMessageIds: string[]; sourceSignature: string; createdAt: number }[];
  openingMemberIds?: string[];
  revision?: number;
  continuationState?: GroupSceneCast["continuationState"];
  id: string;
  backgroundMediaId?: string;
  scene: DateSceneKind;
  title: string;
  setting: string;
  atmosphere: string;
  messages: ChatMessage[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AudioAnalysisProfile {
  provider: "openai" | "gemini";
  baseUrl: string;
  model: string;
  apiKey: string;
  autoAnalyze: boolean;
}

export interface GroupRecord {
  id: string;
  title: string;
  /** Optional link to a fieldwork investigation; older groups remain compatible. */
  fieldworkInvestigationId?: string;
  members: Array<{ id: string; name: string; persona: string; enabled: boolean; characterId?: string; relationship?: string }>;
  avatarMediaId?: string;
  userName?: string;
  atmosphere?: "daily" | "lively" | "quiet";
  background?: string;
  announcement?: string;
  worldBook?: string;
  replyMode?: "natural" | "selected" | "all";
  selectedMemberIds?: string[];
  activity?: "quiet" | "normal" | "lively";
  replyLimit?: number;
  proactive?: boolean;
  proactiveClaimedAt?: number;
  memories?: GroupMemory[];
  favorites?: GroupFavorite[];
  createdAt: number;
  updatedAt: number;
}

export interface GroupQuote { messageId: string; speaker: string; text: string }
export interface GroupMemory {
  reviewReason?: string;
  id: string;
  content: string;
  enabled: boolean;
  source: "user" | "conversation";
  messageIds?: string[];
  createdAt: number;
  updatedAt: number;
}
export interface GroupFavorite { id: string; messageId: string; speaker: string; text: string; createdAt: number }

export type FieldworkSourceKind = "source" | "rumor" | "user_note" | "model_inference";

export interface FieldworkEvidence {
  id: string;
  title: string;
  sourceName: string;
  url?: string;
  excerpt: string;
  kind: FieldworkSourceKind;
  investigationId: string;
  createdAt: number;
  updatedAt: number;
  sharedGroupId?: string;
}

export interface FieldworkInvestigation {
  id: string;
  title: string;
  universe: "盗墓笔记" | "鬼吹灯" | "原创线索";
  status: "collecting" | "discussing" | "adventure" | "closed";
  evidenceIds: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface FieldworkAdventureMessage {
  id: string;
  role: "user" | "assistant";
  speakerId?: string;
  content: string;
  createdAt: number;
}

export interface FieldworkAdventure {
  id: string;
  investigationId: string;
  groupId: string;
  title: string;
  location: string;
  briefing: string;
  memberIds: string[];
  messages: FieldworkAdventureMessage[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** Optional scene fields keep existing adventure records compatible. */
  timeLabel?: string;
  environment?: string;
  activity?: string;
  startedAt?: number;
}

export interface FieldworkForumPost {
  id: string;
  title: string;
  board: string;
  universe: "盗墓笔记" | "鬼吹灯" | "原创线索";
  text: string;
  author?: string;
  floors?: Array<{ id: string; author: string; text: string; tone?: "useful" | "banter" | "noise" | "alarmist"; createdAt: number }>;
  query: string;
  source: "builtin" | "model" | "user";
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FieldworkBrowserResult {
  id: string;
  query: string;
  title: string;
  summary: string;
  sourceLabel: string;
  source: "builtin" | "model";
  kind?: "reference" | "news" | "forum" | "ad" | "noise";
  /** Optional in-app contact target for character-authored browser notices. */
  contactId?: string;
  createdAt: number;
}

export interface FieldworkData {
  investigations: FieldworkInvestigation[];
  evidence: FieldworkEvidence[];
  adventures: FieldworkAdventure[];
  forumPosts: FieldworkForumPost[];
  browserResults: FieldworkBrowserResult[];
}
