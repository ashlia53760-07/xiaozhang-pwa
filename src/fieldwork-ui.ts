import type { ApiProfile, FieldworkAdventure, FieldworkBrowserResult, FieldworkData, FieldworkEvidence, FieldworkForumPost, FieldworkInvestigation, GroupRecord } from "./types";
import { ambientBrowserResults, builtinBrowserResults, builtinForumPosts, dailyBrowserResults, dailyForumPosts, emptyFieldwork, evidencePrompt, fieldworkPrompt, normalizeFieldwork, referenceIndex, searchUrl } from "./fieldwork";

type FieldworkStorage = { fieldwork<T extends FieldworkData>(): Promise<T | undefined>; saveFieldwork<T extends FieldworkData>(value: T): Promise<void> };
type Options = {
  storage: FieldworkStorage;
  profile: () => ApiProfile;
  groups: () => Promise<GroupRecord[]>;
  analyze: (prompt: string) => Promise<string>;
  refreshForum: (prompt: string) => Promise<string>;
  browserAssist: (prompt: string) => Promise<string>;
  share: (groupId: string, content: string) => Promise<void>;
  createDiscussionGroup: (investigation: FieldworkInvestigation, evidence: FieldworkEvidence[], memberIds: string[]) => Promise<string>;
  contacts: Array<{ id: string; name: string; avatarName: string }>;
  openContact: (characterId: string) => Promise<void>;
  enterAdventure: (investigation: FieldworkInvestigation, groupId: string, evidence: FieldworkEvidence[]) => Promise<string>;
  openAdventure: (id: string) => Promise<void>;
  error: (message: string) => void;
};

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const uid = (kind: string) => `${kind}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
type BrowserTabState = { id: string; history: string[]; historyIndex: number };

export class FieldworkUI {
  private dialog: HTMLDialogElement;
  private data = emptyFieldwork();
  private tab: "forum" | "browser" | "library" | "case" = "forum";
  private selectedInvestigationId = "";
  private busy = false;
  private forumBoard = "全部";
  private forumSearch = "";
  private forumPage = 1;
  private forumReplyPage = 1;
  private selectedForumPostId = "";
  private showForumComposer = false;
  private browserTabs: BrowserTabState[] = [{ id: "tab-start", history: [], historyIndex: -1 }];
  private browserActiveTabId = "tab-start";
  private browserTabsOpen = false;

  constructor(private options: Options) {
    document.body.insertAdjacentHTML("beforeend", `<dialog class="fieldwork-dialog" id="fieldwork-dialog"><div class="fieldwork-screen">
      <header class="fieldwork-header"><button type="button" data-close aria-label="返回">‹</button><div><span>FIELD NOTES</span><h2 data-page-title>线索论坛</h2></div><button type="button" data-new-case aria-label="新建线索档案">＋</button></header>
      <div class="fieldwork-scroll">
        <section data-panel="forum">
          <div data-forum-home>
            <div class="forum-masthead"><div><span>山野见闻 · 线索交流</span><h3>旧路、旧物与途中听来的事</h3><p>这里有考据、闲聊，也有没来得及核实的传闻。</p></div><button type="button" data-forum-refresh aria-label="刷新论坛">↻<small>刷新讨论</small></button></div>
            <div class="forum-pinned-note"><b>置顶说明</b><span>本页讨论为应用内虚构内容；线索与原作事实请分开核对。</span></div>
            <nav class="forum-board-nav" data-forum-boards aria-label="论坛分类"></nav>
            <form class="forum-search" data-forum-search><input name="query" type="search" placeholder="搜索帖子或作者"><button>搜索</button></form>
            <div class="forum-list-heading"><span data-forum-count>最近讨论</span><span data-forum-status role="status"></span></div>
            <div class="fieldwork-list forum-list" data-forum-list></div>
            <nav class="forum-pagination" data-forum-pagination aria-label="帖子分页"></nav>
            <form class="forum-compose" data-forum-compose hidden><label>标题<input name="title" maxlength="100" required placeholder="写一个清楚的标题"></label><label>版块<select name="board"><option>山野见闻</option><option>器物考据</option><option>档案拾遗</option><option>地图闲谈</option><option>日常闲聊</option><option>途中生活</option><option>地方见闻</option><option>夜间灌水</option></select></label><label>正文<textarea name="text" rows="5" maxlength="2400" required placeholder="把你看到的、听到的或想讨论的写下来"></textarea></label><div><button type="button" data-forum-compose-cancel>取消</button><button class="fieldwork-primary">发布帖子</button></div></form>
          </div>
          <article class="forum-detail" data-forum-detail hidden></article>
        </section>
        <section data-panel="browser" hidden>
          <div class="browser-chrome"><div class="browser-controls"><button type="button" data-browser-back aria-label="后退">‹</button><button type="button" data-browser-forward aria-label="前进">›</button><button type="button" data-browser-reload aria-label="刷新">↻</button><span>本机资料浏览器</span><button type="button" data-browser-tabs aria-label="标签页">▢ <b data-browser-tab-count>1</b></button></div><form class="fieldwork-search browser-address-form"><span>⌕</span><input data-search type="search" placeholder="搜索资料或输入关键词"><button>搜索</button></form></div>
          <div class="browser-content">
            <div class="browser-home" data-browser-home><div class="browser-brand"><span class="browser-brand-mark">M</span><div><strong>MiMi 浏览器</strong><small>角色生活 · 本机资料</small></div></div><p class="browser-home-note">从已保存的资料、论坛讨论开始探索；需要联网核对时可前往外部搜索。</p><div class="browser-shortcuts"><button type="button" data-browser-shortcut="forum"><i>论</i><span>山野论坛</span></button><button type="button" data-browser-shortcut="library"><i>索</i><span>资料索引</span></button><button type="button" data-browser-shortcut="external"><i>↗</i><span>网页搜索</span></button><button type="button" data-browser-shortcut="saved"><i>记</i><span>已存线索</span></button></div><section class="browser-quick-search"><h4>试试这样搜</h4><div data-browser-suggestions></div></section><section class="browser-daily"><header><h4>今日窗口</h4><span>本地更新 · 不影响调查</span></header><div data-browser-daily></div></section><p class="browser-limit-note">此处展示本机索引、保存的内容及模型整理结果，不等同于实时网页检索。</p></div>
            <div class="browser-results-view" data-browser-results-view hidden><div class="browser-result-toolbar"><span data-browser-address>xiaozhang.local/home</span><button type="button" data-browser-assist>用 API 整理</button></div><p class="fieldwork-inline-status" data-browser-status role="status"></p><div data-search-results class="fieldwork-list"></div><div data-browser-results class="browser-result-list"></div><div class="browser-real-search"><span>需要核对原始来源？</span><a data-external-search href="#" target="_blank" rel="noopener noreferrer">打开真实搜索 ↗</a></div></div>
            <div class="browser-tabs-sheet" data-browser-tabs-sheet hidden><header><strong>标签页</strong><button type="button" data-browser-new-tab>＋ 新标签页</button></header><div data-browser-tab-list></div></div>
          </div>
        </section>
        <section data-panel="library" hidden><div class="fieldwork-intro"><span>REFERENCE INDEX</span><h3>资料索引</h3><p>索引提供检索方向，不收录小说正文。你可以从这里建立调查档案，再回到内置浏览器整理。</p></div><div data-library class="fieldwork-list"></div></section>
        <section data-panel="case" hidden><div class="fieldwork-intro"><span>LOCAL DOSSIER</span><h3>线索整理</h3><p>把论坛、网页摘录和自己的判断分别收进档案。线索不会自动变成结论。</p></div><div class="fieldwork-case-layout"><aside data-case-list></aside><div class="fieldwork-case-detail"><div data-case-detail></div><div data-evidence-list class="fieldwork-evidence-list"></div><form data-evidence-form class="fieldwork-form"><input name="title" maxlength="100" placeholder="材料标题" required><input name="sourceName" maxlength="100" placeholder="来源名称，如书名、网站或帖子"><input name="url" type="url" placeholder="来源链接（可选）"><select name="kind"><option value="source">可追溯来源</option><option value="rumor">未核实传闻</option><option value="user_note">我的观察</option></select><textarea name="excerpt" rows="3" maxlength="2400" placeholder="粘贴你选择的摘录或写下观察" required></textarea><button class="fieldwork-primary">保存材料</button></form><div class="fieldwork-actions"><button data-analyze>整理已选材料</button><select data-share-group aria-label="选择分享群聊"></select><button data-share>分享给群聊</button></div><div class="fieldwork-case-next"><div><strong>线索有眉目了？</strong><span>带着这份档案去和角色们讨论，或直接进入现场。</span></div><div class="fieldwork-actions"><button data-create-group>一键组建讨论群</button><button data-custom-group>自选成员</button><button data-enter-adventure class="fieldwork-primary">进入多人线下 RP</button></div><div data-case-group-picker hidden><p>选择参与讨论的联系人</p><div data-case-members></div><button data-case-group-confirm class="fieldwork-primary">创建群聊并分享档案</button></div></div><p class="fieldwork-status" data-case-status role="status"></p><section class="fieldwork-saved-adventures"><h4>多人线下记录</h4><div data-adventure-list class="fieldwork-list"></div><div data-adventure-stage hidden><div data-adventure-title class="fieldwork-adventure-title"></div><p class="fieldwork-empty">冒险在「线下」全屏页面继续，沿用现场描写与自由行动输入。</p><button type="button" data-resume-adventure class="fieldwork-primary">进入线下现场</button><div class="fieldwork-actions"><select data-adventure-share-group aria-label="选择总结群聊"></select><button data-adventure-share>把进展分享回群聊</button></div><p data-adventure-status class="fieldwork-status" role="status"></p></div></section></div></div></section>
      </div>
      <nav class="forum-bottom-nav" data-forum-bottom-nav aria-label="论坛导航"><button type="button" data-forum-nav-home aria-current="page"><span>⌂</span><small>首页</small></button><button type="button" data-forum-nav-boards><span>▤</span><small>版块</small></button><button type="button" class="forum-publish" data-forum-nav-compose><span>＋</span><small>发帖</small></button><button type="button" data-forum-nav-search><span>⌕</span><small>搜索</small></button></nav>
      <nav class="browser-bottom-nav" data-browser-bottom-nav aria-label="浏览器导航" hidden><button type="button" data-browser-nav-back aria-label="后退">‹</button><button type="button" data-browser-nav-home aria-label="主页">⌂</button><button type="button" data-browser-nav-tabs aria-label="标签页">▢ <span data-browser-nav-count>1</span></button></nav>
    </div></dialog>`);
    this.dialog = document.querySelector<HTMLDialogElement>("#fieldwork-dialog")!;
    this.bind();
  }

  async open(page: typeof this.tab = "forum") {
    this.data = normalizeFieldwork(await this.options.storage.fieldwork()) ?? emptyFieldwork();
    if (!this.data.investigations.some((item) => item.id === this.selectedInvestigationId)) this.selectedInvestigationId = this.data.investigations[0]?.id ?? "";
    await this.save();
    this.setTab(page);
    this.dialog.showModal();
    await this.render();
  }

  private async save() { await this.options.storage.saveFieldwork(this.data); }
  private currentCase() { return this.data.investigations.find((item) => item.id === this.selectedInvestigationId); }
  private setTab(tab: typeof this.tab) {
    this.tab = tab;
    this.dialog.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
    this.dialog.querySelector<HTMLElement>("[data-page-title]")!.textContent = ({ forum: "线索论坛", browser: "内置浏览器", library: "资料索引", case: "线索整理" })[tab];
    this.dialog.querySelector<HTMLButtonElement>("[data-new-case]")!.hidden = tab !== "case";
    this.dialog.querySelector<HTMLElement>("[data-forum-bottom-nav]")!.hidden = tab !== "forum" || this.showForumComposer;
    this.dialog.querySelector<HTMLElement>("[data-browser-bottom-nav]")!.hidden = tab !== "browser";
  }

  private bind() {
    this.dialog.querySelector("[data-close]")!.addEventListener("click", () => this.dialog.close());
    this.dialog.querySelector("[data-new-case]")!.addEventListener("click", () => { void this.createCase(); });
    this.dialog.querySelector<HTMLFormElement>(".fieldwork-search")!.addEventListener("submit", (event) => { event.preventDefault(); void this.search(); });
    this.dialog.querySelector<HTMLFormElement>("[data-forum-search]")!.addEventListener("submit", (event) => { event.preventDefault(); const input = (event.currentTarget as HTMLFormElement).elements.namedItem("query") as HTMLInputElement; this.forumSearch = input.value.trim(); this.forumPage = 1; this.selectedForumPostId = ""; this.showForumComposer = false; this.renderForum(); });
    this.dialog.querySelector("[data-forum-refresh]")!.addEventListener("click", () => { void this.refreshForum(); });
    this.dialog.querySelector("[data-browser-assist]")!.addEventListener("click", () => { void this.browserAssist(); });
    this.dialog.querySelector("[data-forum-compose-cancel]")!.addEventListener("click", () => { this.showForumComposer = false; this.renderForum(); });
    this.dialog.querySelector<HTMLFormElement>("[data-forum-compose]")!.addEventListener("submit", (event) => { event.preventDefault(); void this.createForumPost(event.currentTarget as HTMLFormElement); });
    this.dialog.querySelector("[data-forum-nav-home]")!.addEventListener("click", () => { this.selectedForumPostId = ""; this.showForumComposer = false; this.forumSearch = ""; this.forumBoard = "全部"; this.forumPage = 1; this.renderForum(); });
    this.dialog.querySelector("[data-forum-nav-boards]")!.addEventListener("click", () => { if (this.selectedForumPostId) { this.selectedForumPostId = ""; this.renderForum(); } this.dialog.querySelector("[data-forum-boards]")!.scrollIntoView({ behavior: "smooth", block: "center" }); });
    this.dialog.querySelector("[data-forum-nav-compose]")!.addEventListener("click", () => { this.selectedForumPostId = ""; this.showForumComposer = true; this.renderForum(); this.dialog.querySelector<HTMLInputElement>("[data-forum-compose] input[name=title]")?.focus(); });
    this.dialog.querySelector("[data-forum-nav-search]")!.addEventListener("click", () => { if (this.selectedForumPostId) { this.selectedForumPostId = ""; this.renderForum(); } this.dialog.querySelector<HTMLInputElement>("[data-forum-search] input")?.focus(); });
    this.dialog.querySelector("[data-browser-back]")!.addEventListener("click", () => this.browserGo(-1));
    this.dialog.querySelector("[data-browser-forward]")!.addEventListener("click", () => this.browserGo(1));
    this.dialog.querySelector("[data-browser-reload]")!.addEventListener("click", () => this.renderBrowser());
    this.dialog.querySelector("[data-browser-tabs]")!.addEventListener("click", () => this.toggleBrowserTabs());
    this.dialog.querySelector("[data-browser-nav-back]")!.addEventListener("click", () => this.browserGo(-1));
    this.dialog.querySelector("[data-browser-nav-home]")!.addEventListener("click", () => this.browserHome());
    this.dialog.querySelector("[data-browser-nav-tabs]")!.addEventListener("click", () => this.toggleBrowserTabs());
    this.dialog.querySelector("[data-browser-new-tab]")!.addEventListener("click", () => this.createBrowserTab());
    this.dialog.querySelector("[data-browser-shortcut=forum]")!.addEventListener("click", () => this.setTab("forum"));
    this.dialog.querySelector("[data-browser-shortcut=library]")!.addEventListener("click", () => this.setTab("library"));
    this.dialog.querySelector("[data-browser-shortcut=external]")!.addEventListener("click", () => window.open(searchUrl("盗墓笔记 地点线索"), "_blank", "noopener,noreferrer"));
    this.dialog.querySelector("[data-browser-shortcut=saved]")!.addEventListener("click", () => { this.browserSearch("线索"); });
    this.dialog.querySelector<HTMLFormElement>("[data-evidence-form]")!.addEventListener("submit", (event) => { event.preventDefault(); void this.addEvidence(event.currentTarget as HTMLFormElement); });
    this.dialog.querySelector("[data-analyze]")!.addEventListener("click", () => { void this.analyzeSelected(); });
    this.dialog.querySelector("[data-share]")!.addEventListener("click", () => { void this.shareSelected(); });
    this.dialog.querySelector("[data-create-group]")!.addEventListener("click", () => { void this.createDiscussionGroup(true); });
    this.dialog.querySelector("[data-custom-group]")!.addEventListener("click", () => { this.toggleCaseGroupPicker(true); });
    this.dialog.querySelector("[data-case-group-confirm]")!.addEventListener("click", () => { void this.createDiscussionGroup(); });
    this.dialog.querySelector("[data-enter-adventure]")!.addEventListener("click", () => { void this.enterAdventureFromCase(); });
    this.dialog.querySelector("[data-resume-adventure]")!.addEventListener("click", () => { const adventure = this.activeAdventure(); if (adventure) void this.openAdventure(adventure.id); });
    this.dialog.querySelector("[data-adventure-share]")!.addEventListener("click", () => { void this.shareAdventure(); });
  }

  private async render() {
    const builtin = builtinForumPosts();
    const daily = dailyForumPosts();
    const existing = new Set(this.data.forumPosts.map((post) => post.id));
    const additions = [...builtin, ...daily].filter((post) => !existing.has(post.id));
    if (additions.length) { this.data.forumPosts = [...this.data.forumPosts, ...additions]; await this.save(); }
    this.renderForum(); this.renderLibrary(); this.renderCases(); await this.renderGroups(); this.renderAdventures();
    this.renderBrowser();
  }

  private renderForum() {
    const home = this.dialog.querySelector<HTMLElement>("[data-forum-home]")!;
    const detail = this.dialog.querySelector<HTMLElement>("[data-forum-detail]")!;
    const composer = this.dialog.querySelector<HTMLFormElement>("[data-forum-compose]")!;
    const list = this.dialog.querySelector<HTMLElement>("[data-forum-list]")!;
    const all = [...this.data.forumPosts].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
    const boards = ["全部", ...new Set(all.map((post) => post.board))];
    this.dialog.querySelector<HTMLElement>("[data-forum-boards]")!.innerHTML = boards.map((board) => `<button type="button" data-forum-board="${esc(board)}" aria-current="${this.forumBoard === board}">${esc(board)}</button>`).join("");
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-forum-board]").forEach((button) => button.addEventListener("click", () => { this.forumBoard = button.dataset.forumBoard!; this.forumPage = 1; this.renderForum(); }));
    const query = this.forumSearch.toLocaleLowerCase();
    const filtered = all.filter((post) => (this.forumBoard === "全部" || post.board === this.forumBoard) && (!query || `${post.title} ${post.text} ${post.author ?? ""} ${post.board} ${post.query} ${(post.floors ?? []).map((floor) => `${floor.author} ${floor.text}`).join(" ")}`.toLocaleLowerCase().includes(query)));
    const pageSize = 5; const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); this.forumPage = Math.min(this.forumPage, pageCount);
    const pageRows = filtered.slice((this.forumPage - 1) * pageSize, this.forumPage * pageSize);
    const search = this.dialog.querySelector<HTMLInputElement>("[data-forum-search] input[name=query]")!; if (search.value !== this.forumSearch) search.value = this.forumSearch;
    this.dialog.querySelector<HTMLElement>("[data-forum-count]")!.textContent = this.forumSearch || this.forumBoard !== "全部" ? `${this.forumBoard} · ${filtered.length} 条讨论` : `${filtered.length} 条最近讨论`;
    list.innerHTML = pageRows.map((post, index) => `<article class="forum-thread ${post.pinned ? "forum-thread-pinned" : ""} ${index === 0 && this.forumPage === 1 && !query ? "forum-thread-featured" : ""}"><div class="forum-thread-meta">${post.pinned ? `<span class="forum-pinned-tag">置顶</span>` : ""}<span class="forum-board-tag">${esc(post.board)}</span><span>${esc(post.universe)}</span><time>${this.formatForumTime(post.updatedAt)}</time></div><button type="button" class="forum-thread-title" data-forum-open="${esc(post.id)}">${esc(post.title)}</button><p class="forum-thread-excerpt">${esc(post.text)}</p><footer><span>${esc(post.author || "山友")} · ${post.floors?.length ?? 0} 条回复</span><div><button type="button" data-forum-open="${esc(post.id)}">查看讨论 ›</button><button type="button" data-forum-save="${esc(post.id)}">收进调查</button></div></footer></article>`).join("") || `<div class="forum-empty"><strong>这里还没有相关帖子</strong><span>试试更短的关键词，或切换到其他版块。</span></div>`;
    list.querySelectorAll<HTMLButtonElement>("[data-forum-save]").forEach((button) => button.addEventListener("click", () => { void this.saveForumLead(button.dataset.forumSave!); }));
    list.querySelectorAll<HTMLButtonElement>("[data-forum-open]").forEach((button) => button.addEventListener("click", () => { this.openForumPost(button.dataset.forumOpen!); }));
    const pageNav = this.dialog.querySelector<HTMLElement>("[data-forum-pagination]")!;
    pageNav.innerHTML = filtered.length > pageSize ? `<button type="button" data-forum-page="${Math.max(1, this.forumPage - 1)}" ${this.forumPage === 1 ? "disabled" : ""}>上一页</button>${Array.from({ length: pageCount }, (_, index) => `<button type="button" data-forum-page="${index + 1}" aria-current="${this.forumPage === index + 1}">${index + 1}</button>`).join("")}<button type="button" data-forum-page="${Math.min(pageCount, this.forumPage + 1)}" ${this.forumPage === pageCount ? "disabled" : ""}>下一页</button>` : "";
    pageNav.querySelectorAll<HTMLButtonElement>("[data-forum-page]").forEach((button) => button.addEventListener("click", () => { this.forumPage = Number(button.dataset.forumPage); this.renderForum(); this.dialog.querySelector("[data-forum-home]")!.scrollIntoView({ block: "start" }); }));
    home.hidden = !!this.selectedForumPostId;
    composer.hidden = !this.showForumComposer;
    detail.hidden = !this.selectedForumPostId || this.showForumComposer;
    this.dialog.querySelector<HTMLElement>("[data-forum-bottom-nav]")!.hidden = this.showForumComposer;
    if (this.selectedForumPostId) this.renderForumDetail(this.selectedForumPostId);
    else if (this.showForumComposer) composer.scrollIntoView({ block: "center" });
  }

  private formatForumTime(timestamp: number) { return new Date(timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

  private openForumPost(id: string) { this.selectedForumPostId = id; this.forumReplyPage = 1; this.showForumComposer = false; this.renderForum(); this.dialog.querySelector("[data-forum-detail]")!.scrollIntoView({ block: "start" }); }

  private renderForumDetail(id: string) {
    const post = this.data.forumPosts.find((item) => item.id === id); if (!post) { this.selectedForumPostId = ""; return; }
    const detail = this.dialog.querySelector<HTMLElement>("[data-forum-detail]")!;
    const floors = post.floors ?? [];
    const replyPageSize = 5;
    const replyPageCount = Math.max(1, Math.ceil(floors.length / replyPageSize));
    this.forumReplyPage = Math.min(this.forumReplyPage, replyPageCount);
    const visibleFloors = floors.slice((this.forumReplyPage - 1) * replyPageSize, this.forumReplyPage * replyPageSize);
    const replyPagination = replyPageCount > 1 ? `<nav class="forum-pagination forum-reply-pagination" data-forum-reply-pagination aria-label="回复分页"><button type="button" data-forum-reply-page="${Math.max(1, this.forumReplyPage - 1)}" ${this.forumReplyPage === 1 ? "disabled" : ""}>上一页</button>${Array.from({ length: replyPageCount }, (_, index) => `<button type="button" data-forum-reply-page="${index + 1}" aria-current="${this.forumReplyPage === index + 1}">${index + 1}</button>`).join("")}<button type="button" data-forum-reply-page="${Math.min(replyPageCount, this.forumReplyPage + 1)}" ${this.forumReplyPage === replyPageCount ? "disabled" : ""}>下一页</button></nav>` : "";
    detail.innerHTML = `<button type="button" class="forum-back-link" data-forum-back>‹ 返回帖子列表</button><article class="forum-op"><div class="forum-detail-kicker">${esc(post.board)}　/　${esc(post.universe)}</div><h3>${esc(post.title)}</h3><div class="forum-floor-author"><span class="forum-avatar">${esc((post.author || "山").slice(0, 1))}</span><span><strong>${esc(post.author || "山友")} <i>楼主</i></strong><small>${this.formatForumTime(post.createdAt)} · ${post.source === "user" ? "本地发布" : post.source === "model" ? "整理内容" : "社区帖子"}</small></span></div><p class="forum-op-text">${esc(post.text)}</p><div class="forum-detail-actions"><span>${floors.length} 条回复</span><div><button type="button" data-forum-save="${esc(post.id)}">收进调查</button><a href="${searchUrl(post.query)}" target="_blank" rel="noopener noreferrer">搜索相关资料 ↗</a></div></div></article><section class="forum-replies"><header><strong>全部回复</strong><span>${floors.length} 条</span></header>${visibleFloors.map((floor, index) => `<article class="forum-floor"><b>${((this.forumReplyPage - 1) * replyPageSize) + index + 2}F</b><div><div class="forum-reply-author"><strong>${esc(floor.author)}${floor.author === post.author ? " <i>楼主</i>" : ""}</strong><time>${this.formatForumTime(floor.createdAt)}</time></div><p>${esc(floor.text)}</p></div></article>`).join("") || `<p class="forum-empty">还没有回复，来做第一个回帖的人。</p>`}</section>${replyPagination}<form class="forum-reply-composer" data-forum-reply="${esc(post.id)}"><label for="forum-reply-text">参与讨论</label><textarea id="forum-reply-text" name="reply" maxlength="500" rows="3" placeholder="写下你的想法…" required></textarea><div><small>回复会保存在本机</small><button class="fieldwork-primary">发表回复</button></div></form>`;
    detail.querySelector("[data-forum-back]")!.addEventListener("click", () => { this.selectedForumPostId = ""; this.renderForum(); });
    detail.querySelector<HTMLButtonElement>("[data-forum-save]")!.addEventListener("click", () => { void this.saveForumLead(post.id); });
    detail.querySelectorAll<HTMLButtonElement>("[data-forum-reply-page]").forEach((button) => button.addEventListener("click", () => { this.forumReplyPage = Number(button.dataset.forumReplyPage); this.renderForumDetail(id); this.dialog.querySelector("[data-forum-detail]")!.scrollIntoView({ block: "start" }); }));
    detail.querySelector<HTMLFormElement>("[data-forum-reply]")!.addEventListener("submit", (event) => { event.preventDefault(); void this.addForumReply(event.currentTarget as HTMLFormElement); });
  }

  private async createForumPost(form: HTMLFormElement) {
    const values = new FormData(form); const title = String(values.get("title") ?? "").trim(); const text = String(values.get("text") ?? "").trim(); if (!title || !text) return;
    const now = Date.now(); const post: FieldworkForumPost = { id: uid("forum"), title: title.slice(0, 100), board: String(values.get("board") ?? "山野见闻"), universe: "原创线索", text: text.slice(0, 2400), author: "我", floors: [], query: title, source: "user", createdAt: now, updatedAt: now };
    this.data.forumPosts.unshift(post); this.forumBoard = "全部"; this.forumSearch = ""; this.forumPage = 1; this.showForumComposer = false; await this.save(); this.openForumPost(post.id);
  }

  private renderLibrary() {
    const list = this.dialog.querySelector<HTMLElement>("[data-library]")!;
    const query = this.dialog.querySelector<HTMLInputElement>("[data-search]")!.value.trim().toLocaleLowerCase();
    const rows = referenceIndex.filter((row) => !query || `${row.universe} ${row.category} ${row.title} ${row.summary} ${row.tags.join(" ")}`.toLocaleLowerCase().includes(query));
    list.innerHTML = rows.map((row) => `<article class="fieldwork-card"><div class="fieldwork-meta"><span>${esc(row.universe)}</span><span>${esc(row.category)}</span></div><h4>${esc(row.title)}</h4><p>${esc(row.summary)}</p><div class="fieldwork-actions"><button data-index-save="${row.id}">建立检索档案</button><a href="${searchUrl(`${row.universe} ${row.tags.join(" ")}`)}" target="_blank" rel="noopener noreferrer">搜索网页 ↗</a></div></article>`).join("") || `<p class="fieldwork-empty">没有匹配的内置索引。可以直接搜索网页并把来源摘录保存到档案。</p>`;
    list.querySelectorAll<HTMLButtonElement>("[data-index-save]").forEach((button) => button.addEventListener("click", () => { const row = referenceIndex.find((item) => item.id === button.dataset.indexSave); if (row) void this.createCase(`${row.universe} · ${row.title}`, row.universe); }));
  }

  private renderBrowser() {
    const input = this.dialog.querySelector<HTMLInputElement>("[data-search]")!;
    const active = this.activeBrowserTab();
    const query = active.historyIndex >= 0 ? active.history[active.historyIndex] : "";
    input.value = query;
    const home = this.dialog.querySelector<HTMLElement>("[data-browser-home]")!;
    const resultView = this.dialog.querySelector<HTMLElement>("[data-browser-results-view]")!;
    const tabsSheet = this.dialog.querySelector<HTMLElement>("[data-browser-tabs-sheet]")!;
    home.hidden = !!query || this.browserTabsOpen;
    resultView.hidden = !query || this.browserTabsOpen;
    tabsSheet.hidden = !this.browserTabsOpen;
    this.dialog.querySelector<HTMLElement>("[data-browser-tab-count]")!.textContent = String(this.browserTabs.length);
    this.dialog.querySelector<HTMLElement>("[data-browser-nav-count]")!.textContent = String(this.browserTabs.length);
    this.dialog.querySelector<HTMLButtonElement>("[data-browser-back]")!.disabled = active.historyIndex < 0;
    this.dialog.querySelector<HTMLButtonElement>("[data-browser-forward]")!.disabled = active.historyIndex >= active.history.length - 1;
    this.dialog.querySelector<HTMLButtonElement>("[data-browser-nav-back]")!.disabled = active.historyIndex < 0;
    this.dialog.querySelector<HTMLElement>("[data-browser-suggestions]")!.innerHTML = ["长白山 旧路", "拓片 纹样", "墨脱 地名沿革"].map((term) => `<button type="button" data-browser-query="${esc(term)}">${esc(term)} <span>›</span></button>`).join("");
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-browser-query]").forEach((button) => button.addEventListener("click", () => this.browserSearch(button.dataset.browserQuery!)));
    const dailyView = this.dialog.querySelector<HTMLElement>("[data-browser-daily]")!;
    const dailyRows = this.oneAdPerBrowserView(dailyBrowserResults("", Date.now()));
    dailyView.innerHTML = dailyRows.slice(0, 7).map((row) => {
      const contactId = row.kind === "ad" ? row.contactId ?? (row.id.endsWith("-ad") ? "hei-xiazi" : undefined) : undefined;
      const contactAd = !!contactId;
      const action = contactAd ? `data-browser-contact="${esc(contactId)}"` : `data-browser-daily-query="${esc(row.title)}"`;
      const className = `browser-daily-item kind-${row.kind ?? "reference"}${contactAd ? " browser-daily-contact-ad" : ""}`;
      return `<button type="button" class="${className}" ${action}><span class="browser-daily-kind">${contactAd ? "私人广告" : row.kind === "noise" ? "闲聊" : row.kind === "forum" ? "来稿" : "资讯"}</span><strong>${esc(row.title)}</strong><small>${esc(contactAd ? `${row.sourceLabel} · 点开联系` : row.sourceLabel)}</small></button>`;
    }).join("");
    dailyView.querySelectorAll<HTMLButtonElement>("[data-browser-daily-query]").forEach((button) => button.addEventListener("click", () => this.browserSearch(button.dataset.browserDailyQuery!)));
    dailyView.querySelectorAll<HTMLButtonElement>("[data-browser-contact]").forEach((button) => button.addEventListener("click", () => { void this.options.openContact(button.dataset.browserContact!); }));
    const builtins = [...builtinBrowserResults(query), ...ambientBrowserResults(query)];
    const matches = (text: string) => !query || text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const forum = this.data.forumPosts.filter((row) => matches(`${row.title} ${row.text} ${row.query}`)).map((row) => ({ id: row.id, query: row.query, title: row.title, summary: row.text, sourceLabel: `论坛线索 · ${row.author || "山友"}`, source: row.source === "model" ? "model" as const : "builtin" as const, kind: "forum" as const, createdAt: row.createdAt }));
    const evidence = this.data.evidence.filter((row) => matches(`${row.title} ${row.sourceName} ${row.excerpt}`)).map((row) => ({ id: row.id, query, title: row.title, summary: row.excerpt, sourceLabel: `调查材料 · ${row.sourceName || this.kindName(row.kind)}`, source: row.kind === "model_inference" ? "model" as const : "builtin" as const, kind: "reference" as const, createdAt: row.createdAt }));
    const saved = this.data.browserResults.filter((row) => matches(`${row.query} ${row.title} ${row.summary}`));
    const rows = this.oneAdPerBrowserView([...builtins, ...forum, ...evidence, ...saved]).slice(0, 24);
    const list = this.dialog.querySelector<HTMLElement>("[data-browser-results]")!;
    list.innerHTML = rows.map((row) => `<article class="browser-page-result kind-${row.kind ?? "reference"}"><div class="browser-result-meta"><span>${esc(row.sourceLabel)}</span><small>${row.kind === "ad" ? "广告" : row.kind === "news" ? "资讯" : row.kind === "noise" ? "闲聊" : row.kind === "forum" ? "讨论" : "资料"}</small></div><h4>${esc(row.title)}</h4><p>${esc(row.summary)}</p><div class="browser-result-actions"><button data-browser-save="${esc(row.id)}">${row.kind === "ad" ? "收藏这条信息" : "加入调查"}</button></div></article>`).join("") || `<p class="fieldwork-empty">没搜到相关内容。换个关键词试试，或者浏览下面的站点推荐。</p>`;
    list.querySelectorAll<HTMLButtonElement>("[data-browser-save]").forEach((button) => button.addEventListener("click", () => { const row = rows.find((item) => item.id === button.dataset.browserSave); if (row) void this.saveBrowserResult(row); }));
    const address = this.dialog.querySelector<HTMLElement>("[data-browser-address]")!; address.textContent = `xiaozhang.local/search?q=${encodeURIComponent(query)}`;
    const external = this.dialog.querySelector<HTMLAnchorElement>("[data-external-search]")!; external.href = query ? searchUrl(query) : searchUrl("盗墓笔记 鬼吹灯 资料");
    const engines = [["Google", searchUrl(query)], ["Bing", `https://www.bing.com/search?q=${encodeURIComponent(query)}`], ["DuckDuckGo", `https://duckduckgo.com/?q=${encodeURIComponent(query)}`]];
    this.dialog.querySelector<HTMLElement>("[data-search-results]")!.innerHTML = query ? `<div class="browser-source-note"><span>本机内容 · ${rows.length} 条</span><span>不是实时网页检索</span></div><div class="browser-engine-links">${engines.map(([name, href]) => `<a href="${href}" target="_blank" rel="noopener noreferrer">用 ${name} 查网页 ↗</a>`).join("")}</div>` : "";
    const tabList = this.dialog.querySelector<HTMLElement>("[data-browser-tab-list]")!;
    tabList.innerHTML = this.browserTabs.map((tab, index) => { const tabQuery = tab.historyIndex >= 0 ? tab.history[tab.historyIndex] : ""; return `<article class="browser-tab-card" aria-current="${tab.id === this.browserActiveTabId}"><button type="button" data-browser-select-tab="${esc(tab.id)}"><span>${tabQuery ? "⌕" : "⌂"}</span><strong>${esc(tabQuery || "新标签页")}</strong><small>标签页 ${index + 1}</small></button><button type="button" data-browser-close-tab="${esc(tab.id)}" aria-label="关闭标签页">×</button></article>`; }).join("");
    tabList.querySelectorAll<HTMLButtonElement>("[data-browser-select-tab]").forEach((button) => button.addEventListener("click", () => { this.browserActiveTabId = button.dataset.browserSelectTab!; this.browserTabsOpen = false; this.renderBrowser(); }));
    tabList.querySelectorAll<HTMLButtonElement>("[data-browser-close-tab]").forEach((button) => button.addEventListener("click", () => this.closeBrowserTab(button.dataset.browserCloseTab!)));
  }

  /** Keep the simulated browser readable: an ad is an occasional insert, not a full ad feed. */
  private oneAdPerBrowserView<T extends { kind?: string }>(rows: T[]): T[] {
    let adShown = false;
    return rows.filter((row) => {
      if (row.kind !== "ad") return true;
      if (adShown) return false;
      adShown = true;
      return true;
    });
  }

  private activeBrowserTab() { return this.browserTabs.find((tab) => tab.id === this.browserActiveTabId) ?? this.browserTabs[0]; }

  private browserSearch(query: string) {
    const value = query.trim(); if (!value) return;
    const tab = this.activeBrowserTab(); tab.history = tab.history.slice(0, tab.historyIndex + 1); tab.history.push(value); tab.historyIndex = tab.history.length - 1;
    this.browserTabsOpen = false; this.setTab("browser"); this.renderBrowser(); this.dialog.querySelector(".browser-content")!.scrollTo({ top: 0 });
  }

  private browserHome() { const tab = this.activeBrowserTab(); tab.historyIndex = -1; this.browserTabsOpen = false; this.renderBrowser(); }

  private browserGo(direction: -1 | 1) {
    const tab = this.activeBrowserTab(); const target = tab.historyIndex + direction;
    if (target < -1 || target >= tab.history.length) return;
    tab.historyIndex = target; this.browserTabsOpen = false; this.renderBrowser();
  }

  private toggleBrowserTabs() { this.browserTabsOpen = !this.browserTabsOpen; this.renderBrowser(); }

  private createBrowserTab() {
    const tab = { id: uid("tab"), history: [] as string[], historyIndex: -1 }; this.browserTabs.push(tab); this.browserActiveTabId = tab.id; this.browserTabsOpen = false; this.renderBrowser();
  }

  private closeBrowserTab(id: string) {
    if (this.browserTabs.length === 1) { const only = this.browserTabs[0]; only.history = []; only.historyIndex = -1; }
    else { const index = this.browserTabs.findIndex((tab) => tab.id === id); this.browserTabs = this.browserTabs.filter((tab) => tab.id !== id); if (this.browserActiveTabId === id) this.browserActiveTabId = this.browserTabs[Math.max(0, index - 1)].id; }
    this.renderBrowser();
  }

  private async refreshForum() {
    const status = this.dialog.querySelector<HTMLElement>("[data-forum-status]")!;
    const button = this.dialog.querySelector<HTMLButtonElement>("[data-forum-refresh]")!; if (button.disabled) return;
    if (!this.options.profile().apiKey.trim()) {
      const additions = dailyForumPosts(Date.now()).filter((post) => !this.data.forumPosts.some((existing) => existing.id === post.id));
      if (additions.length) { this.data.forumPosts = [...this.data.forumPosts, ...additions]; await this.save(); this.renderForum(); }
      status.textContent = additions.length ? `已刷新 ${additions.length} 条日常讨论。` : "今天的讨论已经看过了，明天会有新的内容。";
      return;
    }
    button.disabled = true; status.textContent = "正在刷新…";
    try {
      const raw = await this.options.refreshForum(fieldworkPrompt.forumRequest);
      const parsed = this.parseArray(raw);
      const now = Date.now();
      const posts: FieldworkForumPost[] = parsed.slice(0, 5).map((value, index) => ({ id: uid("forum"), title: String(value.title || `新线索 ${index + 1}`).slice(0, 100), board: String(value.board || "资料讨论").slice(0, 40), universe: (["盗墓笔记", "鬼吹灯", "原创线索"] as const).includes(value.universe as "盗墓笔记" | "鬼吹灯" | "原创线索") ? value.universe as FieldworkForumPost["universe"] : "原创线索", text: String(value.text || "模型未提供正文").slice(0, 900), query: String(value.query || value.title || "盗墓笔记 资料").slice(0, 160), author: String(value.author || ["山路拾遗", "爱喝热水", "匿名山友"][index % 3]).slice(0, 40), floors: this.parseFloors(value.floors, now), source: "model", createdAt: now, updatedAt: now }));
      if (!posts.length) throw Error("模型没有返回有效帖子");
      this.data.forumPosts = [...posts, ...this.data.forumPosts].slice(0, 30); await this.save(); this.renderForum(); status.textContent = `已刷新 ${posts.length} 条，均已标记为 API 整理内容。`;
    } catch (error) { status.textContent = `刷新失败：${error instanceof Error ? error.message : "请检查 API 设置"}`; }
    finally { button.disabled = false; }
  }

  private async browserAssist() {
    const query = this.dialog.querySelector<HTMLInputElement>("[data-search]")!.value.trim();
    const status = this.dialog.querySelector<HTMLElement>("[data-browser-status]")!;
    if (!query) { this.dialog.querySelector<HTMLElement>("[data-search-results]")!.innerHTML = `<div class="fieldwork-search-results"><strong>请输入关键词</strong><p>可以搜索人物、地点、器物或一条论坛线索。</p></div>`; return; }
    if (!this.options.profile().apiKey.trim()) { this.renderBrowser(); this.dialog.querySelector<HTMLElement>("[data-search-results]")!.innerHTML = `<div class="fieldwork-search-results"><strong>内置资料结果</strong><p>未配置 API，当前只显示本机索引和已保存内容。</p></div>`; return; }
    const button = this.dialog.querySelector<HTMLButtonElement>("[data-browser-assist]")!; if (button.disabled) return;
    button.disabled = true; status.textContent = "浏览器正在整理相关资料…";
    try {
      const localMaterials = [
        ...referenceIndex.map((row) => `${row.universe} · ${row.title}：${row.summary}`),
        ...this.data.forumPosts.slice(0, 12).map((row) => `论坛线索 · ${row.title}：${row.text}`),
        ...this.data.evidence.slice(0, 12).map((row) => `用户保存材料 · ${row.title} · ${row.sourceName}：${row.excerpt.slice(0, 400)}`)
      ].join("\n").slice(0, 6500);
      const raw = await this.options.browserAssist(fieldworkPrompt.browserRequest(query, localMaterials));
      const parsed = this.parseArray(raw); const now = Date.now();
      const rows: FieldworkBrowserResult[] = parsed.slice(0, 8).map((value, index) => ({ id: uid("browser"), query, title: String(value.title || `相关资料 ${index + 1}`).slice(0, 100), summary: String(value.summary || "模型未提供摘要").slice(0, 1000), sourceLabel: String(value.sourceLabel || "模型整理 · 待核").slice(0, 80), source: "model", kind: (["reference", "news", "forum", "ad", "noise"] as const).includes(value.kind as "reference" | "news" | "forum" | "ad" | "noise") ? value.kind as FieldworkBrowserResult["kind"] : "reference", createdAt: now }));
      if (!rows.length) throw Error("模型没有返回有效资料");
      this.data.browserResults = [...rows, ...this.data.browserResults].slice(0, 40); await this.save(); this.renderBrowser(); this.dialog.querySelector<HTMLElement>("[data-search-results]")!.innerHTML = `<div class="fieldwork-search-results"><strong>已增加 ${rows.length} 条模型整理结果</strong><p>这些摘要是推测和检索方向，不能替代原始来源。需要确认时请打开真实搜索。</p></div>`; status.textContent = "内置浏览器结果已保存。";
    } catch (error) { status.textContent = `整理失败：${error instanceof Error ? error.message : "请稍后重试"}`; }
    finally { button.disabled = false; }
  }

  private async saveBrowserResult(row: FieldworkBrowserResult) {
    await this.createCase(row.title, "原创线索");
    const selected = this.currentCase(); if (!selected) return;
    const now = Date.now(); const isSimulatedPage = ["news", "forum", "ad", "noise"].includes(row.kind ?? ""); const evidence: FieldworkEvidence = { id: uid("evidence"), investigationId: selected.id, title: row.title, sourceName: row.sourceLabel, excerpt: row.summary, kind: row.source === "model" ? "model_inference" : isSimulatedPage ? "rumor" : "source", createdAt: now, updatedAt: now };
    this.data.evidence.unshift(evidence); selected.evidenceIds.push(evidence.id); await this.save(); this.setTab("case"); this.renderCases();
  }

  private parseArray(raw: string): Array<Record<string, unknown>> {
    const match = raw.match(/\[[\s\S]*\]/); if (!match) return [];
    try { const value = JSON.parse(match[0]); return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : []; } catch { return []; }
  }

  private parseFloors(value: unknown, now: number): NonNullable<FieldworkForumPost["floors"]> {
    if (!Array.isArray(value)) return [];
    const tones = ["useful", "banter", "noise", "alarmist"] as const;
    return value.slice(0, 8).flatMap((floor, index) => {
      if (!floor || typeof floor !== "object") return [];
      const row = floor as Record<string, unknown>;
      const tone = tones.includes(row.tone as typeof tones[number]) ? row.tone as typeof tones[number] : undefined;
      return [{ id: uid("floor"), author: String(row.author || `山友${index + 1}`).slice(0, 40), text: String(row.text || "路过看看").slice(0, 500), tone, createdAt: now + index * 1000 }];
    });
  }

  private async search() {
    const query = this.dialog.querySelector<HTMLInputElement>("[data-search]")!.value.trim();
    if (!query) return;
    this.browserSearch(query);
  }

  private async createCase(title?: string, universe: FieldworkInvestigation["universe"] = "原创线索") {
    const now = Date.now();
    const value: FieldworkInvestigation = { id: uid("case"), title: title || "未命名调查", universe, status: "collecting", evidenceIds: [], notes: "", createdAt: now, updatedAt: now };
    this.data.investigations.unshift(value); this.selectedInvestigationId = value.id; await this.save(); this.setTab("case"); await this.render();
    if (!title) {
      const name = window.prompt("给这份调查起个名字", "新的线索调查");
      if (name?.trim()) { value.title = name.trim().slice(0, 100); await this.save(); this.renderCases(); }
    }
  }

  private async addForumReply(form: HTMLFormElement) {
    const post = this.data.forumPosts.find((row) => row.id === form.dataset.forumReply);
    const text = String(new FormData(form).get("reply") ?? "").trim();
    if (!post || !text) return;
    const now = Date.now();
    post.floors = [...(post.floors ?? []), { id: uid("floor"), author: "我", text: text.slice(0, 500), tone: "useful", createdAt: now }];
    post.updatedAt = now; this.forumReplyPage = Math.ceil(post.floors.length / 5); await this.save(); this.renderForum();
  }

  private toggleCaseGroupPicker(show: boolean) {
    const picker = this.dialog.querySelector<HTMLElement>("[data-case-group-picker]")!;
    picker.hidden = !show;
    if (!show) return;
    const chosen = new Set(this.options.contacts.slice(0, 3).map((contact) => contact.id));
    picker.querySelector<HTMLElement>("[data-case-members]")!.innerHTML = this.options.contacts.map((contact) => `<label><input type="checkbox" data-fieldwork-member="${esc(contact.id)}" ${chosen.has(contact.id) ? "checked" : ""}><span>${esc(contact.name)}</span></label>`).join("");
  }

  private async createDiscussionGroup(useSuggestedMembers = false) {
    const investigation = this.currentCase(); if (!investigation) return;
    const memberIds = useSuggestedMembers
      ? this.options.contacts.slice(0, 3).map((contact) => contact.id)
      : [...this.dialog.querySelectorAll<HTMLInputElement>("[data-fieldwork-member]:checked")].map((input) => input.dataset.fieldworkMember!).slice(0, 6);
    if (memberIds.length < 2) { this.dialog.querySelector<HTMLElement>("[data-case-status]")!.textContent = "至少选两位联系人一起讨论。"; return; }
    const evidence = this.data.evidence.filter((row) => row.investigationId === investigation.id);
    const button = this.dialog.querySelector<HTMLButtonElement>("[data-case-group-confirm]")!; button.disabled = true;
    try {
      this.dialog.close();
      const groupId = await this.options.createDiscussionGroup(investigation, evidence, memberIds);
      investigation.status = "discussing"; investigation.updatedAt = Date.now();
      evidence.forEach((row) => { row.sharedGroupId = groupId; row.updatedAt = Date.now(); });
      await this.save();
    } catch (error) {
      this.options.error(`建群失败：${error instanceof Error ? error.message : "请重试"}`);
      if (!this.dialog.open) this.dialog.showModal();
    } finally { button.disabled = false; }
  }

  private async enterAdventureFromCase() {
    const investigation = this.currentCase();
    if (!investigation) { this.dialog.querySelector<HTMLElement>("[data-case-status]")!.textContent = "先选择一份线索档案，再进入多人线下。"; return; }
    const evidence = this.data.evidence.filter((row) => row.investigationId === investigation.id);
    const groupSelect = this.dialog.querySelector<HTMLSelectElement>("[data-share-group]")!;
    let groupId = groupSelect.value;
    // A stale/empty selector should not block an investigation that already has
    // a linked discussion group (especially after restoring an older backup).
    if (!groupId) {
      const groups = await this.options.groups();
      groupId = (groups.find((group) => group.fieldworkInvestigationId === investigation.id)
        ?? groups.find((group) => evidence.some((row) => row.sharedGroupId === group.id)))?.id ?? "";
      if (groupId) groupSelect.value = groupId;
    }
    if (!groupId) { this.dialog.querySelector<HTMLElement>("[data-case-status]")!.textContent = "先选择一个同行群聊，或先组建讨论群。"; return; }
    const button = this.dialog.querySelector<HTMLButtonElement>("[data-enter-adventure]")!;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const id = await this.options.enterAdventure(investigation, groupId, evidence);
      await this.openAdventure(id);
    } catch (error) { this.options.error(error instanceof Error ? error.message : "无法进入线下现场"); }
    finally { button.disabled = false; }
  }

  private async openAdventure(id: string) {
    this.dialog.close();
    try { await this.options.openAdventure(id); }
    catch (error) {
      this.options.error(error instanceof Error ? error.message : "无法打开线下现场");
      if (!this.dialog.open) this.dialog.showModal();
    }
  }

  private async saveForumLead(id: string) {
    const lead = this.data.forumPosts.find((item) => item.id === id); if (!lead) return;
    const now = Date.now();
    const investigation: FieldworkInvestigation = { id: uid("case"), title: lead.title, universe: lead.universe, status: "collecting", evidenceIds: [], notes: "", createdAt: now, updatedAt: now };
    const evidence: FieldworkEvidence = { id: uid("evidence"), title: lead.title, sourceName: `虚构线索板 · ${lead.board}`, excerpt: lead.text, kind: "rumor", investigationId: investigation.id, createdAt: now, updatedAt: now };
    investigation.evidenceIds.push(evidence.id); this.data.investigations.unshift(investigation); this.data.evidence.unshift(evidence); this.selectedInvestigationId = investigation.id; await this.save(); this.setTab("case"); await this.render();
  }

  private renderCases() {
    const cases = this.dialog.querySelector<HTMLElement>("[data-case-list]")!;
    cases.innerHTML = this.data.investigations.map((row) => `<button type="button" class="fieldwork-case-row" data-case-id="${row.id}" aria-current="${row.id === this.selectedInvestigationId}"><strong>${esc(row.title)}</strong><small>${esc(row.universe)} · ${row.evidenceIds.length} 条材料</small></button>`).join("") || `<p class="fieldwork-empty">还没有调查。可以从论坛或资料索引开始。</p>`;
    cases.querySelectorAll<HTMLButtonElement>("[data-case-id]").forEach((button) => button.addEventListener("click", () => { this.selectedInvestigationId = button.dataset.caseId!; this.renderCases(); }));
    const detail = this.dialog.querySelector<HTMLElement>("[data-case-detail]")!;
    const selected = this.currentCase();
    detail.innerHTML = selected ? `<label>档案名称<input data-case-title maxlength="100" value="${esc(selected.title)}"></label><label>调查状态<select data-case-status-select><option value="collecting">收集中</option><option value="discussing">讨论中</option><option value="adventure">冒险进行</option><option value="closed">已归档</option></select></label>` : `<p class="fieldwork-empty">选择一份调查，或点右上角创建。</p>`;
    const statusSelect = detail.querySelector<HTMLSelectElement>("[data-case-status-select]"); if (statusSelect && selected) statusSelect.value = selected.status;
    detail.querySelector<HTMLInputElement>("[data-case-title]")?.addEventListener("change", (event) => { if (selected) { selected.title = (event.currentTarget as HTMLInputElement).value.trim() || selected.title; selected.updatedAt = Date.now(); void this.save(); this.renderCases(); } });
    statusSelect?.addEventListener("change", () => { if (selected) { selected.status = statusSelect.value as FieldworkInvestigation["status"]; selected.updatedAt = Date.now(); void this.save(); } });
    const evidence = this.dialog.querySelector<HTMLElement>("[data-evidence-list]")!;
    const rows = this.data.evidence.filter((row) => row.investigationId === selected?.id);
    evidence.innerHTML = rows.map((row) => `<label class="fieldwork-evidence"><input type="checkbox" data-evidence-select="${row.id}" checked><span><strong>${esc(row.title)}</strong><small>${esc(row.sourceName || "未注明来源")} · ${this.kindName(row.kind)}</small><p>${esc(row.excerpt)}</p>${row.url ? `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">打开来源 ↗</a>` : ""}</span><button type="button" data-evidence-remove="${row.id}" aria-label="删除材料">×</button></label>`).join("") || `<p class="fieldwork-empty">选择性添加材料；不要把未经核实的传闻当作事实。</p>`;
    evidence.querySelectorAll<HTMLButtonElement>("[data-evidence-remove]").forEach((button) => button.addEventListener("click", () => { if (!selected) return; const id = button.dataset.evidenceRemove!; this.data.evidence = this.data.evidence.filter((row) => row.id !== id); selected.evidenceIds = selected.evidenceIds.filter((value) => value !== id); void this.save().then(() => this.renderCases()); }));
    const form = this.dialog.querySelector<HTMLFormElement>("[data-evidence-form]")!;
    const actions = this.dialog.querySelector<HTMLElement>(".fieldwork-case-detail .fieldwork-actions")!;
    form.hidden = !selected; actions.hidden = !selected;
    this.dialog.querySelector<HTMLElement>("[data-case-group-picker]")!.hidden = true;
    this.dialog.querySelector<HTMLElement>(".fieldwork-case-next")!.hidden = !selected;
  }

  private async addEvidence(form: HTMLFormElement) {
    const selected = this.currentCase(); if (!selected) return;
    const fields = new FormData(form); const now = Date.now();
    const row: FieldworkEvidence = { id: uid("evidence"), investigationId: selected.id, title: String(fields.get("title") ?? "").trim(), sourceName: String(fields.get("sourceName") ?? "").trim(), url: String(fields.get("url") ?? "").trim() || undefined, excerpt: String(fields.get("excerpt") ?? "").trim(), kind: String(fields.get("kind")) as FieldworkEvidence["kind"], createdAt: now, updatedAt: now };
    this.data.evidence.unshift(row); selected.evidenceIds.push(row.id); selected.updatedAt = now; await this.save(); form.reset(); this.renderCases();
  }

  private selectedEvidence() {
    const ids = [...this.dialog.querySelectorAll<HTMLInputElement>("[data-evidence-select]:checked")].map((input) => input.dataset.evidenceSelect);
    return this.data.evidence.filter((row) => ids.includes(row.id));
  }

  private async analyzeSelected() {
    const rows = this.selectedEvidence(); const status = this.dialog.querySelector<HTMLElement>("[data-case-status]")!;
    if (!rows.length) { status.textContent = "先勾选要整理的材料。"; return; }
    if (!this.options.profile().apiKey.trim()) { status.textContent = "尚未配置聊天 API；材料已保存在本机，可之后再整理。"; return; }
    this.busy = true; status.textContent = "正在整理选中的材料…";
    try {
      const analysis = await this.options.analyze(evidencePrompt(rows));
      if (!analysis.trim()) throw Error("模型没有返回可用整理结果");
      const selected = this.currentCase(); if (!selected) return;
      const now = Date.now();
      const row: FieldworkEvidence = { id: uid("inference"), investigationId: selected.id, title: "材料整理与待核问题", sourceName: "模型根据已选摘录整理", excerpt: analysis.trim().slice(0, 4000), kind: "model_inference", createdAt: now, updatedAt: now };
      this.data.evidence.unshift(row); selected.evidenceIds.push(row.id); selected.status = "discussing"; selected.updatedAt = now; await this.save(); status.textContent = "整理完成。推断已单独标记，没有写入角色长期记忆。"; this.renderCases();
    } catch (error) { status.textContent = `整理失败：${error instanceof Error ? error.message : "请稍后重试"}`; }
    finally { this.busy = false; }
  }

  private async renderGroups() {
    const groups = await this.options.groups();
    const options = groups.map((group) => `<option value="${esc(group.id)}">${esc(group.title)}</option>`).join("");
    const selectedCase = this.currentCase();
    const preferred = selectedCase && (groups.find((group) => group.fieldworkInvestigationId === selectedCase.id)
      ?? groups.find((group) => this.data.evidence.some((row) => row.investigationId === selectedCase.id && row.sharedGroupId === group.id)));
    for (const selector of this.dialog.querySelectorAll<HTMLSelectElement>("[data-share-group], [data-adventure-share-group], [name=group]")) {
      selector.innerHTML = options || `<option value="">请先创建群聊</option>`;
      if (preferred) selector.value = preferred.id;
    }
  }

  private async shareSelected() {
    const rows = this.selectedEvidence(); const groupId = this.dialog.querySelector<HTMLSelectElement>("[data-share-group]")!.value;
    if (!groupId || !rows.length) { this.dialog.querySelector<HTMLElement>("[data-case-status]")!.textContent = "选择要分享的材料和目标群聊。"; return; }
    const selected = this.currentCase(); if (!selected) return;
    const summary = rows.map((row) => `【${this.kindName(row.kind)}】${row.title}\n来源：${row.sourceName || "未注明"}${row.url ? ` · ${row.url}` : ""}\n${row.excerpt}`).join("\n\n");
    await this.options.share(groupId, `我整理了一份调查材料「${selected.title}」，想和大家一起核对：\n\n${summary}\n\n请把可追溯来源、传闻与推测分开讨论，不要把未核实内容当作事实。`);
    rows.forEach((row) => { row.sharedGroupId = groupId; row.updatedAt = Date.now(); }); await this.save();
    this.dialog.querySelector<HTMLElement>("[data-case-status]")!.textContent = "已作为一条群聊消息分享。";
  }

  private renderAdventures() {
    const list = this.dialog.querySelector<HTMLElement>("[data-adventure-list]")!;
    list.innerHTML = this.data.adventures.map((row) => `<button type="button" class="fieldwork-card fieldwork-adventure-row" data-adventure-id="${row.id}"><div class="fieldwork-meta"><span>${row.active ? "进行中" : "已结束"}</span><span>${new Date(row.updatedAt).toLocaleDateString("zh-CN")}</span></div><h4>${esc(row.title)}</h4><p>${esc(row.location)} · ${row.messages.length} 条现场记录</p></button>`).join("");
    list.querySelectorAll<HTMLButtonElement>("[data-adventure-id]").forEach((button) => button.addEventListener("click", () => { this.showAdventure(button.dataset.adventureId!); }));
  }

  private showAdventure(id: string) {
    const adventure = this.data.adventures.find((row) => row.id === id); if (!adventure) return;
    const stage = this.dialog.querySelector<HTMLElement>("[data-adventure-stage]")!; stage.hidden = false;
    this.dialog.querySelector<HTMLElement>("[data-adventure-title]")!.innerHTML = `<strong>${esc(adventure.title)}</strong><span>${esc(adventure.location)} · ${adventure.active ? "探索中" : "已结束"}</span><p>${esc(adventure.briefing).slice(0, 900)}</p>`;
    this.dialog.querySelector<HTMLButtonElement>("[data-adventure-share]")!.disabled = !adventure.messages.length;
    this.dialog.querySelector<HTMLElement>("[data-adventure-status]")!.textContent = "";
    this.dialog.querySelector<HTMLElement>("[data-adventure-stage]")!.dataset.activeAdventure = id;
  }

  private activeAdventure() {
    const id = this.dialog.querySelector<HTMLElement>("[data-adventure-stage]")!.dataset.activeAdventure;
    return this.data.adventures.find((row) => row.id === id);
  }

  private async shareAdventure() {
    const adventure = this.activeAdventure(); const groupId = this.dialog.querySelector<HTMLSelectElement>("[data-adventure-share-group]")!.value;
    if (!adventure || !groupId || !adventure.messages.length) return;
    const transcript = adventure.messages.slice(-12).map((message) => `${message.role === "user" ? "我" : message.speakerId ?? "同行者"}：${message.content}`).join("\n");
    await this.options.share(groupId, `多人冒险「${adventure.title}」现场进展\n地点：${adventure.location}\n以下为本机保存的现场记录，供大家继续讨论：\n${transcript}`);
    this.dialog.querySelector<HTMLElement>("[data-adventure-status]")!.textContent = "进展已分享回所选群聊。";
  }

  private kindName(kind: FieldworkEvidence["kind"]) {
    return ({ source: "可追溯来源", rumor: "未核实传闻", user_note: "个人观察", model_inference: "模型推断" } as const)[kind];
  }
}
