"use client";

// 时区与所在地：给每个联系人绑定 IANA 时区，写入角色卡的 timeZone 字段。
// 提示词注入走的是既有 buildCharacterTimeContext / buildGroupTimeContext
// 管线（char.timeZone），与「真实时间感知」同源——这里只是提供一个
// 集中管理入口，不会产生第二套时间逻辑。

import { useMemo, useState } from "react";
import { ChevronRight, Globe, Search, X, Check } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Input } from "@/components/ui/form";
import { loadChatContacts, resolveChatAvatar } from "@/lib/chat-storage";
import { loadCharacters, saveCharacters } from "@/lib/character-storage";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import { normalizeTimeZone, getSystemTimeZone } from "@/lib/character-time";
import type { Character } from "@/lib/character-types";

type IntlWithTimeZoneList = typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
};

/** 常见时区置顶，后面跟全量 IANA 列表。 */
const COMMON_TIME_ZONES = [
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Taipei",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Singapore",
    "Asia/Bangkok",
    "Asia/Dubai",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Moscow",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Toronto",
    "America/Vancouver",
    "America/Sao_Paulo",
    "Australia/Sydney",
    "Pacific/Auckland",
];

const ALL_TIME_ZONES: string[] = (() => {
    try {
        const intl = Intl as IntlWithTimeZoneList;
        const values = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
        return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
})();

const TIME_ZONE_OPTIONS: string[] = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tz of [...COMMON_TIME_ZONES, ...ALL_TIME_ZONES]) {
        if (!tz || seen.has(tz)) continue;
        seen.add(tz);
        out.push(tz);
    }
    return out;
})();

/** 该时区当前的时刻，如 "03:12"；非法时区返回空串。 */
function currentTimeIn(timeZone: string | undefined): string {
    const normalized = normalizeTimeZone(timeZone);
    if (!normalized) return "";
    try {
        return new Intl.DateTimeFormat("zh-CN", {
            timeZone: normalized,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).format(new Date());
    } catch {
        return "";
    }
}

/** UTC 偏移标签，如 "UTC+9"。 */
function utcOffsetLabel(timeZone: string): string {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            timeZoneName: "shortOffset",
        }).formatToParts(new Date());
        const tz = parts.find(p => p.type === "timeZoneName")?.value || "";
        return tz.replace("GMT", "UTC");
    } catch {
        return "";
    }
}

type ContactRow = {
    characterId: string;
    name: string;
    avatar: string;
    timeZone: string;
};

