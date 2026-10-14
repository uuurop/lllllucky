// 配置绑定方案：把某个角色的整套专属绑定（角色默认 + 各应用覆盖）存成命名方案，
// 之后可以在聊天信息页一键套用到任意角色身上。

import type { BindingSlot } from "./settings-types";
import {
    getCharacterBinding,
    loadBindingConfig,
    saveBindingConfig,
    setCharacterBinding,
} from "./settings-storage";
import { kvGet, kvSet } from "./kv-db";

export interface BindingProfile {
    id: string;
    name: string;
    createdAt: string; // ISO
    defaults: BindingSlot;
    appOverrides: Partial<Record<string, BindingSlot>>;
}

const PROFILES_KEY = "ai_phone_binding_profiles_v1";
export const BINDING_PROFILES_UPDATED_EVENT = "binding-profiles-updated";

function cleanSlot(slot: unknown): BindingSlot {
    if (!slot || typeof slot !== "object") return {};
    const raw = slot as Record<string, unknown>;
    const out: BindingSlot = {};
    if (typeof raw.apiConfigId === "string" && raw.apiConfigId) out.apiConfigId = raw.apiConfigId;
    if (typeof raw.voiceConfigId === "string" && raw.voiceConfigId) out.voiceConfigId = raw.voiceConfigId;
    if (typeof raw.presetId === "string" && raw.presetId) out.presetId = raw.presetId;
    if (typeof raw.userIdentityId === "string" && raw.userIdentityId) out.userIdentityId = raw.userIdentityId;
    if (Array.isArray(raw.worldBookIds)) out.worldBookIds = raw.worldBookIds.filter((v): v is string => typeof v === "string" && Boolean(v));
    if (Array.isArray(raw.regexIds)) out.regexIds = raw.regexIds.filter((v): v is string => typeof v === "string" && Boolean(v));
    return out;
}

function cleanAppOverrides(value: unknown): Partial<Record<string, BindingSlot>> {
    if (!value || typeof value !== "object") return {};
    const out: Partial<Record<string, BindingSlot>> = {};
    for (const [appId, slot] of Object.entries(value as Record<string, unknown>)) {
        const cleaned = cleanSlot(slot);
        if (Object.keys(cleaned).length > 0) out[appId] = cleaned;
    }
    return out;
}

function normalizeProfile(value: unknown): BindingProfile | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!id || !name) return null;
    return {
        id,
        name: name.slice(0, 40),
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
        defaults: cleanSlot(raw.defaults),
        appOverrides: cleanAppOverrides(raw.appOverrides),
    };
}

export function loadBindingProfiles(): BindingProfile[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(PROFILES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeProfile).filter((p): p is BindingProfile => Boolean(p));
    } catch {
        return [];
    }
}

export function saveBindingProfiles(profiles: BindingProfile[]): void {
    kvSet(PROFILES_KEY, JSON.stringify(profiles.slice(0, 50)));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(BINDING_PROFILES_UPDATED_EVENT));
    }
}

/** 把某个角色当前的整套绑定存成命名方案 */
export function createBindingProfile(name: string, characterId: string): BindingProfile | null {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || !characterId) return null;
    const binding = getCharacterBinding(loadBindingConfig(), characterId);
    const profile: BindingProfile = {
        id: `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        createdAt: new Date().toISOString(),
        defaults: cleanSlot(binding.defaults),
        appOverrides: cleanAppOverrides(binding.appOverrides),
    };
    saveBindingProfiles([profile, ...loadBindingProfiles()]);
    return profile;
}

export function deleteBindingProfile(profileId: string): void {
    saveBindingProfiles(loadBindingProfiles().filter(p => p.id !== profileId));
}

/** 把方案套用到某个角色（整包覆盖该角色的专属绑定） */
export function applyBindingProfile(characterId: string, profile: BindingProfile): void {
    if (!characterId) return;
    const config = loadBindingConfig();
    const next = setCharacterBinding(config, {
        characterId,
        defaults: cleanSlot(profile.defaults),
        appOverrides: cleanAppOverrides(profile.appOverrides),
    });
    saveBindingConfig(next);
}

// ── 相等性判断（用于标记「使用中」） ──

function slotEqual(a: BindingSlot, b: BindingSlot): boolean {
    const arrEq = (x?: string[], y?: string[]) => {
        const xs = [...(x ?? [])].sort();
        const ys = [...(y ?? [])].sort();
        return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
    };
    return a.apiConfigId === b.apiConfigId
        && a.voiceConfigId === b.voiceConfigId
        && a.presetId === b.presetId
        && a.userIdentityId === b.userIdentityId
        && arrEq(a.worldBookIds, b.worldBookIds)
        && arrEq(a.regexIds, b.regexIds);
}

/** 该角色当前绑定是否与方案内容一致 */
export function isBindingProfileActive(characterId: string, profile: BindingProfile): boolean {
    const binding = getCharacterBinding(loadBindingConfig(), characterId);
    if (!slotEqual(cleanSlot(binding.defaults), profile.defaults)) return false;
    const currentOverrides = cleanAppOverrides(binding.appOverrides);
    const keys = new Set([...Object.keys(currentOverrides), ...Object.keys(profile.appOverrides)]);
    for (const key of keys) {
        const a = currentOverrides[key] ?? {};
        const b = profile.appOverrides[key] ?? {};
        if (!slotEqual(a, b)) return false;
    }
    return true;
}

/** 方案摘要：默认槽位数量 + 应用覆盖数量，例如「4 项默认 · 2 个应用」 */
export function describeBindingProfile(profile: BindingProfile): string {
    const defaultCount = Object.keys(profile.defaults).length;
    const appCount = Object.keys(profile.appOverrides).length;
    const parts: string[] = [];
    parts.push(defaultCount > 0 ? `${defaultCount} 项默认` : "无默认绑定");
    if (appCount > 0) parts.push(`${appCount} 个应用覆盖`);
    return parts.join(" · ");
}
