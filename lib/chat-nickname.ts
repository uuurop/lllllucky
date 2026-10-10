// lib/chat-nickname.ts
// 「AI 自取昵称」：读取角色人设 + 最近聊天记录，让模型为角色起一个网名，
// 写入联系人 nickname 字段。再次调用时会结合近期聊天状态生成变化版本。
//
// 与 npc-generator 同思路：不走预设系统组装（simpleLLMCall + 手动组提示词），
// 避免聊天预设里的角色扮演指令污染输出；API 配置沿用角色的聊天绑定。

import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";
import { loadCharacters } from "./character-storage";
import { loadChatContacts, loadChatMessages, updateChatContact } from "./chat-storage";

const RECENT_MESSAGE_COUNT = 30;
const RECENT_MESSAGE_TEXT_LIMIT = 80;

export type GenerateNicknameResult =
    | { ok: true; nickname: string }
    | { ok: false; error: string };

function buildRecentChatExcerpt(sessionId: string): string {
    const messages = loadChatMessages(sessionId)
        .filter(m => !m.isRetracted && (m.role === "user" || m.role === "assistant") && m.content?.trim())
        .slice(-RECENT_MESSAGE_COUNT);
    if (messages.length === 0) return "";
    return messages
        .map(m => {
            const text = m.content.replace(/\s+/g, " ").slice(0, RECENT_MESSAGE_TEXT_LIMIT);
            return `${m.role === "user" ? "对方" : "TA"}: ${text}`;
        })
        .join("\n");
}

export async function generateChatNickname(
    characterId: string,
    sessionId: string,
): Promise<GenerateNicknameResult> {
    const character = loadCharacters().find(c => c.id === characterId);
    if (!character) return { ok: false, error: "角色不存在" };

    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, characterId, "chat");
    if (!slot.apiConfigId) return { ok: false, error: "尚未绑定 API 配置，请先在绑定设置中配置" };
    const apiConfig = loadApiConfigs().find(c => c.id === slot.apiConfigId);
    if (!apiConfig) return { ok: false, error: "绑定的 API 配置不存在" };

    const currentNickname = loadChatContacts().find(c => c.characterId === characterId)?.nickname?.trim() || "";
    const recentChat = buildRecentChatExcerpt(sessionId);

    const systemPrompt = [
        "你负责给聊天软件里的联系人起「网名/昵称」（显示在消息列表、联系人列表和动态里的名字）。",
        "规则：",
        "- 2~12 个字符，像一个真实用户会用的网名，不是证件名",
        "- 要贴合角色的人设、性格和气质",
        "- 可以带少量 emoji 或符号，但不要堆砌",
        "- 只输出昵称本身，不要解释、不要引号、不要任何其他内容",
    ].join("\n");

    const userSections: string[] = [
        `角色名字：${character.name}`,
        character.personality ? `性格：${character.personality}` : "",
        `人设：\n${(character.persona || "").slice(0, 800)}`,
    ].filter(Boolean);
    if (currentNickname) {
        userSections.push(`TA 现在的昵称是「${currentNickname}」。请结合最近的聊天状态起一个**新的**昵称，可以和当前心境、关系变化呼应，不要原样重复。`);
    }
    if (recentChat) {
        userSections.push(`最近的聊天记录（供感受 TA 近期的状态与你们的关系）：\n${recentChat}`);
    }
    userSections.push("请输出昵称：");

    const result = await simpleLLMCall(
        apiConfig,
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: userSections.join("\n\n") },
        ],
        { temperature: 0.9, max_tokens: 60, label: "chat-nickname" },
    );
    if (!result.content) return { ok: false, error: result.error || "生成失败，请稍后再试" };

    // 清洗：取第一行，去掉首尾引号/空白
    const nickname = result.content
        .split("\n")[0]
        .trim()
        .replace(/^[「『"“”'’]+|[」』"“”'’]+$/g, "")
        .trim();
    if (!nickname) return { ok: false, error: "模型没有给出可用昵称，请重试" };
    if (nickname.length > 20) return { ok: false, error: "生成的昵称过长，请重试" };

    const updated = updateChatContact(characterId, { nickname });
    if (!updated) return { ok: false, error: "联系人不存在" };
    return { ok: true, nickname };
}
