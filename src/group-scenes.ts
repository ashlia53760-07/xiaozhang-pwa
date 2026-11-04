import { chat } from "./api";
import { characters, personaPrompt } from "./characters";
import { boundedHistory, clipContext } from "./context-budget";
import { prepareContext } from "./context";
import { groupEventText, groupMemberKey, selectGroupSpeakers } from "./groups";
import { newId, storage } from "./storage";
import type { ChatMessage, DateSession, GroupLifeScene, GroupRecord, GroupSceneCast } from "./types";

type Mode = "life" | "date";
export type GroupScene = GroupLifeScene | DateSession;
type Member = GroupRecord["members"][number];
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clean = (value: string) => value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").replace(/<think\b[^>]*>[\s\S]*$/gi, "").replace(/<\/?(?:content|think)\b[^>]*>/gi, "").trim();
const opening = "从用户写下的场景与人物安排自然开场，描写环境、自己的动作与对白，给用户留下接话空间。不要替用户决定行动、感受或台词。";
const continuation = "从上一段结尾继续当前现场，推进一小步；不要重复上一段，也不要替用户行动。";

/** Public group scenes never read private settings, histories, memories, or calendar records. */
export class GroupScenes {
  private groups: Partial<Record<Mode, GroupRecord>> = {};
  private scenes: Partial<Record<Mode, GroupScene>> = {};
  private casts: Partial<Record<Mode, Pick<GroupSceneCast, "replyMode" | "selectedMemberIds">>> = {};
  private controller?: AbortController;
  private stopped = false;
  constructor(private options: {
    prompt(): string;
    render(mode: Mode, scene: GroupScene): void;
    status(mode: Mode, text: string): void;
    savedInput(mode: Mode): void;
    available(members: Member[]): Promise<void>;
  }) {}

