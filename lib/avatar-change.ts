// lib/avatar-change.ts — 聊天联系人头像更换：图片压缩、记忆写入、变更应用
//
// 三条路径共用：
// 1. 用户在「聊天信息 → TA 的头像」直接上传更换
// 2. 用户预存候选相册，点「让 TA 自己挑」触发 AI 选择
// 3. TA 在回复中用 [换头像:编号] 指令主动换（编号指向候选相册）
// 所有路径都会写入长期记忆，让 TA 知道头像变了。

import { loadCharacters } from "./character-storage";
import { loadChatContacts, updateChatContact } from "./chat-storage";
import { saveMemoryEntry } from "./memory-storage";

const AVATAR_IMAGE_MAX_SIZE = 400;
const AVATAR_IMAGE_QUALITY = 0.85;

/** 读取图片文件并压缩成 data URL（头像用，最长边 400px）。 */
export function fileToAvatarDataUrl(file: File | Blob, maxSize = AVATAR_IMAGE_MAX_SIZE, quality = AVATAR_IMAGE_QUALITY): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve(String(reader.result));
                    return;
                }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/webp", quality));
            };
            img.onerror = () => reject(new Error("图片读取失败"));
            img.src = String(reader.result);
        };
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsDataURL(file);
    });
}

/** 把已有图片 data URL 压缩成头像尺寸（聊天里收到的图片 → 头像候选用）。 */
export async function imageUrlToAvatarDataUrl(dataUrl: string, maxSize = AVATAR_IMAGE_MAX_SIZE, quality = AVATAR_IMAGE_QUALITY): Promise<string> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return fileToAvatarDataUrl(blob, maxSize, quality);
}

/** 写入一条长期记忆：头像发生了变化。 */
export async function recordAvatarChangeMemory(characterId: string, detail: string): Promise<void> {
    try {
        const charName = loadCharacters().find(c => c.id === characterId)?.name || "对方";
        const now = new Date();
        await saveMemoryEntry({
            id: `mem_avatar_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
            characterId,
            sourceApp: "chat",
            type: "long_term",
            content: `${now.toLocaleString()}：${charName}的聊天头像发生了变化。${detail}`,
            importance: 0.55,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            metadata: { kind: "avatar_change" },
        });
    } catch {
        // 记忆写入失败不阻断换头像本身
    }
}

export type AvatarChangeResult = {
    ok: boolean;
    /** 失败原因（ok=false 时） */
    reason?: string;
    /** 应用后的头像 data URL（ok=true 时） */
    avatar?: string;
    /** 新加入候选相册的编号（1 起，仅 addAvatarCandidate 返回） */
    candidateIndex?: number;
};

/** 用户直接给 TA 换头像。 */
export function applyCustomAvatar(characterId: string, imageDataUrl: string): AvatarChangeResult {
    const updated = updateChatContact(characterId, { customAvatar: imageDataUrl });
    if (!updated) return { ok: false, reason: "联系人不存在" };
    void recordAvatarChangeMemory(characterId, "你主动换上了新的聊天头像，这是你自己挑选并决定的。");
    return { ok: true, avatar: imageDataUrl };
}

/** 恢复角色卡默认头像。 */
export function clearCustomAvatar(characterId: string): AvatarChangeResult {
    const updated = updateChatContact(characterId, { customAvatar: undefined });
    if (!updated) return { ok: false, reason: "联系人不存在" };
    void recordAvatarChangeMemory(characterId, "你把头像恢复成了默认样子，这是你自己的决定。");
    return { ok: true };
}

/** 候选相册上限：超出后丢弃最旧的，防止无限膨胀。 */
const AVATAR_CANDIDATE_MAX = 30;

/** 往候选相册添加一张图，返回它的编号（1 起）。 */
export function addAvatarCandidate(characterId: string, imageDataUrl: string): AvatarChangeResult {
    const contact = loadChatContacts().find(c => c.characterId === characterId);
    if (!contact) return { ok: false, reason: "联系人不存在" };
    let candidates = [...(contact.avatarCandidates || []), {
        id: `avc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        image: imageDataUrl,
        addedAt: Date.now(),
    }];
    if (candidates.length > AVATAR_CANDIDATE_MAX) {
        candidates = candidates.slice(candidates.length - AVATAR_CANDIDATE_MAX);
    }
    updateChatContact(characterId, { avatarCandidates: candidates });
    return { ok: true, candidateIndex: candidates.length };
}

/** 从候选相册移除一张图。 */
export function removeAvatarCandidate(characterId: string, candidateId: string): AvatarChangeResult {
    const contact = loadChatContacts().find(c => c.characterId === characterId);
    if (!contact) return { ok: false, reason: "联系人不存在" };
    updateChatContact(characterId, {
        avatarCandidates: (contact.avatarCandidates || []).filter(c => c.id !== candidateId),
    });
    return { ok: true };
}

/**
 * TA 主动换头像：从候选相册里挑第 index 张（1 起）。
 * 由 [换头像:编号] 指令触发；编号越界/相册为空时失败，指令静默丢弃。
 */
export function applyAvatarCandidatePick(characterId: string, candidateIndex: number): AvatarChangeResult {
    const contact = loadChatContacts().find(c => c.characterId === characterId);
    if (!contact) return { ok: false, reason: "联系人不存在" };
    const candidates = contact.avatarCandidates || [];
    const candidate = candidates[candidateIndex - 1];
    if (!candidate) return { ok: false, reason: "候选编号不存在" };
    updateChatContact(characterId, { customAvatar: candidate.image });
    void recordAvatarChangeMemory(characterId, `你主动从头像候选相册里挑选了第 ${candidateIndex} 张，换上了新头像。`);
    return { ok: true, avatar: candidate.image };
}
