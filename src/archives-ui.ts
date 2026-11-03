import { storage } from "./storage";
import "./archives.css";

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Relationship timelines use the existing database schema; switching reloads all module state. */
export class ArchivesUI {
  private dialog: HTMLDialogElement;
  private working = false;
  constructor(private busy: () => boolean) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="archives-dialog" class="archives-dialog">
      <header class="dialog-head"><div><span class="eyebrow">OUR CHAPTERS</span><h2>关系档案</h2></div><button type="button" id="archives-close" class="icon-button" aria-label="关闭档案">×</button></header>
      <p class="hint">相处进度自动保存在当前档案。聊天、关系、记忆、日记、朋友圈、旅途和游戏各自独立；头像、素材、主题与接口配置共用。</p>
      <p id="archives-status" role="status" aria-live="polite"></p>
      <section class="archive-create"><label>给这一章取个名字<input id="archive-name" maxlength="60" placeholder="例如：雨村的夏天"></label>
        <div class="archive-actions"><button id="archive-checkpoint" type="button">保存当前节点</button><button id="archive-new" type="button" class="primary">重新开档</button></div>
        <label class="check-row"><input id="archive-keep-identity" type="checkbox" checked> 新开档沿用我的称呼和偏好</label>
        <small class="hint">重新开档保留旧档案。恢复保存节点会另建分支，不覆盖任何一章。</small>
      </section>
      <div id="archives-list" class="archives-list"></div>
      <section class="archives-trash"><h3>回收站</h3><p class="hint">移入回收站的档案仍保留原记录，可恢复；当前正在使用的档案不能删除。</p><div id="archives-trash-list" class="archives-list"></div></section>
      <label class="tool-button archive-import">导入关系档案<input id="archive-import" type="file" accept="application/json" hidden></label>
      <p class="hint">档案只保存在当前浏览器，清除网站数据会丢失，请下载备份。导入始终创建独立档案，不覆盖现有记录；文件不包含接口密钥。旧版备份仍可从设置里的“恢复数据”合并。</p>
    </dialog>`);
    this.dialog = document.querySelector<HTMLDialogElement>("#archives-dialog")!;
    this.dialog.querySelector("#archives-close")!.addEventListener("click", () => { if (!this.working) this.dialog.close(); });
    this.dialog.addEventListener("cancel", e => { if (this.working) e.preventDefault(); });
    this.dialog.querySelector("#archive-checkpoint")!.addEventListener("click", () => void this.run(async () => {
      const name = this.name() || `保存节点 · ${new Date().toLocaleString()}`;
      await storage.makeArchive(name, "checkpoint"); await this.render(); this.status("节点已保存，当前进度可以继续。");
    }));
    this.dialog.querySelector("#archive-new")!.addEventListener("click", () => void this.run(async () => {
      if (!confirm("开始一段新的关系进度？当前档案完整保留，可随时切回。")) return;
      const next = await storage.makeArchive(this.name() || "新的我们", "fresh", undefined, this.dialog.querySelector<HTMLInputElement>("#archive-keep-identity")!.checked);
      await this.switchTo(next.id);
    }));
    this.dialog.querySelector<HTMLInputElement>("#archive-import")!.addEventListener("change", e => {
      const input = e.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
      if (file) void this.run(async () => {
        const value = await storage.importArchive(JSON.parse(await file.text()));
        await this.render(); this.status(`“${value.name}”已作为独立档案导入，尚未切换。`);
      });
    });
    this.dialog.querySelector("#archives-list")!.addEventListener("click", e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-archive-action]");
      if (!button) return;
      void this.run(async () => {
        const id = button.dataset.id!, action = button.dataset.archiveAction;
        const row = (await storage.archives()).find(value => value.id === id); if (!row) throw Error("找不到档案");
        if (action === "rename") { const name = prompt("修改档案名称", row.name); if (name?.trim()) await storage.renameArchive(id, name); await this.render(); }
        if (action === "switch" && confirm(`切换到“${row.name}”？当前进度已保留。`)) await this.switchTo(id);
        if (action === "restore" && confirm(`从“${row.name}”开始新的分支？当前进度和原节点都会保留。`)) {
          const next = await storage.makeArchive(`${row.name} · 续篇`, "fork", id); await this.switchTo(next.id);
        }
        if (action === "delete" && confirm(`将“${row.name}”移入回收站？其中的聊天、记忆和群聊记录会保留，可随时恢复。`)) {
          await storage.archiveToRecycleBin(id); await this.render(); this.status("已移入回收站，原记录仍然保留。");
        }
        if (action === "restore-archive" && confirm(`恢复“${row.name}”？恢复后可以继续切换使用。`)) {
          await storage.restoreArchivedArchive(id); await this.render(); this.status("档案已恢复。");
        }
        if (action === "export") {
          const blob = new Blob([JSON.stringify(await storage.exportArchive(id))], { type: "application/json" });
          const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url;
          a.download = `小张起灵-关系档案-${row.name.replace(/[\\/:*?"<>|]/g, "-")}.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000); this.status("档案文件已交给浏览器下载，请确认保存完成。");
        }
      });
    });
  }
  isOpen() { return this.dialog.open; }
  private name() { return this.dialog.querySelector<HTMLInputElement>("#archive-name")!.value.trim(); }
  private status(text: string) { this.dialog.querySelector("#archives-status")!.textContent = text; }
  private async run(action: () => Promise<void>) {
    if (this.working) return;
    if (this.busy()) { this.status("请先等待当前请求完成，结束通话或录音，再操作档案。"); return; }
    this.working = true; this.status("正在处理，请稍候…");
    this.dialog.setAttribute("aria-busy", "true"); this.disable(true);
    try { await action(); if (this.dialog.querySelector("#archives-status")!.textContent === "正在处理，请稍候…") this.status(""); }
    catch (error) { this.status(error instanceof Error ? error.message : "档案操作失败，原记录保留"); }
    finally { this.working = false; this.dialog.removeAttribute("aria-busy"); this.disable(false); }
  }
  private disable(value: boolean) {
    this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>("button, input").forEach(el => { el.disabled = value; });
  }
  private async switchTo(id: string) { await storage.selectArchive(id); location.reload(); }
  private async render() {
    const [rows, allRows, stats] = await Promise.all([storage.archives(), storage.archives(true), storage.archiveStats()]);
    const renderRow = (row: Awaited<ReturnType<typeof storage.archives>>[number], trash = false) => {
      const current = row.id === storage.activeArchiveId();
      const counts = trash ? "已移入回收站 · 原记录保留" : current ? `${stats.messages} 条消息 · ${stats.memories} 条记忆` : row.kind === "checkpoint" ? `${row.messageCount} 条消息 · ${row.memoryCount} 条记忆` : "独立关系进度 · 自动保存";
      const action = trash ? `<button type="button" data-id="${row.id}" data-archive-action="restore-archive">恢复</button>` : current ? "" : `<button type="button" data-id="${row.id}" data-archive-action="${row.kind === "checkpoint" ? "restore" : "switch"}">${row.kind === "checkpoint" ? "恢复为新分支" : "切换"}</button><button type="button" data-id="${row.id}" data-archive-action="delete">移入回收站</button>`;
      const rename = trash ? "" : `<button type="button" data-id="${row.id}" data-archive-action="rename">改名</button>`;
      return `<article class="archive-row ${current ? "archive-current" : ""} ${trash ? "archive-trashed" : ""}"><div><small>${trash ? "回收站" : current ? "正在相处" : row.kind === "checkpoint" ? "保存节点" : "关系档案"} · ${new Date(row.createdAt).toLocaleString()}</small><h3>${esc(row.name)}</h3><p>${counts}</p></div><div class="archive-actions">${action}${rename}<button type="button" data-id="${row.id}" data-archive-action="export">下载备份</button></div></article>`;
    };
    const trash = allRows.filter(row => row.archivedAt);
    this.dialog.querySelector("#archives-list")!.innerHTML = rows.map(row => renderRow(row)).join("");
    this.dialog.querySelector("#archives-trash-list")!.innerHTML = trash.length ? trash.map(row => renderRow(row, true)).join("") : `<p class="hint">回收站是空的。</p>`;
    if (this.working) this.disable(true);
  }
  async open() {
    this.status(""); this.dialog.showModal();
    try { await this.render(); } catch (error) { this.status(error instanceof Error ? error.message : "档案读取失败"); }
  }
}