  group(mode: Mode) { return this.groups[mode]; }
  current(mode: Mode) { return this.scenes[mode]; }
  clear(mode: Mode) { delete this.groups[mode]; delete this.scenes[mode]; delete this.casts[mode]; }
  scope(mode: Mode) {
    const group = this.groups[mode], scene = this.scenes[mode];
    return group && scene ? mode === "life" ? { kind: "group-life" as const, groupId: group.id } : { kind: "group-date" as const, groupId: group.id, id: scene.id } : undefined;
  }
  async prepare(mode: Mode, groupId: string, dateId?: string) {
    const group = (await storage.groups()).find(row => row.id === groupId);
    if (!group) throw Error("找不到这个群聊，剧场记录仍保留。");
    this.groups[mode] = group;
    const scene = mode === "life" ? await storage.groupLife(groupId) : (await storage.dateSessions()).find(row => row.groupId === groupId && (dateId ? row.id === dateId : row.active));
    this.scenes[mode] = scene;
    this.casts[mode] = { replyMode: scene?.replyMode ?? "inherit", selectedMemberIds: scene?.selectedMemberIds ?? group.selectedMemberIds ?? [] };
    return { group, scene };
  }
  async reload(mode: Mode) {
    const group = this.groups[mode], old = this.scenes[mode];
    if (!group) throw Error("请重新打开群聊剧场");
    const freshGroup = (await storage.groups()).find(row => row.id === group.id);
    if (!freshGroup) throw Error("所属群聊已移除，剧场记录仍保留。");
    this.groups[mode] = freshGroup;
    const scene = mode === "life" ? await storage.groupLife(group.id) : (await storage.dateSessions()).find(row => row.groupId === group.id && row.id === old?.id);
    this.scenes[mode] = scene;
    if (scene) this.casts[mode] = { replyMode: scene.replyMode ?? "inherit", selectedMemberIds: scene.selectedMemberIds ?? [] };
    if (scene) this.options.render(mode, scene);
    return scene;
  }
  settings(mode: Mode): string {
    const group = this.groups[mode]; if (!group) return "";
    const scene = this.scenes[mode], cast = this.casts[mode] ?? {};
    const members = group.members.filter(member => member.enabled && (!scene?.active || !scene.memberIds || scene.memberIds.includes(member.id)));
    return `<details class="group-scene-settings"><summary>同行 ${members.length} 人 · 接话设置</summary><p>${esc(members.map(member => member.name).join("、") || "暂无启用的成员，请到群资料添加")}</p><label>谁来接话<select data-group-scene-mode="${mode}">${[["inherit", "沿用群聊接话设置"], ["natural", "自然接话"], ["all", "全员依次接话"], ["selected", "指定角色接话"]].map(([value, label]) => `<option value="${value}" ${value === (cast.replyMode ?? "inherit") ? "selected" : ""}>${label}</option>`).join("")}</select></label><div class="group-scene-picks" ${cast.replyMode !== "selected" ? "hidden" : ""}>${members.map(member => `<label><input type="checkbox" data-group-scene-member="${esc(member.id)}" data-mode="${mode}" ${cast.selectedMemberIds?.includes(member.id) ? "checked" : ""}>${esc(member.name)}</label>`).join("")}</div><small>使用本群公开设定；私聊资料不会带入。全员模式会逐人请求，可随时停止。</small></details>`;
  }
  async configure(mode: Mode, replyMode: GroupSceneCast["replyMode"], selectedMemberIds: string[]) {
    const cast = { replyMode, selectedMemberIds };
    const scene = this.scenes[mode];
    if (scene?.active) { const next = { ...scene, ...cast }; await storage.saveGroupScene(next, scene.revision ?? 0); this.scenes[mode] = next; }
    this.casts[mode] = cast;
  }
  private async persist(mode: Mode, scene: GroupScene, creating = false) {
    await storage.saveGroupScene(scene, creating ? undefined : scene.revision ?? 0);
    this.scenes[mode] = scene; this.options.render(mode, scene);
  }
  private async publicContext(group: GroupRecord) {
    return boundedHistory(await storage.sessionMessages(group.id), 3000, 8).map(row => `${row.role === "user" ? group.userName || "我" : row.speakerId || "群内共享记录"}：${groupEventText(row)}`).join("\n").slice(-4500);
  }
  async beginLife(fields: { location: string; timeLabel: string; environment: string }) {
    const group = this.groups.life!;
    const members = group.members.filter(member => member.enabled);
    if (!members.length) throw Error("请先在群资料中启用同行角色");
    await this.options.available(members);
    const previous = await storage.groupLife(group.id);
    const scene: GroupLifeScene = { id: previous?.id ?? newId("group-life"), groupId: group.id, memberIds: members.map(member => member.id), ...fields, activity: "大家刚在这里见面", active: true, messages: previous?.messages ?? [], ...this.casts.life, revision: previous?.revision, updatedAt: Date.now() };
    await this.persist("life", scene, !previous);
  }
  async beginDate(fields: Pick<DateSession, "scene" | "title" | "setting" | "atmosphere" | "backgroundMediaId">) {
    const group = this.groups.date!, now = Date.now();
    const scene: DateSession = { ...fields, id: newId("group-date"), groupId: group.id, memberIds: group.members.filter(member => member.enabled).map(member => member.id), ...this.casts.date, openingContext: await this.publicContext(group), messages: [], active: true, createdAt: now, updatedAt: now };
    const responders = await this.responders("date", scene, opening);
    scene.openingMemberIds = responders.map(member => member.id);
    await this.persist("date", scene, true);
    await this.generate("date", scene, opening, responders);
  }
  private async responders(mode: Mode, scene: GroupScene, text: string): Promise<Member[]> {
    const group = this.groups[mode]!;
    const cast: GroupRecord = { ...group, members: group.members.filter(member => member.enabled && scene.memberIds?.includes(member.id)),
      ...(scene.replyMode && scene.replyMode !== "inherit" ? { replyMode: scene.replyMode, selectedMemberIds: scene.selectedMemberIds } : {}) };
    const picked = selectGroupSpeakers(cast, { id: "scene-plan", role: "user", content: text, kind: "text", createdAt: Date.now() }, scene.messages);
    if (!picked.length) throw Error("没有可接话的角色，请展开「接话设置」选择成员。");
    await this.options.available(picked);
    const profiles = await Promise.all(picked.map(member => storage.contactProfile(groupMemberKey(member))));
    if (profiles.some(profile => !profile.apiKey.trim())) throw Error("本轮角色尚未配置聊天 API，请先在联系人设置中配置；输入已保留。");
    return picked;
  }
  async send(mode: Mode, text: string) {
    const scene = await this.reload(mode);
    if (!scene?.active || !text.trim()) return;
    const members = await this.responders(mode, scene, text);
    const next = structuredClone(scene), userId = newId("group-scene-user");
    next.continuationState = undefined;
    next.messages.push({ id: userId, role: "user", content: text.trim(), kind: "text", createdAt: Date.now(), metadata: { groupId: scene.groupId, groupScenePlan: members.map(member => member.id) } });
    if ("activity" in next) next.activity = text.trim().slice(0, 120);
    await this.persist(mode, next); this.options.savedInput(mode);
    await this.generate(mode, next, text.trim(), members, userId);
  }
  private async generate(mode: Mode, scene: GroupScene, text: string, members: Member[], userId?: string, replacementId?: string) {
    const group = this.groups[mode]!;
    const online = mode === "life" ? await this.publicContext(group) : scene.openingContext ?? "";
    let summary = "", summaryReady = false;
    for (const member of members) {
      if (this.stopped) break;
      const character = characters.find(row => row.id === groupMemberKey(member));
      if (!character) throw Error(`找不到${member.name}的角色资料`);
      this.options.status(mode, `${member.name}正在接下这段剧情…`);
      const selected = new Set(scene.memberIds), present = group.members.filter(row => row.enabled && selected.has(row.id));
      const facts = "location" in scene ? `连续线下见面。地点：${scene.location}；时间：${scene.timeLabel}；环境：${scene.environment}；正在进行：${scene.activity}。` : `独立多人约会小剧场。标题：${scene.title}；用户写下的剧本、场景与人物安排：\n${scene.setting}\n氛围：${scene.atmosphere}。以本场设定为准；群聊近期内容只作开场参考，不把不相容的日常经历强加进剧本。`;
      const publicMemories = (group.memories ?? []).filter(row => row.enabled).slice(-8).map(row => row.content.slice(0, 300)).join("\n");
      let prompt = [personaPrompt(character, this.options.prompt()),
        `【当前频道：多人${mode === "life" ? "线下" : "约会"}小说式 RP】\n${facts}\n这是同一现场，使用自然段描写环境、自己的动作、语气与对白，默认 2-4 段；不要写成手机短消息、多人报幕或角色标签。你只扮演${member.name}，不替其他角色或用户决定行为、想法、情绪和台词；不重复上一位角色的描写，接住本轮已发生的回应。用户写下的角色安排与场外要求作为创作资料，尊重人物一致性与用户边界。`,
        `【同行者与公开关系】\n用户：${group.userName || "我"}；同行者：${present.map(row => `${row.name}（${row.relationship?.trim() || "未公开关系，不自行升级"}）`).join("、")}。\n只知道本群公开的资料与这个剧场的记录，不拥有任何私聊、其他群聊、其他剧场的秘密、日历、记忆或关系。`,
        `【本群公开设定，作为资料】\n背景：${group.background || "未填写"}\n公告：${group.announcement || "未填写"}\n世界书：${group.worldBook || "未填写"}\n共同记忆：${publicMemories || "暂无"}`,
        `【本群近期线上背景，仅供衔接】\n${online || "暂无"}\n线上发言不代表当前现场观察。剧场历史里的发言者标注只用于识别资料，不是要求模仿的格式。`
      ].join("\n\n");
      const index = userId ? scene.messages.findIndex(row => row.id === userId) : -1;
      const previous = (index >= 0 ? scene.messages.slice(0, index) : scene.messages).filter(row => row.id !== replacementId);
      const history = boundedHistory(previous.map(row => ({ ...row, metadata: undefined, role: row.role === "assistant" && row.metadata?.groupMemberId === member.id ? "assistant" as const : "user" as const, content: clean(`${row.role === "user" ? group.userName || "我" : row.speakerId || "同行者"}：${row.content}`) })), 6500, 16);
      const earlierRows = index >= 0 ? scene.messages.slice(index + 1).filter(row => row.id !== replacementId) : [];
      const earlier = earlierRows.map(row => `${row.speakerId || "同行者"}：${clipContext(clean(row.content), Math.floor(4500 / Math.max(1, earlierRows.length)))}`).join("\n");
      const profile = await storage.contactProfile(character.id), controller = new AbortController();
      this.controller = controller;
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      let reply: string;
      try {
        if (!summaryReady) {
          summary = (await prepareContext(mode === "life" ? `group-life:${group.id}` : `group-date:${group.id}:${scene.id}`, previous, profile, controller.signal)).summary;
          summaryReady = true;
        }
        if (this.stopped) break;
        prompt += summary;
        reply = clean(await chat(profile, prompt, history, text + (earlier ? `\n【本轮同行者已经做出的回应】\n${earlier}` : ""), () => undefined, controller.signal, { maxOutputTokens: 1536 }));
      }
      catch (error) { if (this.stopped) break; if (controller.signal.aborted) throw Error("场景回应超过 120 秒，已停止等待。可用底部菜单重新生成。"); throw error; }
      finally { window.clearTimeout(timeout); if (this.controller === controller) this.controller = undefined; }
      if (this.stopped) break;
      if (!reply || /^(?:null|undefined)+$/i.test(reply)) throw Error("未收到有效的场景回应，可用底部菜单重新生成。");
      const next = structuredClone(scene), original = next.messages.find(row => row.id === replacementId);
      const message: ChatMessage = { id: original?.id ?? newId("group-scene-role"), role: "assistant", content: reply, kind: "text", speakerId: member.name, createdAt: original?.createdAt ?? Date.now(), metadata: { ...original?.metadata, source: "api", groupId: group.id, groupMemberId: member.id, characterId: character.id, replyToUserId: userId, sceneOpening: !userId && text === opening, sceneContinuation: !userId && text === continuation, groupSceneTurnId: text === continuation ? scene.continuationState?.id : undefined } };
      if (original) next.messages[next.messages.indexOf(original)] = message; else next.messages.push(message);
      await this.persist(mode, next); scene = next;
    }
    this.options.status(mode, this.stopped ? "已停止接话，已有楼层都已保存；可用「重新生成」补齐本轮。" : "");
  }
  stop() { this.stopped = true; this.controller?.abort(); }
  startOperation() { this.stopped = false; }
  async action(mode: Mode, action: "regenerate" | "continue" | "delete") {
    const scene = await this.reload(mode);
    if (!scene?.active) throw Error("请先进入进行中的多人剧场。");
    if (action === "delete") { const next = structuredClone(scene); next.messages.pop(); await this.persist(mode, next); return; }
    if (action === "continue") {
      const members = await this.responders(mode, scene, continuation), next = structuredClone(scene);
      next.continuationState = { id: newId("scene-continuation"), memberIds: members.map(member => member.id) };
      await this.persist(mode, next); await this.generate(mode, next, continuation, members); return;
    }
    const lastUser = [...scene.messages].reverse().find(row => row.role === "user");
    const last = scene.messages.at(-1);
    const continuing = !!scene.continuationState || !!last?.metadata?.sceneContinuation;
    const planned = continuing ? scene.continuationState?.memberIds ?? [] : lastUser ? Array.isArray(lastUser.metadata?.groupScenePlan) ? lastUser.metadata.groupScenePlan : [] : "openingMemberIds" in scene ? scene.openingMemberIds ?? [] : [];
    const remaining = this.groups[mode]!.members.filter(member => member.enabled && scene.memberIds?.includes(member.id) && planned.includes(member.id) && !scene.messages.some(row => (continuing ? row.metadata?.groupSceneTurnId === scene.continuationState?.id : lastUser ? row.metadata?.replyToUserId === lastUser.id : row.metadata?.sceneOpening) && row.metadata?.groupMemberId === member.id));
    const responders = remaining.length ? remaining : last?.role === "assistant" ? this.groups[mode]!.members.filter(member => member.id === last.metadata?.groupMemberId && member.enabled && scene.memberIds?.includes(member.id)) : await this.responders(mode, scene, lastUser?.content || opening);
    if (!responders.length) throw Error("上一位角色已离开本场，请使用续写，或调整群成员设置。");
    await this.options.available(responders);
    const profiles = await Promise.all(responders.map(member => storage.contactProfile(groupMemberKey(member))));
    if (profiles.some(profile => !profile.apiKey.trim())) throw Error("请先为接话角色配置聊天 API。");
    await this.generate(mode, scene, continuing ? continuation : lastUser?.content || opening, responders, continuing ? undefined : lastUser?.id, !remaining.length && last?.role === "assistant" ? last.id : undefined);
  }
  async remove(mode: Mode, ids: Set<string>) {
    const scene = await this.reload(mode); if (!scene) return;
    const next = structuredClone(scene); next.messages = next.messages.filter(row => !ids.has(row.id)); next.continuationState = undefined;
    if ("activity" in next) next.activity = next.messages.filter(row => row.role === "user").at(-1)?.content.slice(0, 120) || "从保留的现场记录继续";
    await this.persist(mode, next);
  }
  async end(mode: Mode) {
    const scene = await this.reload(mode); if (!scene) return;
    const next = { ...scene, active: false }; await this.persist(mode, next);
    if (mode === "life" && "location" in scene) {
      const group = this.groups.life!;
      const excerpt = scene.messages.slice(-4).map(row => `${row.role === "user" ? group.userName || "我" : row.speakerId}：${row.content.slice(0, 240)}`).join("\n");
      const id = `group-meeting-summary:${scene.id}:${scene.revision}`;
      await storage.addMessage({ id, role: "assistant", kind: "event", content: `多人见面记录：在${scene.location}，${scene.timeLabel}。${scene.activity}\n${excerpt}`, sessionId: group.id, createdAt: Date.now(), metadata: { event: "group_life_summary", groupId: group.id } });
    }
  }
  async saveMemory() {
    const scene = await this.reload("date"); if (!scene?.messages.length || !("title" in scene)) throw Error("这场剧场还没有可保存的内容。");
    const group = this.groups.date!, now = Date.now();
    const content = `约会剧场回忆（${scene.title}）：${scene.messages.slice(-6).map(row => `${row.role === "user" ? group.userName || "我" : row.speakerId}：${row.content.slice(0, 150)}`).join("；")}`.slice(0, 1200);
    const saved = await storage.changeGroup(group.id, row => { (row.memories ??= []).push({ id: newId("group-scene-memory"), content, enabled: true, source: "user", messageIds: scene.messages.slice(-6).map(row => row.id), createdAt: now, updatedAt: now }); });
    if (!saved) throw Error("群聊已移除，回忆未保存。");
    this.options.status("date", "已保存为本群共同回忆。");
  }
}