export function TimezoneSettingsPanel({ onBack, scope = "contacts", variant = "page" }: { onBack: () => void; scope?: "contacts" | "all"; variant?: "page" | "modal" }) {
    const [tick, setTick] = useState(0);
    const [pickerFor, setPickerFor] = useState<ContactRow | null>(null);
    const [pickerSearch, setPickerSearch] = useState("");

    const systemTimeZone = getSystemTimeZone();

    const rows = useMemo<ContactRow[]>(() => {
        const chars = loadCharacters();
        // scope=all：日历等场景需要给所有角色（包括没加好友的）绑定时区
        const source = scope === "all" ? chars.map(ch => ch.id) : loadChatContacts().map(c => c.characterId);
        return source
            .map(id => {
                const char = chars.find(ch => ch.id === id);
                if (!char) return null;
                return {
                    characterId: char.id,
                    name: char.name || "未命名",
                    avatar: resolveChatAvatar(char.id),
                    timeZone: char.timeZone || "",
                } as ContactRow;
            })
            .filter((r): r is ContactRow => Boolean(r))
            .sort((a, b) => a.name.localeCompare(b.name));
        // tick 用于保存后强制刷新
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, scope]);

    const setContactTimeZone = (characterId: string, timeZone: string | undefined) => {
        const chars = loadCharacters();
        const next = chars.map(c => {
            if (c.id !== characterId) return c;
            const copy: Character = { ...c };
            const normalized = timeZone ? normalizeTimeZone(timeZone) : undefined;
            if (normalized) copy.timeZone = normalized;
            else delete copy.timeZone;
            return copy;
        });
        saveCharacters(next);
        setTick(t => t + 1);
    };

    const pickerOptions = useMemo(() => {
        const query = pickerSearch.trim().toLowerCase();
        if (!query) return TIME_ZONE_OPTIONS;
        return TIME_ZONE_OPTIONS.filter(tz => tz.toLowerCase().includes(query));
    }, [pickerSearch]);

    const boundCount = rows.filter(r => r.timeZone).length;

    const body = (
        <>
            <div className="menu-group">
                <div className="menu-item" style={{ cursor: "default" }}>
                    <Globe size={18} className="text-[var(--c-icon)] opacity-70" strokeWidth={1.5} />
                    <div className="menu-label-group">
                        <span className="menu-label">本机系统时区</span>
                        <span className="menu-desc">{systemTimeZone}（{utcOffsetLabel(systemTimeZone)}）· 未绑定的{scope === "all" ? "角色" : "联系人"}跟随这个时间</span>
                    </div>
                </div>
            </div>

            <p className="menu-group-desc mx-2">
                绑定所在地时区后，TA 看到的「当前时间」就是当地的时间——问候、作息、日程、深夜清晨都会按 TA 那边的钟点来。已绑定 {boundCount} / {rows.length} 位，新角色默认跟随系统时区。
            </p>

            <div className="menu-group">
                {rows.length === 0 && (
                    <div className="menu-item" style={{ cursor: "default" }}>
                        <div className="menu-label-group">
                            <span className="menu-desc">还没有角色，先去创建一张角色卡吧。</span>
                        </div>
                    </div>
                )}
                {rows.map(row => {
                    const localTime = row.timeZone ? currentTimeIn(row.timeZone) : "";
                    return (
                        <button
                            key={row.characterId}
                            className="menu-item"
                            onClick={() => { setPickerFor(row); setPickerSearch(""); }}
                        >
                            <div className="chat-contact-avatar" style={{ width: 36, height: 36 }}>
                                {row.avatar ? <img src={row.avatar} alt="" /> : <ChatFallbackAvatar />}
                            </div>
                            <div className="menu-label-group">
                                <span className="menu-label">{row.name}</span>
                                <span className="menu-desc">
                                    {row.timeZone
                                        ? `${row.timeZone}（${utcOffsetLabel(row.timeZone)}）${localTime ? ` · 当地 ${localTime}` : ""}`
                                        : "跟随系统时区"}
                                </span>
                            </div>
                            <div className="menu-right">
                                <ChevronRight size={16} />
                            </div>
                        </button>
                    );
                })}
            </div>
        </>
    );

    const picker = pickerFor && (
        <div className="modal-overlay modal-overlay-bottom">
            <div className="modal-sheet" data-ui="modal-sheet">
                <div className="modal-header" data-ui="modal-header">
                    <button onClick={() => setPickerFor(null)} className="modal-header-btn modal-header-btn-muted" aria-label="取消"><X size={18} /></button>
                    <span className="modal-header-title">{pickerFor.name} 的所在地</span>
                    <span className="modal-header-btn modal-header-btn-action" style={{ opacity: 0, pointerEvents: "none" }}><Check size={18} /></span>
                </div>
                <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-icon)]" />
                        <Input
                            type="text"
                            value={pickerSearch}
                            onChange={(e) => setPickerSearch(e.target.value)}
                            placeholder="搜索时区，如 Tokyo、London、New_York"
                            style={{ paddingLeft: 32 }}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <button
                            className="menu-item"
                            onClick={() => { setContactTimeZone(pickerFor.characterId, undefined); setPickerFor(null); }}
                        >
                            <div className="menu-label-group">
                                <span className="menu-label">跟随系统时区</span>
                                <span className="menu-desc">{systemTimeZone}（{utcOffsetLabel(systemTimeZone)}）</span>
                            </div>
                            <div className="menu-right">
                                {!pickerFor.timeZone && <Check size={16} className="text-[var(--c-success)]" />}
                            </div>
                        </button>
                        {pickerOptions.map(tz => {
                            const selected = pickerFor.timeZone === tz;
                            const localTime = currentTimeIn(tz);
                            return (
                                <button
                                    key={tz}
                                    className="menu-item"
                                    onClick={() => { setContactTimeZone(pickerFor.characterId, tz); setPickerFor(null); }}
                                >
                                    <div className="menu-label-group">
                                        <span className="menu-label">{tz}</span>
                                        <span className="menu-desc">{utcOffsetLabel(tz)}{localTime ? ` · 当地 ${localTime}` : ""}</span>
                                    </div>
                                    <div className="menu-right">
                                        {selected && <Check size={16} className="text-[var(--c-success)]" />}
                                    </div>
                                </button>
                            );
                        })}
                        {pickerOptions.length === 0 && (
                            <span className="menu-desc px-2 py-3">没有匹配的时区，换个关键词试试。</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    if (variant === "modal") {
        return (
            <div className="modal-overlay calendar-edit-modal-overlay" onClick={onBack}>
                <div className="calendar-edit-modal calendar-tz-modal" onClick={e => e.stopPropagation()}>
                    <div className="calendar-theme-modal-head">
                        <strong>时区与所在地</strong>
                        <button type="button" onClick={onBack} className="calendar-icon-btn" aria-label="关闭">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="calendar-tz-body hide-scrollbar">
                        {body}
                    </div>
                </div>
                {picker}
            </div>
        );
    }

    return (
        <PageShell title="时区与所在地" onBack={onBack} className="absolute inset-0 z-[100]">
            <div className="page-menu profile-settings-menu">
                {body}
            </div>
            {picker}
        </PageShell>
    );
}
