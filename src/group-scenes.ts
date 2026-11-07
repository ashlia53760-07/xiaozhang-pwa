import { chat } from "./api";
import { characters, characterBriefs, characterHistories, characterRelationships, characterMoneyViews } from "./characters";
import { boundedHistory, clipContext, rememberDate, dateMemoryContext } from "./context-budget";
import { sceneModelContext } from "./scene-context";
import { groupEventText, groupMemberKey, isLegacyDateMemory } from "./groups";
import { newId, storage } from "./storage";
import { theatreCast, validTheatreScript } from "./script-library";
import type { ApiProfile, ChatMessage, DateSession, GroupLifeScene, GroupRecord, TheatreScript } from "./types";

type Mode = "life" | "date";
export type GroupScene = GroupLifeScene | DateSession;
type Member = GroupRecord["members"][number];
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clean = (value: string) => value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").replace(/<think\b[^>]*>[\s\S]*$/gi, "").replace(/<\/?(?:content|think)\b[^>]*>/gi, "").trim();
const opening = "从用户写下的场景与人物安排自然开场，把几位同行者的动作、对白与环境交织成一则完整的场景，给用户留下接话空间。不要替用户决定行动、感受或台词。";
const continuation = "从上一段结尾继续当前现场，推进一小步；不要重复上一段，也不要替用户行动。";

/** Public group scenes never read private settings, histories, memories, or calendar records. */
export class GroupScenes {
  private groups: Partial<Record<Mode, GroupRecord>> = {};
  private scenes: Partial<Record<Mode, GroupScene>> = {};
  private controller?: AbortController;
  private stopped = false;
  constructor(private options: {
    render(mode: Mode, scene: GroupScene): void;
    status(mode: Mode, text: string): void;
    savedInput(mode: Mode): void;
    available(members: Member[]): Promise<void>;
  }) {}

