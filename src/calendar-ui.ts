import { characters } from "./characters";
import { storage } from "./storage";
import { birthdaySources, builtInHolidays } from "./calendar-data";
import { contactBirthday, dateValue, dayKey, dayLabels, diaryDay, eventOnDay, lunarInfo, mergeCalendar, moodEmoji, moodLabel, moods, monthDays, parseIcs, periodLabels, validBirthday, validDay, validHolidayYear } from "./calendar";
import type { BirthdaySettings } from "./types";

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export class CalendarUI {
  selected = dayKey();
  month = this.selected.slice(0, 7);
  private host: HTMLElement;
  private revision = 0;
  private dirty = false;
  constructor(private changed: () => Promise<void>, private notify: (message: string) => void, private birthdaysChanged: () => Promise<void>, private isEditingDiary: () => boolean = () => false) {
    this.host = document.createElement("section"); this.host.className = "calendar-module";
    this.host.innerHTML = `<div class="calendar-heading"><div><p class="calendar-eyebrow">把日子，一天一天留下</p><h3>我们的日历</h3></div><button type="button" id="calendar-today">回到今天</button></div>
      <div class="calendar-nav"><button type="button" id="calendar-prev" aria-label="上个月">‹</button><label><span class="sr-only">选择月份</span><input type="month" id="calendar-month" min="1900-01" max="2199-12"></label><button type="button" id="calendar-next" aria-label="下个月">›</button></div>
      <div class="calendar-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(d => `<span>${d}</span>`).join("")}</div><div id="calendar-grid" class="calendar-grid" role="group" aria-label="月历日期"></div>
      <p class="calendar-legend">休 · 放假　班 · 调休上班　♥ · 生日　经 · 经期记录　● · 有记录</p><p id="calendar-season" class="calendar-season"></p><p id="calendar-holiday-source" class="hint"></p>
      <div class="calendar-tools"><button type="button" id="calendar-sync">更新本年休班安排</button><label class="calendar-file">导入 .ics 全天日程<input id="calendar-import" type="file" accept=".ics,text/calendar"></label></div><p id="calendar-status" role="status" aria-live="polite" class="hint"></p>
      <section class="calendar-day-panel"><h3 id="calendar-day-title"></h3><div id="calendar-day-events"></div>
      <form id="calendar-record-form"><div class="calendar-fields"><label>今天的心情<select id="calendar-mood"><option value="">未记录</option>${moods.map(m => `<option value="${m}">${moodLabel(m)}</option>`).join("")}</select></label><label>经期记录<select id="calendar-period"><option value="">未记录</option>${Object.entries(periodLabels).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label></div>
      <label>想记下的事<textarea id="calendar-note" rows="3" maxlength="3000" placeholder="身体感受、心情，或者今天的小事…"></textarea></label><div class="calendar-actions"><button type="submit">保存当天记录</button><button type="button" id="calendar-delete-record">清除当天记录</button></div></form></section>
      <label class="calendar-share"><input type="checkbox" id="calendar-share">让角色在私聊、通话和约会时关心我的记录</label><p class="hint">开启后，会将近七天的心情、经期、备注和我的日记带入一对一交流，也可供张起灵写夜记。关闭后不再带入新请求；已发生的对话保留。群聊与朋友圈不读取这些记录。</p>
      <details id="calendar-birthdays"><summary>生日簿 · 16 位角色与我</summary><div id="calendar-birthday-settings"></div><p class="hint">可自行设定或恢复收录日期；生日互动沿用原有提醒开关。二月二十九日只在闰年当天提醒。</p><div id="calendar-birthday-list"></div></details>
      <div class="calendar-diary-heading"><h3>日子里的文字</h3><label><input type="checkbox" id="calendar-all-diaries">查看全部日记</label></div>`;
    document.querySelector("#diary-dialog .diary-content")!.prepend(this.host);
    document.querySelector(".birthday-settings-section") && this.host.querySelector("#calendar-birthday-settings")!.append(document.querySelector(".birthday-settings-section")!);
    const diaryForm = document.querySelector("#diary-form")!;
    const date = document.createElement("label"); date.innerHTML = `记录日期<input type="date" id="diary-date" min="1900-01-01" max="2199-12-31" required>`; diaryForm.prepend(date);
    document.querySelector("#diary-query")!.setAttribute("placeholder", "搜索全部日记的标题、内容与心情");
    const on = (selector: string, event: string, action: () => Promise<void> | void) => this.host.querySelector(selector)!.addEventListener(event, () => { void Promise.resolve().then(action).catch(e => this.fail(e)); });
    on("#calendar-prev", "click", () => this.move(-1)); on("#calendar-next", "click", () => this.move(1));
    on("#calendar-today", "click", () => this.select(dayKey()));
    on("#calendar-month", "change", async () => { const value = this.el<HTMLInputElement>("#calendar-month").value; if (validDay(`${value}-01`)) await this.select(`${value}-01`); });
    on("#calendar-all-diaries", "change", () => this.changed());
    for (const selector of ["#birthday-enabled", "#user-birthday"]) on(selector, "change", async () => {
      const enabled = this.el<HTMLInputElement>("#birthday-enabled").checked, value = this.el<HTMLInputElement>("#user-birthday").value;
      const user = value ? { month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) } : undefined;
      if (user && !validBirthday(user)) { this.status("请选择有效生日"); return; }
      await storage.saveBirthdaySettings({ ...await storage.birthdaySettings(), enabled, user, updatedAt: Date.now() });
      await this.birthdaysChanged(); await this.changed(); this.status("生日提醒设置已保存");
    });
    this.el("#calendar-record-form").addEventListener("input", () => { this.dirty = true; });
    this.el("#calendar-record-form").addEventListener("submit", event => { event.preventDefault(); void this.saveRecord().catch(e => this.fail(e)); });
    on("#calendar-delete-record", "click", async () => {
      const date = this.selected;
      if (!window.confirm(`清除 ${date} 的心情、经期和备注？日记会保留。`)) return;
      await storage.updateCalendar(data => { delete data.records[date]; return data; });
      this.dirty = false; await this.changed(); this.status("当天记录已清除");
    });
    on("#calendar-share", "change", async () => { const share = this.el<HTMLInputElement>("#calendar-share").checked; await storage.updateCalendar(data => ({ ...data, shareWithChat: share })); this.status(share ? "已开启私聊关心" : "已关闭记录共享"); });
    on("#calendar-sync", "click", () => this.syncHolidays());
    on("#calendar-import", "change", () => this.importCalendar());
    document.querySelector("#diary-dialog")!.addEventListener("cancel", event => { if (this.dirty && !window.confirm("有尚未保存的日历记录，放弃修改并关闭？")) event.preventDefault(); else this.dirty = false; });
    document.querySelector("#diary-dialog form[method=dialog]")!.addEventListener("submit", event => { if (this.dirty && !window.confirm("有尚未保存的日历记录，放弃修改并关闭？")) event.preventDefault(); else this.dirty = false; });
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string): T { return this.host.querySelector<T>(selector)!; }
  private status(text: string) { this.el("#calendar-status").textContent = text; }
  private fail(error: unknown) { const message = error instanceof Error ? error.message : "日历操作失败，请重试"; this.status(message); this.notify(message); }
  async select(date: string): Promise<void> {
    if (!validDay(date)) return;
    if (this.dirty && !window.confirm("当天记录尚未保存，放弃修改并切换日期？")) return;
    this.dirty = false; this.selected = date; this.month = date.slice(0, 7);
    if (!this.isEditingDiary()) document.querySelector<HTMLInputElement>("#diary-date")!.value = date;
    await this.changed();
  }
  private async move(delta: number) { const date = dateValue(`${this.month}-01`); date.setMonth(date.getMonth() + delta); if (validDay(dayKey(date))) await this.select(dayKey(date)); }
  allDiaries(): boolean { return this.el<HTMLInputElement>("#calendar-all-diaries").checked; }
  async render(): Promise<void> {
    const revision = ++this.revision;
    const [data, settings, diaries] = await Promise.all([storage.calendar(), storage.birthdaySettings(), storage.diaries()]);
    if (revision !== this.revision) return;
    this.el<HTMLInputElement>("#calendar-month").value = this.month;
    this.el<HTMLInputElement>("#calendar-share").checked = data.shareWithChat;
    this.el<HTMLInputElement>("#birthday-enabled").checked = settings.enabled;
    if (document.activeElement !== this.el("#user-birthday")) this.el<HTMLInputElement>("#user-birthday").value = settings.user ? `2000-${String(settings.user.month).padStart(2, "0")}-${String(settings.user.day).padStart(2, "0")}` : "";
    const birthdays = (key: string) => characters.filter(c => { const b = contactBirthday(c.id, settings); return b && key.slice(5) === `${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`; }).map(c => `${c.name}生日`);
    const userBirthday = (key: string) => settings.user && key.slice(5) === `${String(settings.user.month).padStart(2, "0")}-${String(settings.user.day).padStart(2, "0")}`;
    const grid = this.el("#calendar-grid");
    grid.innerHTML = monthDays(this.month).map(key => {
      const { labels, holiday } = dayLabels(key, data), b = birthdays(key); if (userBirthday(key)) b.unshift("我的生日");
      const hasNote = !!data.records[key] || diaries.some(d => diaryDay(d) === key), event = data.events.some(e => eventOnDay(e, key));
      const period = data.records[key]?.period;
      const caption = labels[0] || (b.length ? b[0].replace("生日", "") : lunarInfo(key).label);
      return `<button type="button" class="calendar-cell ${key.startsWith(this.month) ? "" : "outside"} ${key === dayKey() ? "today" : ""}" data-calendar-day="${key}" aria-pressed="${key === this.selected}" aria-label="${esc([key, ...labels, holiday ? holiday.isOffDay ? "放假" : "调休上班" : "", ...b, data.records[key]?.mood ? moodLabel(data.records[key].mood!) : "", period ? periodLabels[period] : "", hasNote ? "有记录" : "", event ? "有日程" : ""].filter(Boolean).join("，"))}"><span class="calendar-day-number">${Number(key.slice(8))}</span>${holiday ? `<small class="calendar-off ${holiday.isOffDay ? "" : "work"}">${holiday.isOffDay ? "休" : "班"}</small>` : ""}<span class="calendar-cell-label ${labels.length ? "festival" : ""}">${esc(caption)}</span><span class="calendar-dots">${b.length ? "♥" : ""}${period && period !== "none" ? '<span class="calendar-period-mark"> 经</span>' : hasNote ? " ●" : ""}${data.records[key]?.mood && moodEmoji[data.records[key].mood!] ? `<span class="calendar-mood-mark" aria-hidden="true"> ${moodEmoji[data.records[key].mood!]}</span>` : ""}${event ? " ·" : ""}</span></button>`;
    }).join("");
    grid.querySelectorAll<HTMLButtonElement>("[data-calendar-day]").forEach(button => button.addEventListener("click", () => { void this.select(button.dataset.calendarDay!).catch(e => this.fail(e)); }));
    this.el("#calendar-season").textContent = this.month.endsWith("-11") && !settings.contacts["zhang-qiling"] ? "十一月 · 张起灵生日季。阳光明媚的日子，慢慢一起过。" : "";
    const holidays = data.holidays[this.month.slice(0, 4)] ?? builtInHolidays[this.month.slice(0, 4)];
    this.el("#calendar-holiday-source").innerHTML = holidays ? `${this.month.slice(0, 4)} 年中国大陆休班安排 · <a href="${esc(holidays.papers[0])}" target="_blank" rel="noopener noreferrer">国务院通知</a>` : "本年休班安排尚未载入，可联网更新；农历节日照常显示。";
    const { labels, holiday } = dayLabels(this.selected, data), b = birthdays(this.selected); if (userBirthday(this.selected)) b.unshift("我的生日");
    this.el("#calendar-day-title").textContent = `${this.selected} · ${lunarInfo(this.selected).label}`;
    const events = data.events.filter(e => eventOnDay(e, this.selected));
    this.el("#calendar-day-events").innerHTML = `<p>${esc([...labels, holiday ? holiday.isOffDay ? "放假" : "调休上班" : "", ...b].filter(Boolean).join(" · ") || "平凡的一天，也值得记下" )}</p>${events.map(e => `<div class="calendar-imported-event"><span>${esc(e.title)}${e.yearly ? " · 每年" : ""}</span><button type="button" data-calendar-remove-event="${esc(e.id)}" aria-label="删除日程：${esc(e.title)}">移除</button></div>`).join("")}`;
    this.host.querySelectorAll<HTMLButtonElement>("[data-calendar-remove-event]").forEach(button => button.addEventListener("click", () => {
      if (!window.confirm("移除这条导入日程？按年重复的日程会一并移除。")) return;
      void storage.updateCalendar(d => ({ ...d, events: d.events.filter(e => e.id !== button.dataset.calendarRemoveEvent) })).then(() => this.changed()).catch(e => this.fail(e));
    }));
    if (!this.dirty) {
      const row = data.records[this.selected];
      this.el<HTMLSelectElement>("#calendar-mood").value = row?.mood ?? ""; this.el<HTMLSelectElement>("#calendar-period").value = row?.period ?? ""; this.el<HTMLTextAreaElement>("#calendar-note").value = row?.note ?? "";
    }
    if (!document.querySelector<HTMLInputElement>("#diary-date")!.value) document.querySelector<HTMLInputElement>("#diary-date")!.value = this.selected;
    // Keep birthday fields mounted while another asynchronous render is finishing.
    if (!this.el("#calendar-birthday-list").contains(document.activeElement)) this.renderBirthdays(settings);
  }
  private async saveRecord() {
    const date = this.selected, mood = this.el<HTMLSelectElement>("#calendar-mood").value, period = this.el<HTMLSelectElement>("#calendar-period").value as keyof typeof periodLabels | "", note = this.el<HTMLTextAreaElement>("#calendar-note").value.trim();
    if (!mood && !period && !note) { this.status("选一个心情、经期状态，或写一点内容再保存"); return; }
    await storage.updateCalendar(data => { data.records[date] = { date, mood: mood || undefined, period: period || undefined, note: note.slice(0, 3000), updatedAt: Date.now() }; return data; });
    this.dirty = false; await this.changed(); this.status(`${date} 的记录已保存`);
  }
  private renderBirthdays(settings: BirthdaySettings) {
    this.el("#calendar-birthday-list").innerHTML = characters.map(c => {
      const source = birthdaySources[c.id], birthday = contactBirthday(c.id, settings), custom = !!settings.contacts[c.id];
      return `<article class="calendar-birthday-row"><div><strong>${esc(c.name)}</strong><span>${custom ? "我的设定" : source?.status ?? "待确认"}${birthday ? ` · ${birthday.month}月${birthday.day}日` : source?.month ? ` · ${source.month}月` : ""}</span></div><p>${esc(source?.note ?? "可自行补充日期")}${source ? ` <a target="_blank" rel="noopener noreferrer" href="${esc(source.url)}">${esc(source.source)}</a>` : ""}</p><div class="calendar-birthday-controls"><label>生日<input type="date" data-calendar-birthday="${c.id}" value="${birthday ? `2000-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}` : ""}" min="2000-01-01" max="2000-12-31"></label><button type="button" data-calendar-birthday-save="${c.id}">保存</button><button type="button" data-calendar-birthday-reset="${c.id}">恢复收录</button></div></article>`;
    }).join("");
    this.host.querySelectorAll<HTMLButtonElement>("[data-calendar-birthday-save], [data-calendar-birthday-reset]").forEach(button => button.addEventListener("click", () => { void (async () => {
      const id = button.dataset.calendarBirthdaySave ?? button.dataset.calendarBirthdayReset!;
      const saved = await storage.birthdaySettings(), contacts = { ...saved.contacts };
      if (button.dataset.calendarBirthdayReset) delete contacts[id];
      else {
        const value = this.host.querySelector<HTMLInputElement>(`[data-calendar-birthday="${id}"]`)!.value;
        const birthday = { month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
        if (!validBirthday(birthday)) { this.status("请选择有效的月日；未确定的生日可使用恢复收录"); return; }
        contacts[id] = birthday;
      }
      await storage.saveBirthdaySettings({ ...saved, contacts, updatedAt: Date.now() });
      (document.activeElement as HTMLElement | null)?.blur(); await this.birthdaysChanged(); await this.changed(); this.status("生日簿已更新");
    })().catch(e => this.fail(e)); }));
  }
  private async syncHolidays() {
    const year = Number(this.month.slice(0, 4)), button = this.el<HTMLButtonElement>("#calendar-sync"); button.disabled = true; this.status(`正在核对 ${year} 年休班安排…`);
    try {
      const response = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`, { signal: AbortSignal.timeout(15000), cache: "no-cache" });
      if (!response.ok) throw Error("暂未获取到本年安排，已保留现有日历");
      const value: unknown = await response.json();
      if (!validHolidayYear(value, year)) throw Error("本年尚无可核对的官方休班通知，已保留现有日历");
      await storage.updateCalendar(data => ({ ...data, holidays: { ...data.holidays, [year]: value } })); await this.changed(); this.status(`${year} 年休班安排已更新，可离线查看`);
    } catch (e) { this.status(e instanceof Error ? e.message : "更新失败，已保留现有日历"); } finally { button.disabled = false; }
  }
  private async importCalendar() {
    const input = this.el<HTMLInputElement>("#calendar-import"), file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error("请选择 1 MB 以内的 .ics 文件");
      const result = parseIcs(await file.text());
      const local = await storage.calendar();
      const ids = new Set(local.events.map(e => e.id)), added = result.events.filter(e => !ids.has(e.id)).length;
      if (local.events.length + added > 2000) throw Error("日程总数超过 2000 条，请先移除旧日程");
      await storage.updateCalendar(data => mergeCalendar(data, { ...data, events: result.events })); await this.changed();
      this.status(`新增 ${added} 条全天日程${result.skipped ? `；跳过 ${result.skipped} 条含时间或暂不支持重复规则的日程` : ""}。支持普通全天日程与 FREQ=YEARLY 按年重复。`);
    } finally { input.value = ""; }
  }
}
