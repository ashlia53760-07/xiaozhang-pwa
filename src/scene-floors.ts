import { storage, type SceneFloorScope, type SceneFloorRow, type SceneFloorChange } from "./storage";

type Mode = "life" | "date";
interface Options {
  scope(mode: Mode): SceneFloorScope | undefined;
  busy(): boolean;
  lock(value: boolean): void;
  changed(scope: SceneFloorScope, id: string, change: SceneFloorChange): Promise<void>;
  status(mode: Mode, text: string): void;
}

export class SceneFloors {
  private dialog: HTMLDialogElement;
  private text: HTMLTextAreaElement;
  private bound = new WeakSet<HTMLElement>();
  private snapshot?: { mode: Mode; scope: SceneFloorScope; rows: SceneFloorRow[]; id: string; index: number };
  private saving = false;
  private revision = 0;
  constructor(private options: Options) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="scene-floor-dialog" class="scene-reader" aria-labelledby="scene-floor-title"><form id="scene-floor-form"><header><h2 id="scene-floor-title">楼层操作</h2><button type="button" data-floor-close aria-label="关闭楼层操作">×</button></header><section id="scene-floor-menu"><button type="button" id="scene-floor-edit">编辑这一条</button><button type="button" id="scene-floor-rewind">回到这里重新开始</button><p>长按楼层可打开此菜单，电脑上也可以右键。</p></section><section id="scene-floor-editor" hidden><label for="scene-floor-text">修改内容</label><textarea id="scene-floor-text" rows="10" spellcheck="false"></textarea><p>只修改这一层；后续回复保留。想重写后续剧情，可保存后回到这一层重新开始。</p><button type="submit" id="scene-floor-save">保存修改</button></section><section id="scene-floor-confirm" hidden><p id="scene-floor-explain"></p><p>原进度会先保存到「关系档案」的保存节点中，可恢复。不会自动调用模型。</p><button type="button" id="scene-floor-confirm-rewind">确认回到这一层</button></section><p id="scene-floor-error" role="alert" hidden></p><footer><button type="button" data-floor-close>取消</button></footer></form></dialog>`);
    this.dialog = document.querySelector("#scene-floor-dialog")!;
    this.text = this.dialog.querySelector("#scene-floor-text")!;
    this.dialog.querySelectorAll("[data-floor-close]").forEach(button => button.addEventListener("click", () => { if (!this.saving) this.dialog.close(); }));
    this.dialog.addEventListener("cancel", event => { if (this.saving) event.preventDefault(); });
    this.dialog.addEventListener("close", () => { this.snapshot = undefined; ++this.revision; });
    this.dialog.querySelector("#scene-floor-edit")!.addEventListener("click", () => {
      this.pane("editor"); this.text.focus(); this.text.setSelectionRange(this.text.value.length, this.text.value.length);
    });
    this.dialog.querySelector("#scene-floor-rewind")!.addEventListener("click", () => {
      const value = this.snapshot; if (!value) return;
      this.dialog.querySelector("#scene-floor-explain")!.textContent = `保留第 ${value.index + 1} 层及之前的内容，将后续 ${value.rows.length - value.index - 1} 层移出当前剧情，再从这里接着写。`;
      this.pane("confirm");
      this.dialog.querySelector<HTMLButtonElement>("#scene-floor-confirm-rewind")!.focus();
    });
    this.dialog.querySelector("#scene-floor-form")!.addEventListener("submit", event => { event.preventDefault(); void this.save({ type: "edit", content: this.text.value }); });
    this.dialog.querySelector("#scene-floor-confirm-rewind")!.addEventListener("click", () => { void this.save({ type: "rewind" }); });
  }
  private pane(name: "menu" | "editor" | "confirm") {
    for (const id of ["menu", "editor", "confirm"]) this.dialog.querySelector<HTMLElement>(`#scene-floor-${id}`)!.hidden = id !== name;
  }
  private error(text: string) {
    const element = this.dialog.querySelector<HTMLElement>("#scene-floor-error")!;
    element.textContent = text; element.hidden = !text;
  }
  bind(target: HTMLElement, mode: Mode) {
    if (this.bound.has(target)) return;
    this.bound.add(target);
    let timer = 0, x = 0, y = 0;
    const cancel = () => { window.clearTimeout(timer); timer = 0; };
    const entry = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>(".scene-entry-paper") : null;
    const show = (paper: HTMLElement) => {
      cancel();
      if (target.classList.contains("scene-selecting") || this.options.busy()) return;
      const id = paper.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
      if (id) void this.open(mode, id);
    };
    target.addEventListener("pointerdown", event => {
      cancel();
      if (!event.isPrimary || event.button !== 0) return;
      const paper = entry(event); if (!paper) return;
      x = event.clientX; y = event.clientY;
      timer = window.setTimeout(() => show(paper), 520);
    });
    target.addEventListener("pointermove", event => { if (Math.hypot(event.clientX - x, event.clientY - y) > 9) cancel(); });
    for (const type of ["pointerup", "pointercancel", "pointerleave", "scroll"]) target.addEventListener(type, cancel, { passive: true });
    target.addEventListener("contextmenu", event => { const paper = entry(event); if (paper) { event.preventDefault(); show(paper); } });
    target.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const paper = entry(event); if (paper) { event.preventDefault(); show(paper); }
      }
    });
  }
  private async open(mode: Mode, id: string) {
    const scope = this.options.scope(mode); if (!scope || this.saving || this.dialog.open) return;
    const revision = ++this.revision;
    try {
      const rows = await storage.sceneFloors(scope), index = rows.findIndex(row => row.id === id);
      if (index < 0) throw Error("这一层已调整，请重新打开页面");
      if (revision !== this.revision || this.options.busy() || JSON.stringify(scope) !== JSON.stringify(this.options.scope(mode))) return;
      this.snapshot = { mode, scope, rows, id, index };
      this.text.value = rows[index].content;
      this.dialog.querySelector("#scene-floor-title")!.textContent = `第 ${index + 1} 层 · ${rows[index].role === "user" ? "你的落笔" : "角色回应"}`;
      this.dialog.querySelector<HTMLButtonElement>("#scene-floor-rewind")!.disabled = index === rows.length - 1;
      this.error(""); this.pane("menu"); window.getSelection()?.removeAllRanges(); this.dialog.showModal();
    } catch (error) { this.options.status(mode, error instanceof Error ? error.message : "无法读取这一层"); }
  }
  private async save(change: SceneFloorChange) {
    const value = this.snapshot;
    if (!value || this.saving) return;
    if (this.options.busy() || JSON.stringify(value.scope) !== JSON.stringify(this.options.scope(value.mode))) { this.error("现场已变化，请关闭后重新打开这一层。你的编辑仍保留。"); return; }
    this.saving = true; this.options.lock(true); this.error("");
    this.dialog.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
    this.text.readOnly = true;
    let committed = false;
    try {
      await storage.changeSceneFloor(value.scope, value.rows, value.id, change);
      committed = true; this.dialog.close();
      await this.options.changed(value.scope, value.id, change);
      this.options.status(value.mode, change.type === "edit" ? `已保存第 ${value.index + 1} 层的修改，后续对话会使用新内容。` : `已回到第 ${value.index + 1} 层，原进度已保存到关系档案。可以从这里继续。`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存失败，你的编辑内容仍保留";
      if (committed) this.options.status(value.mode, `记录已保存，显示刷新失败，请重新打开现场。${text}`);
      else this.error(text);
    } finally {
      this.saving = false; this.options.lock(false); this.text.readOnly = false;
      this.dialog.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
      if (this.snapshot) this.dialog.querySelector<HTMLButtonElement>("#scene-floor-rewind")!.disabled = this.snapshot.index === this.snapshot.rows.length - 1;
    }
  }
}