  group(mode: Mode) { return this.groups[mode]; }
  current(mode: Mode) { return this.scenes[mode]; }
  clear(mode: Mode) { delete this.groups[mode]; delete this.scenes[mode]; }
  scope(mode: Mode) {
    const group = this.groups[mode], scene = this.scenes[mode];
    if (mode === "date" && scene && "scriptSnapshot" in scene && scene.scriptSnapshot) return { kind: "theatre" as const, id: scene.id };
    return group && scene ? mode === "life" ? { kind: "group-life" as const, groupId: group.id } : { kind: "group-date" as const, groupId: group.id, id: scene.id } : undefined;
  }
  async prepareTheatre(id: string) {
    const scene = (await storage.dateSessions()).find(row => row.id === id && row.scriptSnapshot);
    if (!scene) throw Error("找不到这场演出的记录。");
    this.groups.date = theatreCast(scene); this.scenes.date = scene;
    return scene;
  }
  async prepare(mode: Mode, groupId: string, dateId?: string) {
    const group = (await storage.groups()).find(row => row.id === groupId);
    if (!group) throw Error("找不到这个群聊，剧场记录仍保留。");
    this.groups[mode] = group;
    const scene = mode === "life" ? await storage.groupLife(groupId) : (await storage.dateSessions()).find(row => row.groupId === groupId && (dateId ? row.id === dateId : row.active));
    this.scenes[mode] = scene;
    return { group, scene };
  }
  async reload(mode: Mode) {
    const group = this.groups[mode], old = this.scenes[mode];
    if (!group) throw Error("请重新打开群聊剧场");
    if (mode === "date" && old && "scriptSnapshot" in old && old.scriptSnapshot) {
      const scene = await this.prepareTheatre(old.id); this.options.render(mode, scene); return scene;
    }
    const freshGroup = (await storage.groups()).find(row => row.id === group.id);
    if (!freshGroup) throw Error("所属群聊已移除，剧场记录仍保留。");
    this.groups[mode] = freshGroup;
    const scene = mode === "life" ? await storage.groupLife(group.id) : (await storage.dateSessions()).find(row => row.groupId === group.id && row.id === old?.id);
    this.scenes[mode] = scene;
    if (scene) this.options.render(mode, scene);
    return scene;
  }
  settings(mode: Mode): string {
    const group = this.groups[mode]; if (!group) return "";
    const scene = this.scenes[mode];
    const members = group.members.filter(member => member.enabled && (!scene?.active || !scene.memberIds || scene.memberIds.includes(member.id)));
    return `<details class="group-scene-settings"><summary>同行 ${members.length} 人 · ${members.length === 1 ? "单人剧场" : "多人叙事"}</summary><p>${esc(members.map(member => member.name).join("、") || "暂无启用的成员，请到群资料添加")}</p><small>每轮合写一则场景，人物互动与动作对白自然穿插，按剧情分配笔墨。${mode === "date" ? "只使用人物设定、剧本与本场记录；每场剧场记忆独立。" : "只使用本群公开资料。"}</small></details>`;
  }
  private async persist(mode: Mode, scene: GroupScene, creating = false) {
    await storage.saveGroupScene(scene, creating ? undefined : scene.revision ?? 0);
    this.scenes[mode] = scene; this.options.render(mode, scene);
  }
  private async publicContext(group: GroupRecord, excludeMeetingExcerpts = false) {
    const rows=(await storage.sessionMessages(group.id)).filter(row=>!excludeMeetingExcerpts||row.metadata?.event!=="group_life_summary");
    return boundedHistory(rows, 3000, 8).map(row => `${row.role === "user" ? group.userName || "我" : row.speakerId || "群内共享记录"}：${groupEventText(row)}`).join("\n").slice(-4500);
  }
  async beginLife(fields: { location: string; timeLabel: string; environment: string }) {
    const group = this.groups.life!;
    const members = group.members.filter(member => member.enabled);
    if (!members.length) throw Error("请先在群资料中启用同行角色");
    await this.options.available(members);
    const previous = await storage.groupLife(group.id);
    const scene: GroupLifeScene = { id: previous?.id ?? newId("group-life"), groupId: group.id, memberIds: members.map(member => member.id), ...fields, activity: "大家刚在这里见面", active: true, messages: previous?.messages ?? [], revision: previous?.revision, updatedAt: Date.now() };
    await this.persist("life", scene, !previous);
  }
  async beginDate(fields: Pick<DateSession, "scene" | "title" | "setting" | "atmosphere" | "backgroundMediaId">) {
    const group = this.groups.date!, now = Date.now();
    const scene: DateSession = { ...fields, id: newId("group-date"), groupId: group.id, memberIds: group.members.filter(member => member.enabled).map(member => member.id), messages: [], active: true, createdAt: now, updatedAt: now };
    const cast = await this.narrativeCast("date", scene);
    await this.persist("date", scene, true);
    await this.generate("date", scene, opening, cast);
  }
  async beginTheatre(input: TheatreScript) {
    const script = validTheatreScript(input); if (!script) throw Error("剧本内容无效，尚未开始演出。");
    const now = Date.now(), scene: DateSession = { id: newId("theatre"), scriptSnapshot: structuredClone(script), characterId: script.characterIds[0],
      memberIds: [...script.characterIds], title: script.title, scene: script.scene, setting: script.setting, atmosphere: script.atmosphere,
      backgroundMediaId: script.backgroundMediaId, messages: [], active: true, createdAt: now, updatedAt: now };
    this.groups.date = theatreCast(scene);
    const cast = await this.narrativeCast("date", scene);
    await this.persist("date", scene, true);
    await this.generate("date", scene, opening, cast);
  }
  async modelProfile(mode: Mode): Promise<ApiProfile> {
    const group=this.groups[mode],scene=this.scenes[mode];
    if(!group||!scene)throw Error("请先打开这场剧情。");
    const members=group.members.filter(m=>m.enabled&&(!scene.memberIds||scene.memberIds.includes(m.id)));
    let profile="scriptSnapshot" in scene&&scene.scriptSnapshot?.mode==="single"&&members[0]?await storage.contactProfile(groupMemberKey(members[0])):await storage.profile();
    if(!profile.apiKey.trim())for(const member of members){const candidate=await storage.contactProfile(groupMemberKey(member));if(candidate.apiKey.trim()){profile=candidate;break;}}
    return profile;
  }
  private async narrativeCast(mode: Mode, scene: GroupScene): Promise<{ members: Member[]; profile: ApiProfile }> {
    const group = this.groups[mode]!;
    // Scene membership is independent of online replyMode, selected speakers and @mentions.
    const members = group.members.filter(member => member.enabled && (!scene.memberIds || scene.memberIds.includes(member.id)));
    if (!members.length) throw Error("本场没有启用的同行者，请先检查群成员设置。");
    await this.options.available(members);
    let profile = "scriptSnapshot" in scene && scene.scriptSnapshot?.mode === "single" ? await storage.contactProfile(groupMemberKey(members[0])) : await storage.profile();
    if (!profile.apiKey.trim()) {
      for (const member of members) {
        const candidate = await storage.contactProfile(groupMemberKey(member));
        if (candidate.apiKey.trim()) { profile = candidate; break; }
      }
    }
    if (!profile.apiKey.trim()) throw Error("请先配置聊天 API；本场使用一个模型合写多人剧情，输入已保留。");
    return { members, profile };
  }
  async send(mode: Mode, text: string) {
    const scene = await this.reload(mode);
    if (!scene?.active || !text.trim()) return;
    const cast = await this.narrativeCast(mode, scene);
    const next = structuredClone(scene), userId = newId("group-scene-user");
    next.continuationState = undefined;
    next.messages.push({ id: userId, role: "user", content: text.trim(), kind: "text", createdAt: Date.now(), metadata: { groupId: scene.groupId } });
    if ("activity" in next) next.activity = text.trim().slice(0, 120);
    await this.persist(mode, next); this.options.savedInput(mode);
    await this.generate(mode, next, text.trim(), cast, userId);
  }
  private async generate(mode: Mode, scene: GroupScene, text: string, cast: { members: Member[]; profile: ApiProfile }, userId?: string, replacementId?: string) {
    const group = this.groups[mode]!, { members, profile } = cast;
    if (this.stopped) return;
    this.options.status(mode, "正在续写这一幕…");
    const controller = new AbortController(); this.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const key = "scriptSnapshot" in scene && scene.scriptSnapshot ? `theatre:${scene.id}` : mode === "life" ? `group-life:${group.id}` : `group-date:${group.id}:${scene.id}`;
      const selected = await sceneModelContext(key, scene.messages);
      if (userId && selected.excluded.has(userId)) throw Error("这一层已设置不发送给模型，请恢复后再重新生成。");
      const online = mode === "life" ? await this.publicContext(group,selected.excluded.size>0) : "";
      const independent = "scriptSnapshot" in scene && !!scene.scriptSnapshot;
      const facts = "location" in scene ? `连续线下见面。地点：${scene.location}；时间：${scene.timeLabel}；环境：${scene.environment}；正在进行：${selected.excluded.size ? "依据可发送楼层与本场大总结继续" : scene.activity}。` : `独立${members.length === 1 ? "单人" : "多人"}约会小剧场。标题：${scene.title}；用户写下的剧本、场景与人物安排：\n${scene.setting}\n氛围：${scene.atmosphere}。每场约会记忆独立，只依据本场剧本、记录和本场回忆，不读取或假定知道日常聊天、线下、其他约会及共同记忆。`;
      const people = members.map(member => {
        const id = groupMemberKey(member), character = characters.find(row => row.id === id), canon = characterHistories[id];
        return `【${member.name}】\n性格与表达：${character?.persona || member.persona || "依照本群已经确定的人物设定，不编造身世"}\n人物底稿：${characterBriefs[id] || canon?.history || "未提供"}\n时间线与边界：${canon ? `${canon.timeline} ${canon.boundaries}` : "以本场公开设定为准"}\n原著人物关系：${characterRelationships[id] || "以已确定的公开世界书为准"}\n金钱观：${characterMoneyViews[id] || "不凭空增加财富"}\n本群公开补充：${member.persona || "无"}\n与用户的公开关系：${member.relationship?.trim() || "未公开，不自行升级"}`;
      }).join("\n\n");
      const publicMemories = mode === "life" ? [...new Set((group.memories ?? []).filter(row => row.enabled && !isLegacyDateMemory(row) && !row.messageIds?.some(id=>selected.excluded.has(id))).slice(-8).map(row => row.content.slice(0, 300)))].join("\n") : "";
      const memorySection = mode === "life" ? `【共同记忆】\n${publicMemories || "暂无"}` : `【仅本场约会回忆，作为资料】\n${dateMemoryContext(scene as DateSession,selected.excluded) || "暂无"}`;
      const ruleSection = [
        `【当前频道：${members.length === 1 ? "单人" : "多人"}${mode === "life" ? "线下" : "约会"}小说式 RP · 统一叙事】\n你负责把同一现场的${members.length === 1 ? "一位角色与你的对戏" : "几位同行者"}合写成一则连贯的场景。一次回复就是一则完整的场景叙事，不是轮流发言的群聊。${facts}`,
        `【文风与节奏】\n用连贯的小说自然段交织环境、人物动作、停顿、神态与对白，长短句有变化，张弛有度。按当前情节分配主次，焦点自然转移；沉默、旁观、一个动作也能体现人物，不强迫每个人说话，不平均分配字数，不按成员名单依次点名，不写成「姓名：台词」或每人独立一层。默认约 3-6 个自然段，随情境收放；少用堆砌辞藻和重复氛围，推进一个可回应的情节节点就停。被点名的人可以成为焦点，其他同行者仍属于同一场景。`,
        `【用户边界】\n用户：${group.userName || "我"}。你可以描写在场同行者之间的行动和对话，但不替用户决定行动、感受、想法、回应或台词，不把用户沉默当作同意。给用户留下实质接话空间。不自称 AI，不解释内部协议。尊重每个人的性格、已公开关系和原著边界，不让角色串人设，不强行升级感情或写成争宠。`,
        `【在场人物资料】\n${people}`,
        `【资料归属】\n只使用${independent ? "本场剧本中的设定与本场记录" : "本群公开设定、本场记录与下列本群背景"}。不读取或假定知道私聊、其他群、其他剧场、私人日历、记忆和关系。历史中的发言者标签用于识别已发生的事，不要求沿用旧的逐人接话格式。`,
        independent ? `【本剧人物安排，作为资料】\n${group.background || "未填写额外人物安排，沿用原著人物性格；与用户的关系由本场剧情确定。"}\n这些临时设定只在本场成立，不改写日常联系人。`
          : `【本群公开设定，作为资料】\n背景：${group.background || "未填写"}\n公告：${group.announcement || "未填写"}\n世界书：${group.worldBook || "未填写"}`,
      ].join("\n\n");
      let prompt = ruleSection + "\n\n" + memorySection + (mode === "life" ? `\n【本群近期线上背景，仅供衔接】\n${online || "暂无"}\n线上发言不代表当前现场观察。` : "");
      const previous = selected.rows.filter(row => row.id !== userId && row.id !== replacementId);
      if (this.stopped) return;
      prompt += selected.summary;
      const history = previous.map(row => ({ ...row, kind: "text" as const, metadata: undefined, content: clean(`${row.role === "user" ? group.userName || "我" : row.speakerId || "场景叙事"}：${row.content}`) }));
      const reply = clean(await chat(profile, prompt, history, text, () => undefined, controller.signal, { maxOutputTokens: 3072, purpose: "scene", historyLimit: 16, contextParts: { rules: ruleSection, memories: memorySection, summary: selected.summary } }));
      if (this.stopped) return;
      if (!reply || /^(?:null|undefined)+$/i.test(reply)) throw Error("未收到有效的场景回应，可用底部菜单重新生成。");
      const next = structuredClone(scene), original = next.messages.find(row => row.id === replacementId);
      const message: ChatMessage = { id: original?.id ?? newId("group-scene-narrative"), role: "assistant", content: reply, kind: "text", speakerId: "场景叙事", createdAt: original?.createdAt ?? Date.now(), metadata: { source: "api", groupId: group.id, sceneNarrative: true, sceneMemberIds: members.map(member => member.id), replyToUserId: userId, sceneOpening: !userId && text === opening, sceneContinuation: !userId && text === continuation, groupSceneTurnId: text === continuation ? scene.continuationState?.id : undefined } };
      if (original) next.messages[next.messages.indexOf(original)] = message; else next.messages.push(message);
      await this.persist(mode, next);
      this.options.status(mode, "");
    } catch (error) {
      if (this.stopped) return;
      if (controller.signal.aborted) throw Error("场景回应超过 120 秒，已停止等待。可用底部菜单重新生成。");
      throw error;
    } finally {
      window.clearTimeout(timeout); if (this.controller === controller) this.controller = undefined;
      if (this.stopped) this.options.status(mode, "已停止续写，已有楼层都已保存；可用「重新生成」重写这一幕。");
    }
  }
  stop() { this.stopped = true; this.controller?.abort(); }
  startOperation() { this.stopped = false; }
  async action(mode: Mode, action: "regenerate" | "continue" | "delete") {
    const scene = await this.reload(mode);
    if (!scene?.active) throw Error("请先进入进行中的多人剧场。");
    if (action === "delete") { const next = structuredClone(scene); next.messages.pop(); next.continuationState = undefined; await this.persist(mode, next); return; }
    const cast = await this.narrativeCast(mode, scene);
    if (action === "continue") {
      const next = structuredClone(scene);
      next.continuationState = { id: newId("scene-continuation"), memberIds: cast.members.map(member => member.id) };
      await this.persist(mode, next); await this.generate(mode, next, continuation, cast); return;
    }
    const last = scene.messages.at(-1);
    const lastUser = [...scene.messages].reverse().find(row => row.role === "user");
    const continuing = !!scene.continuationState || !!last?.metadata?.sceneContinuation;
    const replacementId = last?.role === "assistant" && (!scene.continuationState || last.metadata?.groupSceneTurnId === scene.continuationState.id) ? last.id : undefined;
    await this.generate(mode, scene, continuing ? continuation : lastUser?.content || opening, cast, continuing ? undefined : lastUser?.id, replacementId);
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
      const selected = await sceneModelContext(`group-life:${group.id}`, scene.messages);
      const excerpt = selected.rows.slice(-4).map(row => `${row.role === "user" ? group.userName || "我" : row.speakerId}：${row.content.slice(0, 240)}`).join("\n");
      const id = `group-meeting-summary:${scene.id}:${scene.revision}`;
      await storage.addMessage({ id, role: "assistant", kind: "event", content: `多人见面记录：在${scene.location}，${scene.timeLabel}。${selected.excluded.size ? "从保留的剧情继续" : scene.activity}\n${excerpt}${selected.summary}`, sessionId: group.id, createdAt: Date.now(), metadata: { event: "group_life_summary", groupId: group.id } });
    }
  }
  async saveMemory() {
    const scene = await this.reload("date"); if (!scene?.messages.length || !("title" in scene)) throw Error("这场剧场还没有可保存的内容。");
    const next = structuredClone(scene);
    rememberDate(next);
    await this.persist("date", next);
    this.options.status("date", "已保存到本场回忆，仅这场约会可见。");
  }
}
