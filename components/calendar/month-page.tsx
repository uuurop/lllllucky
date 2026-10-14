"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, Globe, Palette } from "lucide-react";
import type { CalendarScheduleItem } from "@/lib/calendar-types";
import type { MenstrualDayState } from "@/lib/menstrual-storage";
import { beijingTimeNote, formatIsoDate, parseIsoDate } from "@/lib/calendar-utils";
import { getLunarInfoByIso } from "@/lib/lunar";

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];
const WEEK_LABEL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DAY_MS = 86400000;

type MonthCell = {
  iso: string;
  day: number;
  weekday: number;      // 0 = 周日
  lunarLabel: string;
  lunarFirst: boolean;
};

type MonthGrid = {
  year: number;
  month: number;        // 0 基
  firstWeekday: number;
  weeks: MonthCell[][];
};

/** 构建某年月的月历格子（农历只算一次） */
function buildMonthGrid(year: number, month: number): MonthGrid {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: MonthCell[][] = [];
  let week: MonthCell[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    if (week.length > 0 && d.getDay() === 0) {
      weeks.push(week);
      week = [];
    }
    const lunar = getLunarInfoByIso(formatIsoDate(d));
    week.push({
      iso: formatIsoDate(d),
      day,
      weekday: d.getDay(),
      lunarLabel: lunar?.cellLabel ?? "",
      lunarFirst: lunar?.isFirstDay ?? false,
    });
  }
  if (week.length > 0) weeks.push(week);
  return { year, month, firstWeekday: new Date(year, month, 1).getDay(), weeks };
}

const ymOf = (iso: string) => {
  const d = parseIsoDate(iso);
  return { year: d.getFullYear(), month: d.getMonth() };
};

/** 包含指定日期的那一周（周日起）的 7 天 */
function weekRowOf(iso: string): MonthCell[] {
  const d = parseIsoDate(iso);
  const sunday = new Date(d.getTime() - d.getDay() * DAY_MS);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sunday.getTime() + i * DAY_MS);
    const dayIso = formatIsoDate(day);
    const lunar = getLunarInfoByIso(dayIso);
    return {
      iso: dayIso,
      day: day.getDate(),
      weekday: day.getDay(),
      lunarLabel: lunar?.cellLabel ?? "",
      lunarFirst: lunar?.isFirstDay ?? false,
    };
  });
}

