import type { CalendarColorKey, CalendarScheduleItem } from "./calendar-types";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** 时间轴视图默认展示范围（仅影响显示，不再限制数据） */
export const CALENDAR_HOUR_START = 0;
export const CALENDAR_HOUR_END = 24;

export const CALENDAR_COLOR_KEYS: CalendarColorKey[] = [
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
  "teal",
  "slate",
  "lilac",
];

export function isCalendarColorKey(value: unknown): value is CalendarColorKey {
  return typeof value === "string" && (CALENDAR_COLOR_KEYS as string[]).includes(value);
}

const EMOJI_SEQUENCE_RE = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/u;

/** 事项 emoji：从输入中提取第一个 emoji 序列；没有 emoji 时返回空串。 */
export function sanitizeScheduleEmoji(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "无") return "";
  const match = trimmed.match(EMOJI_SEQUENCE_RE);
  return match ? match[0] : "";
}

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseIsoDate(dateText: string): Date {
  return new Date(`${dateText}T00:00:00`);
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function getWeekStartIso(date: Date): string {
  return formatIsoDate(startOfWeek(date));
}

export function getWeekDates(weekStart: string): string[] {
  const base = parseIsoDate(weekStart);
  return Array.from({ length: 7 }, (_, idx) => {
    const current = new Date(base);
    current.setDate(base.getDate() + idx);
    return formatIsoDate(current);
  });
}

export function getWeekdayLabel(dateOrIso: Date | string): string {
  const date = typeof dateOrIso === "string" ? parseIsoDate(dateOrIso) : dateOrIso;
  return WEEKDAY_LABELS[date.getDay()];
}

export function formatMonthDay(dateOrIso: Date | string): string {
  const date = typeof dateOrIso === "string" ? parseIsoDate(dateOrIso) : dateOrIso;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function getMonthMatrix(anchorDate: string): string[][] {
  const focus = parseIsoDate(anchorDate);
  const firstDay = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = startOfWeek(firstDay);
  return Array.from({ length: 6 }, (_, weekIdx) =>
    Array.from({ length: 7 }, (_, dayIdx) => {
      const current = new Date(gridStart);
      current.setDate(gridStart.getDate() + weekIdx * 7 + dayIdx);
      return formatIsoDate(current);
    }),
  );
}

export function isSameMonth(dateA: string, dateB: string): boolean {
  return dateA.slice(0, 7) === dateB.slice(0, 7);
}

export function isDateInWeek(date: string, weekStart: string): boolean {
  return getWeekDates(weekStart).includes(date);
}

export function timeToMinutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

export function normalizeTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * 时间段是否有效。历史版本曾把日程限制在 08:00-23:00 并在读取时静默丢弃越界数据；
 * 现已放开为全天可安排，只校验格式合法且开始早于结束。
 */
export function isCalendarTimeRangeAllowed(startTime: string, endTime: string): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return !Number.isNaN(start) && !Number.isNaN(end) && start < end;
}

export function pickScheduleColorKey(startTime: string): CalendarColorKey {
  const minutes = timeToMinutes(startTime);
  if (Number.isNaN(minutes)) return "slate";
  if (minutes < 9 * 60) return "teal";
  if (minutes < 12 * 60) return "blue";
  if (minutes < 15 * 60) return "green";
  if (minutes < 18 * 60) return "amber";
  if (minutes < 21 * 60) return "violet";
  return "rose";
}

export function sortScheduleItems(items: CalendarScheduleItem[]): CalendarScheduleItem[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.endTime !== b.endTime) return a.endTime.localeCompare(b.endTime);
    return a.title.localeCompare(b.title);
  });
}

export function formatWeekRangeLabel(weekStart: string): string {
  const dates = getWeekDates(weekStart);
  const start = parseIsoDate(dates[0]);
  const end = parseIsoDate(dates[6]);
  return `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
}

export function getOwnerStorageKey(ownerType: string, ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

// ── 角色时区：日程时间换算 ─────────────────────────
// 角色的日程时间一律按「TA 所在地（character.timeZone）的当地时间」存储与展示；
// 这里提供 当地时间 ↔ 北京时间 的换算与「当地今天」工具。

import { normalizeTimeZone } from "./character-time";

const BEIJING_TZ = "Asia/Shanghai";

function partsInZone(instant: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(instant));
        const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
        const h = Number(get("hour")) % 24;
        return { y: Number(get("year")), mo: Number(get("month")), d: Number(get("day")), h, mi: Number(get("minute")) };
    } catch {
        return null;
    }
}

/**
 * 把「某时区的当地墙钟时间」换算成北京时间。
 * 例：纽约 2026-10-14 09:00 → { date: "2026-10-14", time: "21:00", dayShift: 0 }
 * dayShift：北京日期 - 当地日期（-1/0/1），跨天时用于标注「次日/前日」。
 */
export function localWallTimeToBeijing(
    dateIso: string,
    time: string,
    timeZone: string | undefined,
): { date: string; time: string; dayShift: number } | null {
    const tz = normalizeTimeZone(timeZone);
    if (!tz || tz === BEIJING_TZ) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !/^\d{2}:\d{2}$/.test(time)) return null;
    try {
        const guessUtc = Date.parse(`${dateIso}T${time}:00Z`);
        const wallAt = (t: number): number => {
            const p = partsInZone(t, tz);
            if (!p) return Number.NaN;
            return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
        };
        // 迭代两次逼近真实 UTC 时刻（覆盖夏令时切换边缘）
        let utc = guessUtc + (guessUtc - wallAt(guessUtc));
        utc = utc + (guessUtc - wallAt(utc));
        if (Number.isNaN(utc)) return null;
        const bj = partsInZone(utc, BEIJING_TZ);
        if (!bj) return null;
        const bjDate = `${bj.y}-${String(bj.mo).padStart(2, "0")}-${String(bj.d).padStart(2, "0")}`;
        const dayShift = Math.round((Date.parse(`${bjDate}T00:00:00Z`) - Date.parse(`${dateIso}T00:00:00Z`)) / 86400000);
        return { date: bjDate, time: `${String(bj.h).padStart(2, "0")}:${String(bj.mi).padStart(2, "0")}`, dayShift };
    } catch {
        return null;
    }
}

/** 日程时间旁的北京时间备注，如 "北京 21:30"；跨天带「次日/前日」。无时区或与北京一致返回 ""。 */
export function beijingTimeNote(dateIso: string, time: string, timeZone: string | undefined): string {
    const bj = localWallTimeToBeijing(dateIso, time, timeZone);
    if (!bj) return "";
    const suffix = bj.dayShift > 0 ? "次日 " : bj.dayShift < 0 ? "前日 " : "";
    return `北京 ${suffix}${bj.time}`;
}

/** 该时区的「今天」（YYYY-MM-DD）；非法时区回退为本机今天。 */
export function todayIsoInZone(timeZone: string | undefined): string {
    const tz = normalizeTimeZone(timeZone);
    if (!tz) return formatIsoDate(new Date());
    const p = partsInZone(Date.now(), tz);
    if (!p) return formatIsoDate(new Date());
    return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
