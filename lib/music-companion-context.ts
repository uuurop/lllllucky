// Read-only context assembly for music companionship. Uses the existing preset/memory machinery.
import type { Character } from "./character-types";
import { hydrateChatStorage, loadChatContacts, loadChatMessages, loadChatSessions, type ChatMessage } from "./chat-storage";
import { assemblePromptPayload, formatRichMediaForHistory } from "./llm-prompt-assembler";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { loadMemoryConfig } from "./memory-storage";
import { stripStateAndInnerForPrompt } from "./prompt-sanitizer";
import { DEFAULT_CHAT_BILINGUAL_PROMPT, resolveBilingualPrompt } from "./bilingual-prompt-defaults";
import { loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";

const OMITTED_MEDIA = new Set(["music_notify", "tool_notice", "tool_call", "tool_result", "memory_write_request", "system_instruction", "reading_discuss"]);

function companionChatSessions(characterId: string) {
    const contactIds = new Set(loadChatContacts().filter(contact => contact.characterId === characterId).map(contact => contact.id));
    // Support both legacy character IDs and contact IDs; never include group conversations.
    return loadChatSessions().filter(session => !session.isGroup && (session.contactId === characterId || contactIds.has(session.contactId)));
}

export async function loadCompanionChatHistory(characterId: string): Promise<ChatMessage[]> {
    await hydrateChatStorage();
    const sessions = companionChatSessions(characterId);
    const seen = new Set<string>();
    const messages = sessions.flatMap(session => loadChatMessages(session.id)).filter(message => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return (message.role === "user" || message.role === "assistant")
            && !message.isRetracted && message.status !== "failed" && message.status !== "sending"
            && (!message.origin || message.origin === "chat")
            && !OMITTED_MEDIA.has(message.mediaType || "")
            && (!!message.mediaType || !!stripStateAndInnerForPrompt(message.content).trim());
    });
    return messages.sort((a, b) => {
        const time = (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
        if (time) return time;
        if (a.sessionId === b.sessionId && Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) return a.order! - b.order!;
        return a.id.localeCompare(b.id);
    }).slice(-30).map(message => ({ ...message }));
}

export async function buildMusicCompanionContext(character: Character, songContext: string) {
    const bindings = loadBindingConfig();
    const chatSlot = resolveBinding(bindings, character.id, "chat");
    const presets = loadPresets();
    const presetId = chatSlot.presetId;
    const preset = presets.find(item => item.id === presetId) || presets.find(item => item.builtIn) || null;
    const identity = resolveUserIdentity(character.id, "chat");
    const rawHistory = await loadCompanionChatHistory(character.id);
    const session = companionChatSessions(character.id).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0];
    const bilingualInstruction = resolveBilingualPrompt(session?.bilingualTranslationEnabled !== false, session?.bilingualTranslationPrompt, DEFAULT_CHAT_BILINGUAL_PROMPT);
    const allRegexes = loadRegexes();
    const regexes = (chatSlot.regexIds || []).flatMap(id => allRegexes.filter(item => item.id === id));
    // Plain text only: no image fetches, tool execution, status panels or hidden reasoning.
    const history = rawHistory.map(message => ({
        ...message,
        content: stripStateAndInnerForPrompt(message.mediaType ? formatRichMediaForHistory(message, identity?.name || "对方", character.name) : message.content),
        mediaType: undefined, mediaUrl: undefined, mediaData: undefined,
        nativeToolCalls: undefined, nativeToolResult: undefined,
    }));
    const query = [songContext, ...history.slice(-10).map(message => message.content)].join("\n");
    const memoryConfig = loadMemoryConfig();
    const [memories, core] = await Promise.all([
        retrieveMemoriesForPrompt(character.id, query, memoryConfig),
        retrieveCoreMemoriesForPrompt(character.id, memoryConfig),
    ]);
    const longTerm = formatLongTermMemories(memories);
    const coreText = formatCoreMemories(core);
    const bookIds = new Set(chatSlot.worldBookIds || []);
    const payload = assemblePromptPayload({
        character, history, preset, worldBooks: loadWorldBooks().filter(book => bookIds.has(book.id)),
        regexes, userIdentity: identity, appId: "chat", appTags: ["chat"],
        longTermMemories: longTerm, coreMemories: coreText,
        worldBookActivationContext: query, enableVision: false, nativeToolHistory: false,
        chatBilingualInstruction: bilingualInstruction,
    });
    const messages: { role: string; content: string }[] = payload.filter(message => message.role !== "tool").map(message => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "text").map(part => "text" in part ? part.text : "").join("\n"),
    }));
    // Imported presets sometimes omit these markers. The explicit companion context must still be available.
    if (history.length && !payload.some(message => message._debugMeta?.marker?.includes("History ["))) {
        messages.push({ role: "system", content: "以下为你与对方最近的普通聊天，仅作为此前交流的背景。接下来会切换到当前一起听场景。" });
        messages.push(...history.map(message => ({ role: message.role, content: message.content })));
    }
    if (longTerm && !messages.some(message => message.content.includes(longTerm))) messages.push({ role: "system", content: `【你与对方的长期记忆】\n${longTerm}` });
    if (coreText && !messages.some(message => message.content.includes(coreText))) messages.push({ role: "system", content: `【核心记忆】\n${coreText}` });
    return { messages, preset, regexes, bilingualInstruction, userName: identity?.name || "对方", historyCount: history.length };
}