export function CalendarMonthPage({
  todayIso,
  itemsByDate,
  cycleMap,
  ownerStrip,
  selectedDate,
  onSelectDate,
  onOpenTimeline,
  onEditItem,
  cyclePanel,
  ownerTimeZone,
  onClose,
  onOpenTheme,
  onOpenTimezone,
}: {
  todayIso: string;
  itemsByDate: Map<string, CalendarScheduleItem[]>;
  cycleMap: Map<string, MenstrualDayState> | null;
  ownerStrip: ReactNode;
  /** 当前选中的日期（点格子只选中，不跳页） */
  selectedDate: string;
  onSelectDate: (iso: string) => void;
  /** 进入时间轴详情页 */
  onOpenTimeline: (iso: string) => void;
  onEditItem: (item: CalendarScheduleItem) => void;
  /** 经期打卡行（仅用户视图传入），渲染在当天日程面板里 */
  cyclePanel: ReactNode;
  /** 角色所在地时区；日程时间按当地展示，旁边备注北京时间 */
  ownerTimeZone?: string;
  onClose: () => void;
  onOpenTheme: () => void;
  onOpenTimezone: () => void;
}) {
  const [{ year, month }, setYm] = useState(() => ymOf(selectedDate));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  // collapsed=true：月历收成一行周条，下面是当天日程（下滑进入，上滑恢复）
  const [collapsed, setCollapsed] = useState(false);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const weekRow = useMemo(() => weekRowOf(selectedDate), [selectedDate]);

  // 选中日期跑到别的月份时，月历跟着翻过去
  useEffect(() => {
    const sel = ymOf(selectedDate);
    setYm(prev => (prev.year === sel.year && prev.month === sel.month ? prev : sel));
  }, [selectedDate]);

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYm({ year: next.getFullYear(), month: next.getMonth() });
  };

  // 周条模式左右滑：按周移动选中日期
  const shiftWeek = (delta: number) => {
    const next = new Date(parseIsoDate(selectedDate).getTime() + delta * 7 * DAY_MS);
    onSelectDate(formatIsoDate(next));
  };

  // ── 手势：左右滑切月/周；下滑收成周条看日程；上滑恢复月历 ──
  const gestureRef = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (e: ReactPointerEvent) => {
    gestureRef.current = { x: e.clientX, y: e.clientY };
  };
  const handlePointerUp = (e: ReactPointerEvent) => {
    const start = gestureRef.current;
    gestureRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (collapsed) shiftWeek(dx < 0 ? 1 : -1);
      else shiftMonth(dx < 0 ? 1 : -1);
    } else if (dy > 60 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      setCollapsed(true);
    } else if (dy < -60 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      setCollapsed(false);
    }
  };

  const renderCell = (cell: MonthCell, weekIndexFirst: boolean) => {
    const items = itemsByDate.get(cell.iso);
    const cycle = cycleMap?.get(cell.iso) ?? null;
    return (
      <button
        key={cell.iso}
        type="button"
        className="calendar-month-cell"
        data-today={cell.iso === todayIso ? "true" : undefined}
        data-selected={cell.iso === selectedDate ? "true" : undefined}
        style={weekIndexFirst ? { gridColumnStart: cell.weekday + 1 } : undefined}
        aria-label={`${cell.iso}${items?.length ? `，${items.length}个日程` : ""}`}
        onClick={() => onSelectDate(cell.iso)}
      >
        <span className="calendar-month-num">{cell.day}</span>
        <span className={`calendar-month-lunar${cell.lunarFirst ? " is-first" : ""}`}>{cell.lunarLabel}</span>
        <span className="calendar-month-dots" aria-hidden="true">
          {cycle ? <i className="calendar-cycle-dot" data-type={cycle.type} /> : null}
          {items && items.length > 0 ? <i className="calendar-event-dot" data-color={items[0].colorKey} /> : null}
        </span>
      </button>
    );
  };

  const selectedDayItems = itemsByDate.get(selectedDate) ?? [];
  const selDate = parseIsoDate(selectedDate);
  const selLunar = getLunarInfoByIso(selectedDate);

  const gotoToday = () => {
    onSelectDate(todayIso);
    setYm(ymOf(todayIso));
  };

  return (
    <div className="calendar-page calendar-page-month calendar-page-month-v2">
      {/* 顶部：返回 + 时区 + 主题 */}
      <div className="calendar-apple-topbar">
        <button type="button" className="calendar-pill-btn calendar-back-btn" onClick={onClose} aria-label="返回桌面">
          <ChevronLeft size={19} />
          日历
        </button>
        <span className="calendar-topbar-space" />
        <button type="button" className="calendar-icon-btn" onClick={onOpenTimezone} aria-label="时区与所在地">
          <Globe size={17} />
        </button>
        <button type="button" className="calendar-icon-btn" onClick={onOpenTheme} aria-label="主题与自定义">
          <Palette size={17} />
        </button>
      </div>

      {ownerStrip}

      {/* 月份选择按钮 */}
      <div className="calendar-month-switch-row">
        <button
          type="button"
          className="calendar-month-switch-btn"
          onClick={() => { setPickerYear(year); setPickerOpen(true); }}
        >
          {year}年{month + 1}月
          <ChevronDown size={15} />
        </button>
        {ownerTimeZone ? (
          <span className="calendar-month-tz-note">{ownerTimeZone} 当地时间</span>
        ) : null}
      </div>

      {/* 星期表头 */}
      <div className="calendar-weekday-head" aria-hidden="true">
        {WEEKDAY_CN.map(w => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 月历区：完整月历 ↔ 下滑收成单行周条 */}
      <div
        className="calendar-month-single"
        data-collapsed={collapsed ? "true" : undefined}
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {collapsed ? (
          <div className="calendar-month-week calendar-month-week-single">
            {weekRow.map(cell => renderCell(cell, false))}
          </div>
        ) : (
          grid.weeks.map((week, wi) => (
            <div key={wi} className="calendar-month-week">
              {week.map(cell => renderCell(cell, wi === 0))}
            </div>
          ))
        )}
        {/* 拖动把手：点一下也可以切换月历/周条 */}
        <button
          type="button"
          className="calendar-agenda-handle"
          onClick={() => setCollapsed(prev => !prev)}
          aria-label={collapsed ? "展开月历" : "收起为周视图"}
        >
          <i />
        </button>
      </div>

      {/* 当天日程面板（周条模式下展开） */}
      {collapsed && (
        <div className="calendar-agenda" data-open="true">
          <div className="calendar-agenda-head">
            <div className="calendar-agenda-title">
              <strong>{selDate.getMonth() + 1}月{selDate.getDate()}日</strong>
              <span>{WEEK_LABEL[selDate.getDay()]}{selLunar ? ` · ${selLunar.monthLabel}${selLunar.isFirstDay ? "" : selLunar.dayLabel}` : ""}</span>
            </div>
            <button
              type="button"
              className="calendar-icon-btn"
              onClick={() => onOpenTimeline(selectedDate)}
              aria-label="打开时间轴视图"
              title="时间轴视图"
            >
              <CalendarDays size={16} />
            </button>
          </div>
          {cyclePanel}
          <div className="calendar-agenda-list hide-scrollbar">
            {selectedDayItems.length === 0 ? (
              <div className="calendar-agenda-empty">这一天没有日程</div>
            ) : (
              selectedDayItems.map(item => {
                const bjStart = beijingTimeNote(item.date, item.startTime, ownerTimeZone);
                const bjEnd = beijingTimeNote(item.date, item.endTime, ownerTimeZone);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="calendar-agenda-item"
                    data-color={item.colorKey}
                    onClick={() => onEditItem(item)}
                  >
                    <span className="calendar-agenda-item-title">
                      {item.emoji ? `${item.emoji} ` : ""}{item.title}
                    </span>
                    <span className="calendar-agenda-item-meta">
                      {item.startTime}–{item.endTime}
                      {bjStart ? `（${bjStart}–${bjEnd.replace("北京 ", "")}）` : ""}
                      {item.location ? ` · ${item.location}` : ""}
                      {item.source === "generated" ? " · AI" : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="calendar-float-bar">
        <button type="button" className="calendar-pill-btn" onClick={gotoToday}>
          今天
        </button>
      </div>

      {/* 月份选择弹窗 */}
      {pickerOpen && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="calendar-edit-modal calendar-days-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <button
                type="button"
                className="calendar-icon-btn"
                onClick={() => setPickerYear(y => y - 1)}
                aria-label="上一年"
              >
                ‹
              </button>
              <strong>{pickerYear}年</strong>
              <button
                type="button"
                className="calendar-icon-btn"
                onClick={() => setPickerYear(y => y + 1)}
                aria-label="下一年"
              >
                ›
              </button>
            </div>
            <div className="calendar-month-picker-grid">
              {Array.from({ length: 12 }, (_, m) => (
                <button
                  key={m}
                  type="button"
                  className="calendar-days-option"
                  data-active={pickerYear === year && m === month ? "true" : undefined}
                  onClick={() => {
                    setYm({ year: pickerYear, month: m });
                    setPickerOpen(false);
                  }}
                >
                  <b>{m + 1}月</b>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
