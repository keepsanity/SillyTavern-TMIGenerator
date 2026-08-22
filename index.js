/**
 * TMI Generator Extension for SillyTavern
 * 채팅 답장을 받을 때 재미있는 TMI(Too Much Information)를 자동 생성하여 표시합니다.
 */

import { event_types } from '../../../events.js';
import { getCurrentChatId, saveChatDebounced, user_avatar } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getWorldInfoPrompt } from '../../../world-info.js';

const EXTENSION_NAME = 'SillyTavern-TMIGenerator';

// TMI 데이터는 메시지 자체(message.extra.tmi)에 저장됩니다.
// - 스와이프별 저장은 ST가 swipe_info[].extra로 알아서 동기화해줍니다.
// - 메시지를 지우거나 중간에 삽입해도 인덱스가 밀리지 않습니다.
// - 채팅 export / 브랜치 / 체크포인트에 TMI가 함께 따라갑니다.
// 예전 버전은 settings.json의 tmiData에 저장했고, 그 데이터는 채팅을 열 때 자동 이전됩니다.
const TMI_VERSION = 2;

// 사용자가 편집하는 커스텀 프롬프트 (내용 방향만)
const DEFAULT_PROMPT = `Generate interesting TMI facts about the current conversation, mixing character details and world-building.

Good TMI examples:
- Character quirks, habits, or hidden thoughts
- World-building details and lore
- Environmental or setting details
- Relationship dynamics
- Background context or history

Mix character-focused and world-focused facts naturally.`;

/**
 * 기본 제공 프롬프트 프리셋.
 * 여기 있는 것은 사용자 프리셋과 분리되어 있어서, 확장을 업데이트하면 새 팩이 그대로 추가됩니다.
 * 수정하면 "내 프리셋"으로 복사되고 원본은 그대로 남습니다.
 */
const BUILTIN_PROMPT_PRESETS = {
    '기본': `Generate interesting TMI facts about the current conversation, mixing character details and world-building.

Good TMI examples:
- Character quirks, habits, or hidden thoughts
- World-building details and lore
- Environmental or setting details
- Relationship dynamics
- Background context or history

Mix character-focused and world-focused facts naturally.`,

    '세계관 TMI': `Generate world-building TMI facts about the setting, environment, and lore of the current scene.

Focus on:
- Location history and significance
- Cultural or societal details
- Environmental characteristics
- Technological or magical systems
- Background events or context
- Setting atmosphere and mood`,

    '캐릭터 감정 TMI': `Analyze the emotional undertones and psychological nuances of the characters in the conversation.

Focus on:
- Hidden feelings and subtext
- Relationship dynamics and tensions
- Character motivations and desires
- Inner thoughts and conflicts
- Unspoken emotions or intentions
- Psychological state and mood`,

    '감각 디테일': `Describe the sensory texture of the current scene — what it would feel like to actually be there.

Focus on:
- Smells in the air, and what they come from
- Ambient sounds, and the silence between them
- Temperature, humidity, the feel of air on skin
- Textures of surfaces the characters touch
- Quality of light and how it falls
- Small physical sensations the characters barely register

Ground every detail in what is actually present in the scene. Avoid restating what already happened.`,

    '장면 BGM': `Act as a music supervisor scoring this scene.

For each entry, describe one piece of music that would play here:
- The genre, instrumentation, and tempo
- Where in the scene it starts and how it moves
- Which emotional beat it underlines
- An existing artist or soundtrack it would sit next to

Write it as a music director's note, not as a track list.`,

    '소품 도감': `Catalogue the objects, clothing, and food present in this scene like an encyclopedia entry.

For each entry, pick one concrete item and cover:
- What it is made of and how it was made
- Its age, wear, and how it came to be here
- Who owns it and what it means to them
- A detail about it that no one in the scene has mentioned

Only use items that plausibly exist in the current scene.`,

    '뉴스 헤드라인': `Report the events of this scene as a news outlet in this world would.

Each entry is one news item:
- A headline in that outlet's voice
- A lede sentence with the who/what/where
- One quote from a bystander, official, or expert
- The angle or bias the outlet is taking

Match the outlet to the setting — a fantasy town crier, a corporate newsfeed, a tabloid, whatever fits.`,

    '위키 문서': `Write encyclopedia entries about people, places, factions, or events from this conversation.

Each entry should read like a wiki article excerpt:
- A defining opening sentence
- Background or origin
- Notable characteristics or incidents
- How it is regarded by others in the world

Keep the neutral, slightly dry tone of a reference work. Include details the characters themselves would not say out loud.`,

    'SNS 타임라인': `Show this scene as it would appear on social media in this world.

Each entry is one post:
- Who posted it (username or handle that fits the setting)
- The post itself, in that platform's voice
- Reaction counts or engagement
- One or two replies, including a misinformed or unhinged one

The platform should fit the setting — a message board, a magical sending network, a corporate intranet, whatever works.`,

    'NPC 뒷담화': `Write what the background characters are saying about the main characters when they are not around.

Each entry is one piece of gossip:
- Who is talking, and to whom
- What they claim to have seen or heard
- How distorted it is compared to what actually happened
- What it reveals about how the world sees these characters

Let the rumors be partly wrong. That is the point.`,

    '만약에 (What-if)': `Explore branches this scene could have taken but did not.

Each entry is one divergence:
- The exact moment where it would split
- What would have been said or done instead
- How the scene would unfold from there
- What it reveals about the choice that was actually made

Stay grounded in what the characters would plausibly do.`,

    '다음 씬 떡밥': `Plant hooks for what could happen next.

Each entry is one thread:
- A detail in the current scene that has not paid off yet
- Who or what it points toward
- The tension it would create if it surfaced
- A hint at when it might land

Only use threads that already exist in the conversation. Do not invent unrelated plot.`,

    '전투·능력 분석': `Analyze the capabilities on display like a tactical briefing.

Each entry covers one thing:
- A technique, ability, weapon, or tactic used or implied
- How it actually works, mechanically
- Its cost, limit, or weakness
- How it matches up against what the other side can do

If no combat occurred, analyze the potential — positioning, escape routes, who would win and why.`,

    '타로·운세': `Read this scene as a fortune teller would.

Each entry is one reading:
- The card, omen, or sign that appears
- Its traditional meaning
- How it maps onto what is happening right now
- The warning or promise it carries

Keep it evocative and ambiguous, the way real readings are.`,
};

const DEFAULT_HTML_TEMPLATE = `<div class="tmi-item">{{this}}</div>`;

// 핀한 TMI를 프롬프트에 주입할 때 쓰는 키와 기본 래퍼
const INJECT_KEY = 'TMI_PINNED';

const DEFAULT_INJECT_TEMPLATE = `[Established details — treat the following as canon:
{{tmi}}]`;

// setExtensionPrompt의 position 값 (script.js의 extension_prompt_types와 동일)
const INJECT_POSITION = {
    IN_PROMPT: 0,   // 프롬프트 안 (스토리 문자열 뒤)
    IN_CHAT: 1,     // 채팅 내 @Depth
    BEFORE_PROMPT: 2, // 프롬프트 앞
};

const DEFAULT_CSS = `/* TMI Generator - 기본 스타일 (자유롭게 수정하세요!) */

/* TMI 박스 전체 */
.tmi-container {
    margin-top: 10px;
    margin-bottom: 8px;
    border-radius: var(--genericRadius, 15px);
    background: var(--SmartThemeBlurTintColor);
    border: 1.5px solid var(--SmartThemeBorderColor);
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    font-size: var(--messageTextFontSize, var(--mainFontSize));
}

/* 헤더 (제목 부분) */
.tmi-header {
    background: var(--SmartBotMesBlurTintColor);
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1.5px solid var(--SmartThemeBorderColor);
    transition: filter 0.2s ease;
}

.tmi-header:hover {
    filter: brightness(0.95);
}

/* 제목 텍스트 */
.tmi-title {
    font-weight: bold;
    font-size: 0.9em;
    color: var(--SmartThemeUnderlineColor);
    display: flex;
    align-items: center;
    gap: 6px;
}

/* 토글 아이콘 (▼) */
.tmi-toggle-icon {
    font-size: 0.8em;
    color: var(--SmartThemeQuoteColor);
    transition: transform 0.3s ease;
    display: inline-block;
}

.tmi-toggle-icon.expanded {
    transform: rotate(180deg);
}

/* 재생성 버튼 */
.tmi-regenerate {
    background: transparent;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s ease;
    color: var(--SmartThemeBodyColor);
}

.tmi-regenerate:hover {
    background: var(--SmartThemeQuoteColor);
    transform: scale(1.05);
}

/* TMI 내용 영역 */
.tmi-content {
    overflow: hidden;
    max-height: 1000px;
    opacity: 1;
    transition: max-height 0.3s ease-out, opacity 0.3s ease-out;
}

.tmi-content.collapsed {
    max-height: 0;
    opacity: 0;
}

/* 각 TMI 항목 */
.tmi-item {
    padding: 10px 12px;
    border-bottom: 1px dashed var(--SmartThemeBorderColor);
    color: var(--SmartThemeQuoteColor);
    font-size: 0.85em;
    line-height: 1.5;
    word-break: break-word;
}

.tmi-item:last-child {
    border-bottom: none;
}

/* 로딩 상태 */
.tmi-loading {
    color: var(--SmartThemeBodyColor);
    opacity: 0.6;
    font-style: italic;
    padding: 12px;
    text-align: center;
}

/* 에러 상태 */
.tmi-error {
    color: var(--SmartThemeEmColor);
    font-style: italic;
    opacity: 0.8;
    background: var(--black20a);
}`;

const DEFAULT_SETTINGS = {
    enabled: true,
    source: 'main',
    profileId: '',
    autoGenerate: true,
    maxTokens: 1500,
    tmiCount: 3, // TMI 개수 (1-10)
    tmiLength: 'medium', // TMI 길이 ('short', 'medium', 'long')
    language: 'en', // TMI 출력 언어 ('en', 'ko')
    prompt: DEFAULT_PROMPT,
    htmlTemplate: DEFAULT_HTML_TEMPLATE,
    customCss: DEFAULT_CSS,
    autoOpen: false,
    contextMessages: 20, // 컨텍스트에 포함할 메시지 개수 (기본 20개)
    // 중복 회피
    dedupeEnabled: true,
    dedupeMessages: 30, // 몇 개 메시지까지 거슬러 올라가 기존 TMI를 참고할지
    // 핀 주입 설정
    injectEnabled: true,
    injectTemplate: DEFAULT_INJECT_TEMPLATE,
    injectPosition: INJECT_POSITION.IN_CHAT,
    injectDepth: 4,
    injectRole: 0, // 0: system, 1: user, 2: assistant
    injectScan: false, // 주입 내용으로 로어북 키워드를 발동시킬지
    tmiData: {}, // 레거시 저장소 (채팅을 열면 message.extra.tmi로 자동 이전됨)
    promptPresets: {}, // 사용자 프롬프트 프리셋 { 'preset_name': prompt } (기본 제공은 BUILTIN_PROMPT_PRESETS)
    selectedPromptPreset: '', // 마지막으로 고른 프리셋 ('builtin:이름' / 'user:이름')
    selectedCssPreset: '', // 마지막으로 고른 CSS 프리셋 이름
    cssPresets: {}, // CSS 프리셋 저장 { 'preset_name': css }
};

let extensionSettings = {};
let globalContext = null;
const pendingRequests = new Set();

// 프리셋 드롭다운을 내용에 맞게 다시 그리는 훅 (각 UI 초기화에서 채워집니다)
let refreshPromptPresetList = () => {};
let refreshCssPresetList = () => {};

// ─────────────────────────────────────────────────────────────
// TMI 저장소 (message.extra.tmi)
// ─────────────────────────────────────────────────────────────

function getMessage(messageId) {
    return globalContext?.chat?.[messageId] ?? null;
}

/** 저장된 TMI를 현재 스키마로 정규화해서 반환. 없으면 null. */
function readTMI(messageId) {
    const raw = getMessage(messageId)?.extra?.tmi;
    if (!raw || typeof raw !== 'object') return null;

    // 현재 스키마
    if (Array.isArray(raw.sets)) {
        return raw.sets.some(set => set?.items?.length) ? raw : null;
    }

    // 아주 초기 형태({ items: [...] })가 남아 있는 경우 흡수
    if (Array.isArray(raw.items) && raw.items.length > 0) {
        return makeTMI(raw.items, { visible: !!raw.visible, ts: raw.timestamp });
    }

    return null;
}

function makeTMI(items, { preset = '', visible = false, ts = null } = {}) {
    return {
        v: TMI_VERSION,
        visible: !!visible,
        sets: [{
            preset,
            items,
            ts: ts ?? Date.now(),
            pinned: [],  // 핀 기능(다음 단계)에서 사용
            edits: {},
        }],
    };
}

/** 여러 줄 항목을 한 줄로 (프롬프트의 불릿 목록에 넣을 때) */
function flattenLines(text) {
    return String(text ?? '').replace(/\s*\r?\n\s*/g, ' / ').trim();
}

/** 항목의 실제 표시/주입 텍스트 (편집본이 있으면 그것을 우선) */
function getItemText(set, itemIndex) {
    const edited = set?.edits?.[itemIndex];
    if (typeof edited === 'string' && edited.trim()) return edited;
    return set?.items?.[itemIndex] ?? '';
}

/** TMI 하나에 담긴 모든 항목의 텍스트 (편집본 반영) */
function collectItemTexts(tmi) {
    if (!tmi?.sets) return [];

    return tmi.sets.flatMap(set =>
        (set.items ?? []).map((_, itemIndex) => getItemText(set, itemIndex))
    );
}

function isPinned(set, itemIndex) {
    return Array.isArray(set?.pinned) && set.pinned.includes(itemIndex);
}

function writeTMI(messageId, tmi) {
    const message = getMessage(messageId);
    if (!message) return false;

    if (!message.extra) message.extra = {};
    message.extra.tmi = tmi;
    saveChatDebounced();
    return true;
}

function deleteTMI(messageId) {
    const message = getMessage(messageId);
    if (!message?.extra?.tmi) return false;

    delete message.extra.tmi;
    saveChatDebounced();
    updateInjection(); // 핀된 항목이 있었다면 주입에서도 빠져야 함
    return true;
}

/** 생성 중복 호출 방지용 임시 키 (저장에는 쓰이지 않음) */
function getPendingKey(messageId) {
    const message = getMessage(messageId);
    if (!message) return null;
    return `${getCurrentChatId() ?? '?'}__${messageId}_${message.swipe_id ?? 0}`;
}

// ─────────────────────────────────────────────────────────────
// 핀 & 프롬프트 주입
// ─────────────────────────────────────────────────────────────

/**
 * 현재 채팅에서 핀된 항목을 메시지 순서대로 모읍니다.
 * @returns {Array<{messageId: number, setIndex: number, itemIndex: number, text: string, preset: string}>}
 */
function collectPinnedItems() {
    const collected = [];

    (globalContext.chat ?? []).forEach((message, messageId) => {
        const tmi = readTMI(messageId);
        if (!tmi) return;

        tmi.sets.forEach((set, setIndex) => {
            [...(set.pinned ?? [])]
                .sort((a, b) => a - b)
                .forEach(itemIndex => {
                    const text = getItemText(set, itemIndex).trim();
                    if (!text) return;
                    collected.push({ messageId, setIndex, itemIndex, text, preset: set.preset ?? '' });
                });
        });
    });

    return collected;
}

/**
 * 이미 나온 TMI를 모아 "이건 또 쓰지 말라"고 알려줄 목록을 만듭니다.
 * 핀된 항목은 이미 프롬프트에 주입되고 있으므로 항상 포함합니다.
 * @param {number} messageId 기준 메시지
 * @param {string[]} extra 재생성 직전에 지운 항목 등 추가로 피할 문장
 */
function collectAvoidItems(messageId, extra = []) {
    if (!extensionSettings.dedupeEnabled) return [];

    const MAX_ITEMS = 40;
    const MAX_CHARS = 1500;

    const seen = new Set();
    const result = [];
    let chars = 0;

    const push = (value) => {
        const text = String(value ?? '').trim();
        if (!text) return;

        const key = text.toLowerCase();
        if (seen.has(key)) return;
        if (result.length >= MAX_ITEMS || chars + text.length > MAX_CHARS) return;

        seen.add(key);
        result.push(text);
        chars += text.length;
    };

    // 1. 방금 지운 항목 (재생성인데 똑같은 게 또 나오는 것 방지)
    extra.forEach(push);

    // 2. 핀된 항목 — 이미 프롬프트에 들어가 있으므로 다시 뽑으면 낭비
    collectPinnedItems().forEach(item => push(item.text));

    // 3. 최근 메시지의 TMI (최신부터 거슬러 올라가며 상한까지)
    const span = Math.max(0, Number(extensionSettings.dedupeMessages ?? 30));
    const oldest = Math.max(0, messageId - span);

    for (let i = messageId; i >= oldest; i--) {
        const tmi = readTMI(i);
        if (!tmi) continue;

        tmi.sets.forEach(set => {
            (set.items ?? []).forEach((_, itemIndex) => push(getItemText(set, itemIndex)));
        });
    }

    return result;
}

/** 핀 목록을 래퍼 템플릿에 끼워 실제 주입될 문자열을 만듭니다. */
function buildInjectionText(items) {
    if (!items.length) return '';

    // 여러 줄 항목은 한 줄로 눌러서 넣습니다 (불릿 목록 구조가 깨지지 않도록)
    const list = items.map(item => `- ${flattenLines(item.text)}`).join('\n');
    const template = extensionSettings.injectTemplate || DEFAULT_INJECT_TEMPLATE;
    const merged = template.includes('{{tmi}}')
        ? template.replace(/\{\{tmi\}\}/g, list)
        : `${template}\n${list}`;

    return globalContext.substituteParams(merged);
}

/**
 * 핀된 TMI를 프롬프트 주입 슬롯에 반영합니다.
 * 핀이 없거나 주입이 꺼져 있으면 빈 문자열로 덮어써서 완전히 사라지게 합니다.
 * @returns {{count: number, text: string}}
 */
function updateInjection() {
    const active = extensionSettings.enabled && extensionSettings.injectEnabled;
    const items = active ? collectPinnedItems() : [];
    const text = buildInjectionText(items);

    globalContext.setExtensionPrompt(
        INJECT_KEY,
        text,
        Number(extensionSettings.injectPosition ?? INJECT_POSITION.IN_CHAT),
        Number(extensionSettings.injectDepth ?? 4),
        !!extensionSettings.injectScan,
        Number(extensionSettings.injectRole ?? 0),
    );

    return { count: items.length, text };
}

/**
 * 항목의 핀 상태를 토글하고 주입을 갱신합니다.
 * @returns {boolean} 토글 후 핀 상태
 */
function togglePin(messageId, setIndex, itemIndex) {
    const tmi = readTMI(messageId);
    const set = tmi?.sets?.[setIndex];
    if (!set) return false;

    if (!Array.isArray(set.pinned)) set.pinned = [];

    const at = set.pinned.indexOf(itemIndex);
    const nowPinned = at === -1;

    if (nowPinned) {
        set.pinned.push(itemIndex);
    } else {
        set.pinned.splice(at, 1);
    }

    writeTMI(messageId, tmi);
    updateInjection();
    syncPinIndicator(messageId, setIndex, itemIndex, nowPinned);

    return nowPinned;
}

/** 메시지에 표시된 핀 아이콘 상태를 저장값과 맞춥니다. */
function syncPinIndicator(messageId, setIndex, itemIndex, pinned) {
    $(`[mesid="${messageId}"] .tmi-container`)
        .find(`[data-tmi-set="${setIndex}"][data-tmi-item="${itemIndex}"]`)
        .toggleClass('tmi-is-pinned', pinned);
}

/** 현재 채팅의 모든 핀을 해제합니다. */
function unpinAll() {
    let count = 0;

    (globalContext.chat ?? []).forEach((message, messageId) => {
        const tmi = readTMI(messageId);
        if (!tmi) return;

        let changed = false;
        tmi.sets.forEach(set => {
            if (set.pinned?.length) {
                count += set.pinned.length;
                set.pinned = [];
                changed = true;
            }
        });

        if (changed) writeTMI(messageId, tmi);
    });

    if (count > 0) {
        updateInjection();
        $('.tmi-is-pinned').removeClass('tmi-is-pinned');
    }

    return count;
}

// ─────────────────────────────────────────────────────────────
// 레거시 저장소(settings.json의 tmiData) 이전
// ─────────────────────────────────────────────────────────────

/**
 * 현재 채팅에 해당하는 레거시 TMI를 메시지로 옮깁니다.
 * 옮긴 키만 삭제하므로, 이미 사라진 채팅의 데이터는 그대로 남아 있다가
 * 설정의 "레거시 저장소 정리"로 지울 수 있습니다.
 * @returns {Promise<number>} 이전된 항목 수
 */
async function migrateLegacyTMI() {
    const legacy = extensionSettings.tmiData;
    if (!legacy || Object.keys(legacy).length === 0) return 0;

    const chatId = getCurrentChatId();
    if (!chatId) return 0;

    const prefix = `${chatId}__`;
    let migrated = 0;

    for (const key of Object.keys(legacy)) {
        if (!key.startsWith(prefix)) continue;

        // "<chatId>__<messageId>_<swipeId>"
        const match = key.slice(prefix.length).match(/^(\d+)_(\d+)$/);
        if (!match) continue;

        const messageId = Number(match[1]);
        const swipeId = Number(match[2]);
        const entry = legacy[key];
        const message = getMessage(messageId);

        // 메시지가 없으면 고아 데이터 → 남겨두고 넘어감
        if (!message || !Array.isArray(entry?.items) || entry.items.length === 0) continue;

        const tmi = makeTMI(entry.items, { visible: entry.visible, ts: entry.timestamp });
        const currentSwipe = message.swipe_id ?? 0;

        if (swipeId === currentSwipe) {
            if (!message.extra) message.extra = {};
            if (!message.extra.tmi) message.extra.tmi = tmi;
        } else if (message.swipe_info?.[swipeId] && typeof message.swipe_info[swipeId] === 'object') {
            // 지금 보고 있지 않은 스와이프의 TMI도 그대로 보존
            const info = message.swipe_info[swipeId];
            if (!info.extra) info.extra = {};
            if (!info.extra.tmi) info.extra.tmi = tmi;
        } else {
            // 대상 스와이프가 사라짐 → 고아 데이터로 남김
            continue;
        }

        delete legacy[key];
        migrated++;
    }

    if (migrated > 0) {
        await globalContext.saveChat();
        saveSettings();
        console.log(`[${EXTENSION_NAME}] 레거시 TMI ${migrated}개를 메시지로 이전했습니다.`);
    }

    return migrated;
}

function getLegacyCount() {
    return Object.keys(extensionSettings.tmiData ?? {}).length;
}

async function init() {
    console.log(`[${EXTENSION_NAME}] 초기화 시작...`);

    globalContext = SillyTavern.getContext();

    if (!globalContext.extensionSettings[EXTENSION_NAME]) {
        globalContext.extensionSettings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    extensionSettings = globalContext.extensionSettings[EXTENSION_NAME];

    Object.keys(DEFAULT_SETTINGS).forEach(key => {
        if (extensionSettings[key] === undefined) {
            extensionSettings[key] = DEFAULT_SETTINGS[key];
        }
    });

    // 기존 presets를 promptPresets와 cssPresets로 마이그레이션
    if (extensionSettings.presets && !extensionSettings.promptPresets && !extensionSettings.cssPresets) {
        console.log(`[${EXTENSION_NAME}] 기존 presets를 분리합니다...`);
        extensionSettings.promptPresets = {};
        extensionSettings.cssPresets = {};

        Object.keys(extensionSettings.presets).forEach(name => {
            const preset = extensionSettings.presets[name];
            if (preset.prompt) {
                extensionSettings.promptPresets[name] = preset.prompt;
            }
            if (preset.customCss) {
                extensionSettings.cssPresets[name] = preset.customCss;
            }
        });

        delete extensionSettings.presets;
        saveSettings();
        console.log(`[${EXTENSION_NAME}] 마이그레이션 완료: ${Object.keys(extensionSettings.promptPresets).length}개 프롬프트, ${Object.keys(extensionSettings.cssPresets).length}개 CSS`);
    }

    // 예전에 심어둔 기본 프리셋 정리 (빌트인으로 대체)
    pruneSeededPresets();

    await loadSettingsUI();
    initializeEventListeners();
    injectCustomCSS();
    addManagerMenuButton();
    updateInjection();

    console.log(`[${EXTENSION_NAME}] 초기화 완료`);
}

/**
 * 예전 버전이 promptPresets에 직접 심어두던 기본 프리셋 3종.
 * 사용자가 손대지 않은 것만 골라내 지우기 위해 원문 그대로 보관합니다.
 */
function pruneSeededPresets() {
    const seeded = {
        '기본': BUILTIN_PROMPT_PRESETS['기본'],
        '세계관 TMI': BUILTIN_PROMPT_PRESETS['세계관 TMI'],
        '캐릭터 감정 TMI': BUILTIN_PROMPT_PRESETS['캐릭터 감정 TMI'],
    };

    if (!extensionSettings.promptPresets) extensionSettings.promptPresets = {};

    let pruned = 0;
    Object.entries(seeded).forEach(([name, text]) => {
        // 줄바꿈 차이(CRLF/LF)로 비교가 어긋나지 않도록 정규화해서 대조
        if (normalizeText(extensionSettings.promptPresets[name]) === normalizeText(text)) {
            // 내용이 기본값 그대로 = 그냥 심어졌던 것 → 빌트인으로 대체
            delete extensionSettings.promptPresets[name];
            pruned++;
        }
    });

    if (pruned > 0) {
        console.log(`[${EXTENSION_NAME}] 기본값 그대로였던 프리셋 ${pruned}개를 빌트인으로 대체했습니다.`);
    }

    // CSS 프리셋 초기화 (기본 하나만)
    if (!extensionSettings.cssPresets) extensionSettings.cssPresets = {};
    if (Object.keys(extensionSettings.cssPresets).length === 0) {
        extensionSettings.cssPresets['기본'] = DEFAULT_CSS;
        console.log(`[${EXTENSION_NAME}] 기본 CSS 프리셋 추가됨`);
    }

    saveSettings();
}

async function loadSettingsUI() {
    const settingsHtml = await globalContext.renderExtensionTemplateAsync(
        `third-party/${EXTENSION_NAME}`,
        'settings',
    );
    $('#extensions_settings').append(settingsHtml);

    const settingsContainer = $('.tmi_settings');

    settingsContainer.find('.extension_enabled')
        .prop('checked', extensionSettings.enabled)
        .on('change', function() {
            extensionSettings.enabled = $(this).prop('checked');
            saveSettings();
            updateInjection(); // 비활성화하면 주입도 즉시 빠짐

            if (extensionSettings.enabled) {
                toastr.success('TMI Generator가 활성화되었습니다. 🎉');
                // 활성화 시: 자동 생성이 꺼져 있으면 버튼 표시
                if (!extensionSettings.autoGenerate) {
                    restoreAllTMI();
                }
            } else {
                toastr.info('TMI Generator가 비활성화되었습니다.');
                // 비활성화 시: 모든 생성 버튼 숨기기
                $('.mes_tmi_generate').hide();
            }
        });

    // Source 선택 (Main API / Connection Profile)
    settingsContainer.find('.source_select')
        .val(extensionSettings.source || 'main')
        .on('change', function() {
            extensionSettings.source = $(this).val();
            saveSettings();
            updateSourceVisibility();
        });

    // Source visibility 업데이트
    function updateSourceVisibility() {
        if (extensionSettings.source === 'profile') {
            $('#tmi_profile_settings').show();
        } else {
            $('#tmi_profile_settings').hide();
        }
    }
    updateSourceVisibility();

    globalContext.ConnectionManagerRequestService.handleDropdown(
        '.tmi_settings .connection_profile',
        extensionSettings.profileId,
        (profile) => {
            extensionSettings.profileId = profile?.id ?? '';
            saveSettings();
            console.log(`[${EXTENSION_NAME}] 연결 프로필 변경:`, profile?.name || '없음');
        },
    );

    settingsContainer.find('.auto_generate')
        .prop('checked', extensionSettings.autoGenerate)
        .on('change', function() {
            extensionSettings.autoGenerate = $(this).prop('checked');
            saveSettings();

            // 자동 생성 OFF → TMI 없는 메시지에 생성 버튼 표시
            if (!extensionSettings.autoGenerate) {
                globalContext.chat.forEach((message, messageId) => {
                    if (!message.is_user) {
                        // TMI가 없으면 생성 버튼 표시
                        if (readTMI(messageId)) {
                            hideGenerateButton(messageId);
                        } else {
                            showGenerateButton(messageId);
                        }
                    }
                });
            } else {
                // 자동 생성 ON → 생성 버튼 숨기기
                $('.mes_tmi_generate').hide();
            }
        });

    settingsContainer.find('.tmi_count')
        .val(extensionSettings.tmiCount)
        .on('change', function() {
            extensionSettings.tmiCount = Number($(this).val());
            saveSettings();
        });

    settingsContainer.find('.tmi_length')
        .val(extensionSettings.tmiLength)
        .on('change', function() {
            extensionSettings.tmiLength = $(this).val();
            saveSettings();
        });

    settingsContainer.find('.tmi_language')
        .val(extensionSettings.language || 'en')
        .on('change', function() {
            extensionSettings.language = $(this).val();
            saveSettings();
        });

    settingsContainer.find('.max_tokens')
        .val(extensionSettings.maxTokens)
        .on('change', function() {
            extensionSettings.maxTokens = Number($(this).val());
            saveSettings();
        });

    settingsContainer.find('.context_messages')
        .val(extensionSettings.contextMessages)
        .on('change', function() {
            extensionSettings.contextMessages = Number($(this).val());
            saveSettings();
        });

    settingsContainer.find('.prompt')
        .val(extensionSettings.prompt)
        .on('change', function() {
            extensionSettings.prompt = $(this).val();
            saveSettings();
            refreshPromptPresetList(); // 내용이 바뀌었으니 라벨도 다시 맞춤
        });

    settingsContainer.find('.restore_prompt').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '기본 프롬프트로 복원하시겠습니까?',
            'TMI 프롬프트 복원'
        );
        if (confirm) {
            extensionSettings.prompt = DEFAULT_PROMPT;
            settingsContainer.find('.prompt').val(DEFAULT_PROMPT);
            saveSettings();
            refreshPromptPresetList();
            toastr.success('프롬프트가 복원되었습니다.');
        }
    });

    // ── 중복 회피 ──
    function updateDedupeVisibility() {
        $('#tmi_dedupe_row').toggle(!!extensionSettings.dedupeEnabled);
    }

    settingsContainer.find('.dedupe_enabled')
        .prop('checked', extensionSettings.dedupeEnabled)
        .on('change', function() {
            extensionSettings.dedupeEnabled = $(this).prop('checked');
            saveSettings();
            updateDedupeVisibility();
        });
    updateDedupeVisibility();

    settingsContainer.find('.dedupe_messages')
        .val(extensionSettings.dedupeMessages)
        .on('change', function() {
            extensionSettings.dedupeMessages = Number($(this).val());
            saveSettings();
        });

    // ── 핀 주입 설정 ──
    settingsContainer.find('.inject_enabled')
        .prop('checked', extensionSettings.injectEnabled)
        .on('change', function() {
            extensionSettings.injectEnabled = $(this).prop('checked');
            saveSettings();
            const { count } = updateInjection();
            toastr.info(extensionSettings.injectEnabled
                ? `핀 주입 켜짐 (${count}개)`
                : '핀 주입 꺼짐');
        });

    function updateDepthVisibility() {
        const inChat = Number(extensionSettings.injectPosition) === INJECT_POSITION.IN_CHAT;
        $('#tmi_inject_depth_row').toggle(inChat);
    }

    settingsContainer.find('.inject_position')
        .val(String(extensionSettings.injectPosition ?? INJECT_POSITION.IN_CHAT))
        .on('change', function() {
            extensionSettings.injectPosition = Number($(this).val());
            saveSettings();
            updateDepthVisibility();
            updateInjection();
        });
    updateDepthVisibility();

    settingsContainer.find('.inject_depth')
        .val(extensionSettings.injectDepth)
        .on('change', function() {
            extensionSettings.injectDepth = Number($(this).val());
            saveSettings();
            updateInjection();
        });

    settingsContainer.find('.inject_role')
        .val(String(extensionSettings.injectRole ?? 0))
        .on('change', function() {
            extensionSettings.injectRole = Number($(this).val());
            saveSettings();
            updateInjection();
        });

    settingsContainer.find('.inject_scan')
        .prop('checked', extensionSettings.injectScan)
        .on('change', function() {
            extensionSettings.injectScan = $(this).prop('checked');
            saveSettings();
            updateInjection();
        });

    settingsContainer.find('.inject_template')
        .val(extensionSettings.injectTemplate)
        .on('change', function() {
            extensionSettings.injectTemplate = $(this).val();
            saveSettings();
            updateInjection();
        });

    settingsContainer.find('.restore_inject_template').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '기본 주입 템플릿으로 복원하시겠습니까?',
            '주입 템플릿 복원'
        );
        if (!confirm) return;

        extensionSettings.injectTemplate = DEFAULT_INJECT_TEMPLATE;
        settingsContainer.find('.inject_template').val(DEFAULT_INJECT_TEMPLATE);
        saveSettings();
        updateInjection();
        toastr.success('주입 템플릿이 복원되었습니다.');
    });

    settingsContainer.find('.custom_css')
        .val(extensionSettings.customCss)
        .on('change', function() {
            extensionSettings.customCss = $(this).val();
            saveSettings();
            injectCustomCSS();
            refreshCssPresetList(); // 내용이 바뀌었으니 라벨도 다시 맞춤
        });

    settingsContainer.find('.restore_css').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '기본 CSS로 복원하시겠습니까?',
            'CSS 복원'
        );
        if (confirm) {
            extensionSettings.customCss = DEFAULT_CSS;
            settingsContainer.find('.custom_css').val(DEFAULT_CSS);
            saveSettings();
            injectCustomCSS();
            refreshCssPresetList();
            toastr.success('CSS가 복원되었습니다.');
        }
    });

    // TMI 데이터 초기화 버튼들
    settingsContainer.find('.tmi_clear_current').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '현재 채팅방의 모든 TMI 데이터를 삭제하시겠습니까?\n(화면에 표시된 TMI도 함께 사라집니다)',
            '현재 채팅방 TMI 초기화'
        );
        if (!confirm) return;

        const clearedCount = await clearCurrentChatTMI();

        // 화면에서도 TMI 제거
        $('.tmi-container').remove();

        // 자동 생성이 꺼져 있으면 생성 버튼 표시
        if (!extensionSettings.autoGenerate) {
            globalContext.chat.forEach((message, messageId) => {
                if (!message.is_user) {
                    showGenerateButton(messageId);
                }
            });
        }

        toastr.success(`현재 채팅방의 TMI ${clearedCount}개가 삭제되었습니다.`);
    });

    // 레거시 저장소(settings.json) 정리
    const legacyButton = settingsContainer.find('.tmi_clear_legacy');

    function updateLegacyButton() {
        const count = getLegacyCount();
        legacyButton.text(`레거시 저장소 정리 (${count}개)`);
        legacyButton.prop('disabled', count === 0);
    }
    updateLegacyButton();

    legacyButton.on('click', async function() {
        const count = getLegacyCount();
        if (count === 0) return;

        const confirm = await globalContext.Popup.show.confirm(
            `구버전 저장소(settings.json)에 남아 있는 TMI ${count}개를 삭제합니다.\n` +
            '이미 사라진 채팅방의 데이터거나, 아직 열어보지 않은 채팅방의 데이터입니다.\n' +
            '해당 채팅방을 한 번 열면 자동으로 메시지 쪽으로 이전되니,\n' +
            '아직 안 연 채팅방이 있다면 먼저 열어본 뒤에 정리하세요.\n\n' +
            '그래도 삭제하시겠습니까?',
            '레거시 저장소 정리'
        );
        if (!confirm) return;

        extensionSettings.tmiData = {};
        saveSettings();
        updateLegacyButton();
        toastr.success(`레거시 TMI ${count}개가 정리되었습니다.`);
    });

    settingsContainer.find('.auto_open')
        .prop('checked', extensionSettings.autoOpen)
        .on('change', function() {
            extensionSettings.autoOpen = $(this).prop('checked');
            saveSettings();
        });

    // 프리셋 관리 (분리)
    initializePromptPresetUI(settingsContainer);
    initializeCssPresetUI(settingsContainer);
}

/** 줄바꿈/앞뒤 공백 차이를 무시하고 내용을 비교하기 위한 정규화 */
function normalizeText(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

/** 내용이 정확히 일치하는 프리셋 이름을 찾습니다. 없으면 '' */
function findMatchingPresetName(presets, content) {
    const target = normalizeText(content);
    if (!target) return '';

    return Object.keys(presets ?? {}).find(name => normalizeText(presets[name]) === target) ?? '';
}

/** 현재 프롬프트와 내용이 같은 프리셋 키를 찾습니다 (빌트인 우선). 없으면 '' */
function findMatchingPromptKey(prompt) {
    const builtin = findMatchingPresetName(BUILTIN_PROMPT_PRESETS, prompt);
    if (builtin) return makePresetKey('builtin', builtin);

    const user = findMatchingPresetName(extensionSettings.promptPresets, prompt);
    if (user) return makePresetKey('user', user);

    return '';
}

// 프리셋 키: 빌트인과 사용자 프리셋의 이름이 겹쳐도 구분되도록 접두사를 붙입니다.
function makePresetKey(scope, name) {
    return `${scope}:${name}`;
}

function parsePresetKey(key) {
    const at = String(key ?? '').indexOf(':');
    if (at === -1) return { scope: 'user', name: String(key ?? '') };
    return { scope: key.slice(0, at), name: key.slice(at + 1) };
}

function getPresetPrompt(key) {
    const { scope, name } = parsePresetKey(key);
    return scope === 'builtin'
        ? BUILTIN_PROMPT_PRESETS[name]
        : extensionSettings.promptPresets?.[name];
}

/** 생성된 TMI에 기록할 프리셋 이름 (접두사 없는 표시용 이름) */
function getCurrentPresetLabel() {
    return parsePresetKey(extensionSettings.selectedPromptPreset).name || '';
}

/** 프리셋 목록을 <select>에 채웁니다 (설정 패널·관리 패널 공용) */
function fillPromptPresetOptions(select) {
    select.empty();

    // 어떤 프리셋과도 내용이 다를 때 (직접 편집했을 때) 정직하게 표시할 자리
    select.append($('<option></option>').attr('value', '').text('— 직접 편집 —'));

    const builtinGroup = $('<optgroup label="기본 제공"></optgroup>');
    Object.keys(BUILTIN_PROMPT_PRESETS).forEach(name => {
        builtinGroup.append($('<option></option>')
            .attr('value', makePresetKey('builtin', name))
            .text(name));
    });
    select.append(builtinGroup);

    const userNames = Object.keys(extensionSettings.promptPresets ?? {});
    if (userNames.length > 0) {
        const userGroup = $('<optgroup label="내 프리셋"></optgroup>');
        userNames.forEach(name => {
            userGroup.append($('<option></option>')
                .attr('value', makePresetKey('user', name))
                .text(name));
        });
        select.append(userGroup);
    }
}

/**
 * 프리셋을 활성화하고 열려 있는 모든 UI를 맞춥니다.
 * (설정 패널 / 관리 패널 / 박스 헤더 어디서 바꿔도 같은 결과)
 * @returns {boolean} 적용 성공 여부
 */
function applyPromptPreset(key) {
    const prompt = getPresetPrompt(key);
    if (prompt === undefined) return false;

    extensionSettings.selectedPromptPreset = key;
    extensionSettings.prompt = prompt;
    saveSettings();

    $('.tmi_settings .prompt').val(prompt);
    refreshPromptPresetList();

    return true;
}

// 프롬프트 프리셋 관리
function initializePromptPresetUI(settingsContainer) {
    const presetSelect = settingsContainer.find('.prompt_preset_select');

    function updatePresetList() {
        fillPromptPresetOptions(presetSelect);

        // 라벨은 "지금 들어 있는 내용"에서 도출합니다. 저장된 선택은 내용이 같은
        // 프리셋이 여럿일 때의 타이브레이커로만 씁니다.
        const saved = extensionSettings.selectedPromptPreset;
        const savedContent = saved ? getPresetPrompt(saved) : undefined;
        const savedStillMatches = savedContent !== undefined
            && normalizeText(savedContent) === normalizeText(extensionSettings.prompt);

        const resolved = savedStillMatches ? saved : findMatchingPromptKey(extensionSettings.prompt);

        presetSelect.val(resolved);
        extensionSettings.selectedPromptPreset = resolved;
    }

    refreshPromptPresetList = updatePresetList;

    updatePresetList();

    // 프리셋 선택 시 불러오기
    presetSelect.on('change', function() {
        const key = String($(this).val());

        // "직접 편집"을 고르면 프롬프트는 그대로 두고 선택만 해제
        if (!key) {
            extensionSettings.selectedPromptPreset = '';
            saveSettings();
            return;
        }

        if (!applyPromptPreset(key)) return;
        toastr.success(`프롬프트 "${parsePresetKey(key).name}" 적용됨`);
    });

    // 프리셋 저장 (빌트인을 수정한 경우 "내 프리셋"으로 복사됨)
    settingsContainer.find('.prompt_preset_save').on('click', async function() {
        const current = parsePresetKey(presetSelect.val());
        const suggested = current.scope === 'builtin' ? `${current.name} (수정)` : current.name;

        const name = await globalContext.Popup.show.input(
            '프롬프트 프리셋 이름:',
            '기본 제공 프리셋은 덮어쓰이지 않고 "내 프리셋"으로 저장됩니다.',
            suggested,
        );
        if (!name || !name.trim()) return;

        const trimmed = name.trim();
        if (extensionSettings.promptPresets?.[trimmed]) {
            const confirm = await globalContext.Popup.show.confirm(
                `"${trimmed}" 프리셋이 이미 존재합니다. 덮어쓰시겠습니까?`,
                '프롬프트 덮어쓰기'
            );
            if (!confirm) return;
        }

        if (!extensionSettings.promptPresets) extensionSettings.promptPresets = {};
        extensionSettings.promptPresets[trimmed] = extensionSettings.prompt;
        extensionSettings.selectedPromptPreset = makePresetKey('user', trimmed);
        saveSettings();
        updatePresetList();
        presetSelect.val(extensionSettings.selectedPromptPreset);
        toastr.success(`프롬프트 "${trimmed}" 저장됨`);
    });

    // 프리셋 삭제 (내 프리셋만)
    settingsContainer.find('.prompt_preset_delete').on('click', async function() {
        const { scope, name } = parsePresetKey(presetSelect.val());

        if (!name) {
            toastr.warning('삭제할 프롬프트 프리셋을 선택하세요.');
            return;
        }

        if (scope === 'builtin') {
            toastr.info('기본 제공 프리셋은 삭제할 수 없습니다.');
            return;
        }

        const confirm = await globalContext.Popup.show.confirm(
            `"${name}" 프롬프트 프리셋을 삭제하시겠습니까?`,
            '프롬프트 프리셋 삭제'
        );
        if (!confirm) return;

        delete extensionSettings.promptPresets[name];
        extensionSettings.selectedPromptPreset = '';
        saveSettings();
        updatePresetList();
        toastr.success(`프롬프트 "${name}" 삭제됨`);
    });
}

// CSS 프리셋 관리
function initializeCssPresetUI(settingsContainer) {
    const presetSelect = settingsContainer.find('.css_preset_select');

    function updatePresetList() {
        presetSelect.empty();

        // 어떤 프리셋과도 내용이 다를 때 (직접 편집했을 때) 정직하게 표시할 자리
        presetSelect.append($('<option></option>').attr('value', '').text('— 직접 편집 —'));

        Object.keys(extensionSettings.cssPresets ?? {}).forEach(name => {
            presetSelect.append($('<option></option>').attr('value', name).text(name));
        });

        // 마지막에 고른 프리셋을 복원. 없거나 사라졌으면 현재 CSS와 내용이 같은 프리셋을 찾고,
        // 그것도 없으면 "직접 편집". (예전에는 무조건 첫 항목을 골라서 라벨과 내용이 어긋났습니다)
        const saved = extensionSettings.selectedCssPreset;
        const savedContent = saved ? extensionSettings.cssPresets?.[saved] : undefined;
        const savedStillMatches = savedContent !== undefined
            && normalizeText(savedContent) === normalizeText(extensionSettings.customCss);

        const resolved = savedStillMatches
            ? saved
            : findMatchingPresetName(extensionSettings.cssPresets, extensionSettings.customCss);

        presetSelect.val(resolved);
        extensionSettings.selectedCssPreset = resolved;
    }

    refreshCssPresetList = updatePresetList;

    updatePresetList();

    // 프리셋 선택 시 불러오기
    presetSelect.on('change', function() {
        const name = String($(this).val());

        // "직접 편집"을 고르면 CSS는 그대로 두고 선택만 해제
        if (!name) {
            extensionSettings.selectedCssPreset = '';
            saveSettings();
            return;
        }

        if (!extensionSettings.cssPresets?.[name]) return;

        extensionSettings.selectedCssPreset = name;
        extensionSettings.customCss = extensionSettings.cssPresets[name];
        settingsContainer.find('.custom_css').val(extensionSettings.customCss);
        saveSettings();
        injectCustomCSS();
        toastr.success(`CSS "${name}" 적용됨`);
    });

    // 프리셋 저장
    settingsContainer.find('.css_preset_save').on('click', async function() {
        const name = await globalContext.Popup.show.input('CSS 프리셋 이름:', 'CSS 저장');
        if (!name || !name.trim()) return;

        const trimmed = name.trim();
        if (extensionSettings.cssPresets[trimmed]) {
            const confirm = await globalContext.Popup.show.confirm(
                `"${trimmed}" 프리셋이 이미 존재합니다. 덮어쓰시겠습니까?`,
                'CSS 덮어쓰기'
            );
            if (!confirm) return;
        }

        if (!extensionSettings.cssPresets) extensionSettings.cssPresets = {};
        extensionSettings.cssPresets[trimmed] = extensionSettings.customCss;
        extensionSettings.selectedCssPreset = trimmed;
        saveSettings();
        updatePresetList();
        presetSelect.val(trimmed);
        toastr.success(`CSS "${trimmed}" 저장됨`);
    });

    // 프리셋 삭제
    settingsContainer.find('.css_preset_delete').on('click', async function() {
        const name = String(presetSelect.val());
        if (!name) {
            toastr.warning('삭제할 CSS 프리셋을 선택하세요.');
            return;
        }

        const confirm = await globalContext.Popup.show.confirm(
            `"${name}" CSS 프리셋을 삭제하시겠습니까?`,
            'CSS 프리셋 삭제'
        );

        if (confirm) {
            delete extensionSettings.cssPresets[name];
            extensionSettings.selectedCssPreset = '';
            saveSettings();
            updatePresetList();
            toastr.success(`CSS "${name}" 삭제됨`);
        }
    });
}

function saveSettings() {
    globalContext.saveSettingsDebounced();
}

function injectCustomCSS() {
    $('#tmi-custom-css').remove();
    if (extensionSettings.customCss) {
        $('head').append(`<style id="tmi-custom-css">${extensionSettings.customCss}</style>`);
    }
}

function initializeEventListeners() {
    // TMI 생성 버튼을 message_template에 추가 (모든 새 메시지에 자동 포함)
    const tmiButton = document.createElement('div');
    tmiButton.title = 'TMI 생성';
    tmiButton.className = 'mes_button mes_tmi_generate fa-solid fa-comment-dots interactable';
    tmiButton.tabIndex = 0;
    tmiButton.setAttribute('role', 'button');
    // Extension이 비활성화되어 있으면 숨김
    if (!extensionSettings.enabled) {
        tmiButton.style.display = 'none';
    }
    document.querySelector('#message_template .mes_buttons .extraMesButtons')?.prepend(tmiButton);

    // 글로벌 클릭 리스너로 TMI 버튼 처리
    document.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('mes_tmi_generate')) return;

        const messageEl = target.closest('.mes');
        if (!messageEl) return;

        const messageId = Number(messageEl.getAttribute('mesid'));
        if (isNaN(messageId)) return;

        // 버튼 비활성화
        target.classList.add('fa-spin');
        target.style.pointerEvents = 'none';

        try {
            await generateTMI(messageId);
        } finally {
            // 항상 스핀 제거 및 버튼 복원
            target.classList.remove('fa-spin');
            target.style.pointerEvents = 'auto';

            // 생성 성공 시 버튼 숨기기
            if ($(`[mesid="${messageId}"] .tmi-container`).length) {
                hideGenerateButton(messageId);
            }
        }
    });

    globalContext.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
        console.log(`[${EXTENSION_NAME}] CHARACTER_MESSAGE_RENDERED:`, messageId);

        if (!extensionSettings.enabled) {
            return;
        }

        const message = globalContext.chat[messageId];
        if (!message || message.is_user) {
            return;
        }

        // 이미 저장된 TMI가 있으면 그대로 표시 (스와이프별 저장은 ST가 처리)
        const tmi = readTMI(messageId);
        if (tmi) {
            renderTMI(messageId, tmi);
            // TMI가 있으면 생성 버튼 숨기기
            hideGenerateButton(messageId);
            return;
        }

        // 자동 생성이 켜져 있으면 새로 생성
        if (extensionSettings.autoGenerate) {
            await generateTMI(messageId);
            hideGenerateButton(messageId);
        } else {
            // 자동 생성이 꺼져 있으면 생성 버튼 표시
            showGenerateButton(messageId);
        }
    });

    globalContext.eventSource.on(event_types.CHAT_CHANGED, async () => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] CHAT_CHANGED - 렌더 대기 후 TMI 복원`);

        const chatId = getCurrentChatId();
        // 고정 대기 대신 실제 렌더가 끝날 때까지 기다림
        const rendered = await waitForChatRender(chatId);
        if (!rendered) {
            console.warn(`[${EXTENSION_NAME}] 채팅 렌더 대기 실패 - TMI 복원을 건너뜁니다.`);
            return;
        }

        // 구버전(settings.json) 데이터가 있으면 이 채팅 몫만 메시지로 이전
        const migrated = await migrateLegacyTMI();
        if (migrated > 0) {
            toastr.info(`TMI ${migrated}개를 채팅 파일로 이전했습니다.`);
            $('.tmi_settings .tmi_clear_legacy').text(`레거시 저장소 정리 (${getLegacyCount()}개)`)
                .prop('disabled', getLegacyCount() === 0);
        }

        restoreAllTMI();
        updateInjection();
    });

    // 위로 스크롤해 옛 메시지가 추가로 렌더링됐을 때도 복원
    globalContext.eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MORE_MESSAGES_LOADED - 추가 메시지 TMI 복원`);
        restoreAllTMI();
    });

    // 메시지가 지워지면 핀도 함께 사라지므로 주입 갱신
    globalContext.eventSource.on(event_types.MESSAGE_DELETED, () => {
        updateInjection();
    });

    // 생성 직전 안전망: 어떤 경로로든 주입이 어긋나 있으면 여기서 맞춰짐
    globalContext.eventSource.on(event_types.GENERATION_STARTED, () => {
        updateInjection();
    });

    // 메시지 수정/복구 후 TMI 복원
    globalContext.eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_UPDATED:`, messageId);

        const tmi = readTMI(messageId);
        if (!tmi) return;

        // 편집으로 .mes_text가 새로 그려지므로 다시 붙여줌
        $(`[mesid="${messageId}"] .mes_text`).find('.tmi-container').remove();
        renderTMI(messageId, tmi);
    });

    // 메시지 삭제 시 TMI도 함께 사라짐 (메시지에 붙어 있으므로 별도 처리 불필요)

    // 스와이프 이벤트: ST가 message.extra를 해당 스와이프 것으로 복원해준 뒤에 발화됨
    globalContext.eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_SWIPED:`, messageId);

        const message = getMessage(messageId);
        if (!message || message.is_user) return;

        // 기존 TMI 제거
        $(`[mesid="${messageId}"] .mes_text`).find('.tmi-container').remove();

        // 이 스와이프에 저장된 TMI만 표시 (새로 생성하지 않음)
        const tmi = readTMI(messageId);
        if (tmi) {
            renderTMI(messageId, tmi);
            hideGenerateButton(messageId);
        } else if (!extensionSettings.autoGenerate) {
            showGenerateButton(messageId);
        }
        // 새 스와이프면 생성 후 CHARACTER_MESSAGE_RENDERED에서 처리됨

        // 스와이프마다 핀이 다르므로 주입도 다시 계산
        updateInjection();
    });
}

/**
 * 채팅이 실제로 화면에 그려질 때까지 대기합니다.
 * @param {string|null} expectedChatId 대기 도중 다른 채팅으로 옮겨가면 중단
 * @returns {Promise<boolean>} 렌더 완료 여부
 */
async function waitForChatRender(expectedChatId, timeoutMs = 5000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        // 그새 다른 채팅으로 이동했으면 이 복원은 무효
        if (getCurrentChatId() !== expectedChatId) return false;

        const chatLength = globalContext.chat?.length ?? 0;
        if (chatLength === 0) return true;

        // 마지막 메시지는 항상 그려지므로 이것이 렌더 완료 신호
        if (document.querySelector(`#chat .mes[mesid="${chatLength - 1}"]`)) return true;

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return false;
}

function buildFullPrompt(avoidItems = []) {
    // 언어 설정
    // 프리셋·포맷 규칙·대화 컨텍스트가 모두 영어라, 짧은 한 줄로는 밀립니다.
    // 그래서 프롬프트 맨 끝에 두고, 작중 텍스트까지 포함된다는 걸 명시합니다.
    const language = extensionSettings.language || 'en';
    const languageName = language === 'ko' ? 'Korean (한국어)' : 'English';
    const languageInstruction = `LANGUAGE — this section overrides every instruction above:
- Write EVERY entry entirely in ${languageName}.
- This includes all in-world text: social media posts, captions, headlines, article bodies, quotes, dialogue, replies, comments, and usernames' surrounding text.
- Do this even when the conversation, the character card, and these instructions are in a different language. The source language does not matter.
- Keep only proper nouns in their original form: character names, place names, @handles, brand names.
- Do NOT provide translations, glosses, or parenthetical restatements in any other language.
- Mixing languages within or across entries is a failure.`;

    // 길이 조건
    const lengthInstructions = {
        'short': '1-2 sentences per fact (keep it brief)',
        'medium': '3-5 sentences per fact (balanced detail)',
        'long': '7+ sentences per fact (comprehensive detail)',
    };

    // 이미 나온 TMI 목록 (중복 회피)
    const avoidBlock = avoidItems.length > 0
        ? `\n\nAlready covered in earlier TMI for this chat. Do NOT repeat, rephrase, or restate any of these:\n${
            avoidItems.map(text => `- ${flattenLines(text)}`).join('\n')
        }\nGenerate entries that are genuinely new compared to the list above.`
        : '';

    // 전체 프롬프트 조합
    // 순서가 중요합니다: 내용 지시 → 제외 목록 → 형식 → 언어(마지막).
    // 언어 지시가 가운데 있으면 뒤따르는 영어 규칙과 영어 대화에 밀려 섞여 나옵니다.
    const fullPrompt = `${globalContext.substituteParams(extensionSettings.prompt)}${avoidBlock}

CRITICAL FORMAT - You MUST use this EXACT structure:
<tmi>
- First entry. If it needs more lines — dialogue, stats, replies, sub-details —
  they continue here under the same bullet, never starting with "-".
- Second entry.
- Third entry.
</tmi>

Requirements:
- Generate exactly ${extensionSettings.tmiCount} entries
- Length per entry: ${lengthInstructions[extensionSettings.tmiLength]}
- MUST start with <tmi> and end with </tmi>
- Write NOTHING outside the tags. No preamble, no headings, no separators, no closing remarks. If you want to write it, it goes inside an entry.
- One entry = one bullet starting with "- ". Multi-line entries are fine, but only the FIRST line of an entry may start with "-".
- Never use sub-bullets, markdown headings, or "---" separators between entries.

${languageInstruction}`;

    return fullPrompt;
}

/**
 * @param {number} messageId
 * @param {{avoid?: string[]}} [options] avoid: 이번 생성에서 피해야 할 문장 (재생성 직전에 지운 항목 등)
 */
async function generateTMI(messageId, options = {}) {
    if (!extensionSettings.enabled) {
        return;
    }

    // Profile 모드일 때는 프로필이 선택되어 있어야 함
    if (extensionSettings.source === 'profile' && !extensionSettings.profileId) {
        toastr.warning('TMI Generator: Connection Profile을 선택해주세요.');
        return;
    }

    const message = globalContext.chat[messageId];
    if (!message) return;

    // 응답을 기다리는 동안 메시지가 삭제되면 인덱스가 밀리므로,
    // 메시지 객체 자체와 스와이프 번호를 기준점으로 잡아둡니다.
    const swipeAtStart = message.swipe_id ?? 0;

    // 같은 메시지/스와이프에 대한 중복 호출 방지
    const pendingKey = getPendingKey(messageId);
    if (!pendingKey) return;

    if (pendingRequests.has(pendingKey)) {
        console.log(`[${EXTENSION_NAME}] TMI 생성 중복 호출 방지: ${pendingKey}`);
        return;
    }

    pendingRequests.add(pendingKey);

    const messageElement = $(`[mesid="${messageId}"] .mes_text`);
    // 로딩 박스는 참조를 들고 있다가 어떤 경로로 끝나든 확실히 걷어냅니다
    const loadingElement = createLoadingHTML();
    messageElement.append(loadingElement);

    try {
        const avoidItems = collectAvoidItems(messageId, options.avoid ?? []);
        if (avoidItems.length > 0) {
            console.log(`[${EXTENSION_NAME}] 중복 회피: 기존 TMI ${avoidItems.length}개를 제외 목록으로 전달`);
        }

        const fullPrompt = buildFullPrompt(avoidItems);
        let result = '';

        if (extensionSettings.source === 'main') {
            // Main API 사용 - generateRaw로 깔끔하게 (로어북 포함)
            const contextText = await buildContextText(messageId);

            console.log(`[${EXTENSION_NAME}] Main API (generateRaw) 요청 (컨텍스트 길이: ${contextText.length}자)`);
            console.log(`[${EXTENSION_NAME}] 📋 Main API 컨텍스트 미리보기:`, contextText.substring(0, 500) + '...');

            if (contextText.includes('WORLD INFO') || contextText.includes('LOREBOOK')) {
                console.log(`[${EXTENSION_NAME}] ✅ 컨텍스트에 로어북 섹션 포함됨`);
            } else {
                console.warn(`[${EXTENSION_NAME}] ⚠️ 컨텍스트에 로어북 섹션이 없음!`);
            }

            const { generateRaw } = globalContext;
            if (!generateRaw) {
                throw new Error('generateRaw is not available');
            }

            result = await generateRaw({
                systemPrompt: contextText,  // 페르소나, 캐릭터, 대화 컨텍스트
                prompt: fullPrompt,          // TMI 생성 프롬프트
                streaming: false
            });

            console.log(`[${EXTENSION_NAME}] Main API 응답 (길이: ${result?.length || 0}자):`, result?.substring(0, 200));
        } else {
            // Connection Profile 사용 (로어북 포함)
            const contextMessages = await buildContextMessages(messageId);
            contextMessages.push({
                role: 'user',
                content: fullPrompt,
            });

            console.log(`[${EXTENSION_NAME}] Connection Profile 요청:`, {
                profileId: extensionSettings.profileId,
                messages: contextMessages.length,
                maxTokens: extensionSettings.maxTokens,
                lastMessage: contextMessages[contextMessages.length - 1]?.content?.substring(0, 100)
            });

            // 디버깅: system 메시지 확인
            const systemMsg = contextMessages.find(m => m.role === 'system');
            if (systemMsg) {
                console.log(`[${EXTENSION_NAME}] 📋 Connection Profile System 메시지 (${systemMsg.content.length}자):`,
                    systemMsg.content.substring(0, 500) + '...');
                if (systemMsg.content.includes('WORLD INFO') || systemMsg.content.includes('LOREBOOK')) {
                    console.log(`[${EXTENSION_NAME}] ✅ System 메시지에 로어북 섹션 포함됨`);
                } else {
                    console.warn(`[${EXTENSION_NAME}] ⚠️ System 메시지에 로어북 섹션이 없음!`);
                }
            } else {
                console.warn(`[${EXTENSION_NAME}] ⚠️ System 메시지가 없음!`);
            }

            // Connection Profile 서비스 체크
            if (!globalContext.ConnectionManagerRequestService) {
                throw new Error('Connection Manager가 로드되지 않았습니다. SillyTavern을 재시작해주세요.');
            }

            if (!extensionSettings.profileId) {
                throw new Error('Connection Profile이 선택되지 않았습니다. 설정에서 프로필을 선택해주세요.');
            }

            const response = await globalContext.ConnectionManagerRequestService.sendRequest(
                extensionSettings.profileId,
                contextMessages,
                extensionSettings.maxTokens,
                {
                    stream: false,
                    extractData: true,
                    includePreset: false,  // 프리셋 제외 ✅
                    includeInstruct: false // instruct 제외 ✅
                }
            ).catch(err => {
                console.error(`[${EXTENSION_NAME}] Connection Profile API 오류:`, err);
                throw new Error(`Connection Profile 연결 실패: ${err.message || '알 수 없는 오류'}. 프로필 설정을 확인해주세요.`);
            });

            console.log(`[${EXTENSION_NAME}] Connection Profile 응답:`, {
                response_type: typeof response,
                has_content: !!response?.content,
                content_length: response?.content?.length || 0,
                response_keys: response ? Object.keys(response) : [],
                full_response: response
            });

            // 여러 형식 지원
            if (typeof response === 'string') {
                result = response;
            } else if (response?.choices?.[0]?.message) {
                const msg = response.choices[0].message;
                result = msg.reasoning_content || msg.content || '';
            } else {
                result = response?.content || response?.message || '';
            }

            if (!result) {
                console.error(`[${EXTENSION_NAME}] Connection Profile 응답이 비어있습니다!`, response);
            }
        }

        console.log(`[${EXTENSION_NAME}] 파싱 전 result:`, { length: result?.length || 0, preview: result?.substring(0, 200) });
        const tmiItems = parseTMIResponse(result);

        // 기다리는 사이에 대상이 바뀌었는지 확인
        const currentId = resolveMessageId(message, swipeAtStart);
        if (currentId === null) {
            console.warn(`[${EXTENSION_NAME}] 생성 중 대상 메시지가 삭제되거나 스와이프가 바뀌어 결과를 버립니다.`);
            return;
        }
        if (currentId !== messageId) {
            console.log(`[${EXTENSION_NAME}] 메시지 인덱스가 ${messageId} → ${currentId}로 밀렸습니다.`);
        }

        if (tmiItems && tmiItems.length > 0) {
            // 메시지 자체에 저장 (스와이프별 분리는 ST가 처리)
            const tmi = makeTMI(tmiItems, {
                preset: getCurrentPresetLabel(),
                visible: extensionSettings.autoOpen,
            });
            writeTMI(currentId, tmi);
            renderTMI(currentId, tmi);
        } else {
            throw new Error('TMI 응답을 파싱할 수 없습니다.');
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 오류:`, error);

        // 상세 에러 메시지 구성
        let detailedError = error.message || '알 수 없는 오류';

        // API 소스 정보 추가
        const source = extensionSettings.source === 'main' ? 'Main API' : 'Connection Profile';
        detailedError = `[${source}] ${detailedError}`;

        // 스택 트레이스가 있으면 추가 (개발용)
        if (error.stack) {
            const stackPreview = error.stack.split('\n').slice(0, 5).join('\n');
            detailedError += `\n\n--- Stack ---\n${stackPreview}`;
        }

        // 에러 박스도 (밀렸을 수 있는) 현재 위치에 붙임
        const currentId = resolveMessageId(message, swipeAtStart);
        if (currentId !== null) {
            $(`[mesid="${currentId}"] .mes_text`).append(createErrorHTML(detailedError, currentId));
        }
        toastr.error(`TMI 생성 실패: ${error.message}`);
    } finally {
        loadingElement.remove();
        pendingRequests.delete(pendingKey);
    }
}

/**
 * 생성을 시작할 때 잡아둔 메시지가 지금 어느 위치에 있는지 되짚습니다.
 * 삭제됐거나 다른 스와이프로 넘어갔으면 null (= 결과를 버려야 함).
 * @param {object} message 생성 시작 시점의 메시지 객체
 * @param {number} swipeAtStart 생성 시작 시점의 스와이프 번호
 * @returns {number|null}
 */
function resolveMessageId(message, swipeAtStart) {
    const index = globalContext.chat?.indexOf(message) ?? -1;
    if (index === -1) return null;
    if ((message.swipe_id ?? 0) !== swipeAtStart) return null;
    return index;
}

function getPersonaInfo() {
    try {
        console.log(`[${EXTENSION_NAME}] 페르소나 정보 수집:`, {
            user_avatar: user_avatar,
            has_power_user: !!power_user,
            has_personas: !!power_user?.personas,
            power_user_keys: power_user ? Object.keys(power_user).slice(0, 10) : []
        });

        if (!user_avatar || !power_user) {
            console.log(`[${EXTENSION_NAME}] 페르소나 정보 없음`);
            return '';
        }

        let info = '';

        // 페르소나 이름
        const personaName = power_user.personas?.[user_avatar] || power_user.name || 'User';
        info += `User/Persona: ${personaName}\n`;

        // 페르소나 설명
        const personaDesc = power_user.persona_descriptions?.[user_avatar];
        if (personaDesc?.description) {
            info += `\nPersona Description:\n${personaDesc.description}\n`;
        } else if (power_user.persona_description) {
            // 폴백: 전역 persona_description
            info += `\nPersona Description:\n${power_user.persona_description}\n`;
        }

        console.log(`[${EXTENSION_NAME}] 페르소나 정보 (${info.length}자):`, info.substring(0, 100));
        return info.trim();
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 페르소나 정보 가져오기 실패:`, error);
        return '';
    }
}

function getCharacterInfo() {
    try {
        // 실행 시점의 최신 context 가져오기
        const context = SillyTavern.getContext();

        const thisChid = context.characterId;
        const characters = context.characters;

        console.log(`[${EXTENSION_NAME}] 캐릭터 정보 수집:`, {
            this_chid: thisChid,
            has_characters: !!characters,
            has_character: !!(characters && characters[thisChid]),
            character_name: characters?.[thisChid]?.name
        });

        if (thisChid === undefined || !characters || !characters[thisChid]) {
            console.log(`[${EXTENSION_NAME}] 캐릭터 정보 없음`);
            return '';
        }

        const character = characters[thisChid];

        let info = '';

        // 캐릭터 이름
        if (character.name) {
            info += `Character: ${character.name}\n`;
        }

        // V2 형식 (character.data)
        const charData = character.data || character;

        // 캐릭터 설명
        if (charData.description) {
            info += `\nDescription:\n${charData.description}\n`;
        }

        // 성격
        if (charData.personality) {
            info += `\nPersonality:\n${charData.personality}\n`;
        }

        // 시나리오
        if (charData.scenario) {
            info += `\nScenario:\n${charData.scenario}\n`;
        }

        // Creator Notes (있으면)
        if (charData.creator_notes) {
            info += `\nCreator Notes:\n${charData.creator_notes}\n`;
        }

        // System Prompt (있으면)
        if (charData.system_prompt) {
            info += `\nSystem Prompt:\n${charData.system_prompt}\n`;
        }

        // 캐릭터 북 (Lorebook/World Info) - 전체 포함
        if (charData.character_book?.entries) {
            const entries = Object.values(charData.character_book.entries);
            if (entries.length > 0) {
                info += `\n\nCharacter Lore (${entries.length} entries):\n`;
                entries.forEach(entry => {
                    if (entry.content) {
                        info += `- ${entry.content}\n`;
                    }
                });
            }
        }

        console.log(`[${EXTENSION_NAME}] 캐릭터 정보 (${info.length}자):`, info.substring(0, 150));
        return info.trim();
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 캐릭터 정보 가져오기 실패:`, error);
        return '';
    }
}

async function buildContextMessages(upToMessageId) {
    const messages = [];

    // 페르소나 정보 추가
    const personaInfo = getPersonaInfo();

    // 캐릭터 정보 추가
    const charInfo = getCharacterInfo();

    // 로어북 정보 추가
    let worldInfoText = '';
    // chat이 비어있지 않은 경우에만 로어북 시도
    if (globalContext.chat && globalContext.chat.length > 0) {
        try {
            console.log(`[${EXTENSION_NAME}] Connection Profile: 로어북 가져오기 시도...`);

            // chat을 문자열 배열로 변환
            const chatText = globalContext.chat.map(msg => msg?.mes || '').filter(text => text);

            // chatText가 비어있으면 건너뛰기
            if (chatText.length === 0) {
                console.log(`[${EXTENSION_NAME}] ⚠️ Connection Profile: chat 메시지가 없어 로어북 스캔 건너뜀`);
            } else {
                const worldInfoResult = await getWorldInfoPrompt(
                    chatText,  // 문자열 배열 전달
                    8000,      // maxContext
                    true,      // isDryRun
                    undefined  // globalScanData → undefined면 기본값 적용됨
                );

                console.log(`[${EXTENSION_NAME}] Connection Profile: 로어북 결과:`, {
                    has_result: !!worldInfoResult,
                    has_string: !!worldInfoResult?.worldInfoString,
                    string_length: worldInfoResult?.worldInfoString?.length || 0,
                    result_keys: worldInfoResult ? Object.keys(worldInfoResult) : []
                });

                if (worldInfoResult?.worldInfoString) {
                    worldInfoText = worldInfoResult.worldInfoString.trim();
                    if (worldInfoText) {
                        console.log(`[${EXTENSION_NAME}] ✅ Connection Profile: 로어북 포함됨 (${worldInfoText.length}자)`);
                    } else {
                        console.log(`[${EXTENSION_NAME}] ⚠️ Connection Profile: worldInfoString이 비어있음`);
                    }
                } else {
                    console.log(`[${EXTENSION_NAME}] ⚠️ Connection Profile: worldInfoString 없음`);
                }
            }
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] ❌ Connection Profile: 로어북 가져오기 실패 (무시하고 계속):`, error);
        }
    } else {
        console.log(`[${EXTENSION_NAME}] ⚠️ Connection Profile: chat이 비어있어 로어북 건너뜀`);
    }

    // 시스템 컨텍스트 구성
    console.log(`[${EXTENSION_NAME}] 🔍 Connection Profile 컨텍스트 구성:`, {
        has_persona: !!personaInfo,
        persona_length: personaInfo?.length || 0,
        has_char: !!charInfo,
        char_length: charInfo?.length || 0,
        has_world: !!worldInfoText,
        world_length: worldInfoText?.length || 0
    });

    if (personaInfo || charInfo || worldInfoText) {
        let systemContent = '';
        if (personaInfo) {
            systemContent += personaInfo;
        }
        if (charInfo) {
            if (systemContent) systemContent += '\n\n';
            systemContent += charInfo;
        }
        if (worldInfoText) {
            if (systemContent) systemContent += '\n\n=== WORLD INFO / LOREBOOKS ===\n';
            systemContent += worldInfoText;
            console.log(`[${EXTENSION_NAME}] ✅ 로어북이 systemContent에 추가됨`);
        } else {
            console.log(`[${EXTENSION_NAME}] ⚠️ worldInfoText가 비어있음, 로어북 추가 안 됨`);
        }

        console.log(`[${EXTENSION_NAME}] 📋 최종 systemContent 길이: ${systemContent.length}자`);
        console.log(`[${EXTENSION_NAME}] 📋 systemContent 미리보기:`, systemContent.substring(0, 300) + '...');

        messages.push({
            role: 'system',
            content: systemContent,
        });

        console.log(`[${EXTENSION_NAME}] ✅ System 메시지 추가됨, 전체 messages 개수: ${messages.length}`);
    } else {
        console.log(`[${EXTENSION_NAME}] ⚠️ 페르소나/캐릭터/로어북 모두 비어있어 System 메시지 추가 안 됨`);
    }

    // 최근 대화 내역 추가
    const maxMessages = extensionSettings.contextMessages || 20;
    const startIdx = Math.max(0, upToMessageId - maxMessages + 1);

    for (let i = startIdx; i <= upToMessageId; i++) {
        const msg = globalContext.chat[i];
        if (!msg) continue;

        const role = msg.is_user ? 'user' : 'assistant';
        const content = msg.extra?.display_text ?? msg.mes;
        messages.push({ role, content });
    }

    return messages;
}

async function buildContextText(upToMessageId) {
    let text = '';

    // 페르소나 정보 추가
    const personaInfo = getPersonaInfo();
    if (personaInfo) {
        text += '=== USER/PERSONA INFORMATION ===\n' + personaInfo + '\n\n';
    }

    // 캐릭터 정보 추가
    const charInfo = getCharacterInfo();
    if (charInfo) {
        text += '=== CHARACTER INFORMATION ===\n' + charInfo + '\n\n';
    }

    // 로어북 정보 추가 (활성화된 항목만)
    // chat이 비어있지 않은 경우에만 로어북 시도
    if (globalContext.chat && globalContext.chat.length > 0) {
        try {
            console.log(`[${EXTENSION_NAME}] Main API: 로어북 가져오기 시도...`);

            // chat을 문자열 배열로 변환
            const chatText = globalContext.chat.map(msg => msg?.mes || '').filter(text => text);

            // chatText가 비어있으면 건너뛰기
            if (chatText.length === 0) {
                console.log(`[${EXTENSION_NAME}] ⚠️ Main API: chat 메시지가 없어 로어북 스캔 건너뜀`);
            } else {
                const worldInfoResult = await getWorldInfoPrompt(
                    chatText,  // 문자열 배열 전달
                    8000,      // maxContext (충분히 큰 값)
                    true,      // isDryRun (실제 스캔하지만 카운터 업데이트 안 함)
                    undefined  // globalScanData → undefined면 기본값 적용됨
                );

                console.log(`[${EXTENSION_NAME}] Main API: 로어북 결과:`, {
                    has_result: !!worldInfoResult,
                    has_string: !!worldInfoResult?.worldInfoString,
                    string_length: worldInfoResult?.worldInfoString?.length || 0
                });

                if (worldInfoResult?.worldInfoString) {
                    const wiText = worldInfoResult.worldInfoString.trim();
                    if (wiText) {
                        text += '=== WORLD INFO / LOREBOOKS ===\n' + wiText + '\n\n';
                        console.log(`[${EXTENSION_NAME}] ✅ Main API: 로어북 포함됨 (${wiText.length}자)`);
                    } else {
                        console.log(`[${EXTENSION_NAME}] ⚠️ Main API: worldInfoString이 비어있음`);
                    }
                } else {
                    console.log(`[${EXTENSION_NAME}] ⚠️ Main API: worldInfoString 없음`);
                }
            }
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] ❌ Main API: 로어북 가져오기 실패 (무시하고 계속):`, error);
        }
    } else {
        console.log(`[${EXTENSION_NAME}] ⚠️ Main API: chat이 비어있어 로어북 건너뜀`);
    }

    // 최근 대화 내역 추가
    text += '=== RECENT CONVERSATION ===\n';
    const maxMessages = extensionSettings.contextMessages || 20;
    const startIdx = Math.max(0, upToMessageId - maxMessages + 1);

    for (let i = startIdx; i <= upToMessageId; i++) {
        const msg = globalContext.chat[i];
        if (!msg) continue;

        const name = msg.is_user ? (msg.name || 'User') : (msg.name || 'Character');
        const content = msg.extra?.display_text ?? msg.mes;
        text += `${name}: ${content}\n\n`;
    }

    return text.trim();
}

/**
 * fallback 파싱에서 허용할 항목 최대 길이.
 * 길이 설정('길게' = 7줄 이상)과 어긋나지 않도록 설정값에서 유도합니다.
 */
function getMaxItemLength() {
    switch (extensionSettings.tmiLength) {
        case 'short': return 500;
        case 'long': return 6000;
        default: return 1500;
    }
}

function parseTMIResponse(content) {
    console.log(`[${EXTENSION_NAME}] parseTMIResponse 입력:`, content.substring(0, 200));

    // 1. <tmi>...</tmi> 태그 안의 내용 추출 (메인 파싱 방법)
    const tmiRegex = /<tmi>\s*([\s\S]*?)\s*<\/tmi>/i;
    const tmiMatch = content.match(tmiRegex);

    if (tmiMatch) {
        const tmiContent = tmiMatch[1];
        console.log(`[${EXTENSION_NAME}] <tmi> 태그 내용 추출 성공, 길이: ${tmiContent.length}`);

        // 리스트 항목 추출 (-, *, •, 숫자. 등)
        // 불릿으로 시작하지 않는 줄은 직전 항목의 이어지는 줄로 합칩니다.
        // (SNS 타임라인·뉴스처럼 한 항목이 여러 줄인 프리셋을 살리기 위함)
        const lines = tmiContent.split('\n');
        console.log(`[${EXTENSION_NAME}] 줄 분리: ${lines.length}개 줄`);

        const collected = [];
        let current = null;

        for (const rawLine of lines) {
            const line = rawLine.trim();

            // 구분선(---, ***)은 버림
            if (/^([-*_]\s*){3,}$/.test(line)) continue;

            // 숫자 불릿은 1~2자리만 인정합니다. \d+ 로 두면 "2024. 11. 3." 같은
            // 날짜 줄이 새 항목으로 오인돼 항목이 쪼개지고 연도가 잘려나갑니다.
            const isBullet = /^[-*•]\s+/.test(line) || /^\d{1,2}\.\s+/.test(line);

            if (isBullet) {
                if (current) collected.push(current);
                current = line.replace(/^[-*•]\s*/, '').replace(/^\d{1,2}\.\s*/, '').trim();
            } else if (current !== null) {
                if (line.length > 0) current += '\n' + line;
            } else if (line.length > 0) {
                // 첫 불릿보다 앞에 나온 잡설
                console.log(`[${EXTENSION_NAME}] 필터링됨 (첫 항목 이전 텍스트): "${line.substring(0, 50)}..."`);
            }
        }
        if (current) collected.push(current);

        const items = collected.filter(item => {
            const isValid = item.length > 5;
            if (!isValid) {
                console.log(`[${EXTENSION_NAME}] 필터링됨 (너무 짧음): "${item}"`);
            }
            return isValid;
        });

        console.log(`[${EXTENSION_NAME}] 최종 파싱된 항목: ${items.length}개`);
        if (items.length > 0) {
            console.log(`[${EXTENSION_NAME}] Parsed ${items.length} TMI items from <tmi> tags`);
            return items.slice(0, extensionSettings.tmiCount || 10);
        } else {
            console.warn(`[${EXTENSION_NAME}] <tmi> 태그는 있지만 유효한 항목 없음`);
        }
    } else {
        console.warn(`[${EXTENSION_NAME}] <tmi> 태그를 찾을 수 없음`);
    }

    // 2. Fallback: 태그 없이 리스트만 있는 경우
    const listItems = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^[-*•]\s+/.test(line) || /^\d{1,2}\.\s+/.test(line))
        .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d{1,2}\.\s*/, '').trim())
        .filter(line => {
            // 유효성 검사
            if (line.length < 10 || line.length > getMaxItemLength()) return false;
            // 메타 텍스트 제외
            if (line.includes('<tmi>') || line.includes('</tmi>')) return false;
            if (line.toLowerCase().includes('format') || line.toLowerCase().includes('example')) return false;
            return true;
        });

    if (listItems.length >= 3) {
        console.log(`[${EXTENSION_NAME}] Fallback: parsed ${listItems.length} list items`);
        return listItems.slice(0, extensionSettings.tmiCount || 10);
    }

    // 3. 최후의 수단: 문장 단위 분할
    const sentences = content
        .replace(/<tmi>|<\/tmi>/gi, '')
        .split(/[.!?]\s+/)
        .map(s => s.trim())
        .filter(s => {
            if (s.length < 20 || s.length > getMaxItemLength()) return false;
            if (s.toLowerCase().includes('format') || s.toLowerCase().includes('example')) return false;
            if (s.includes('```') || s.startsWith('[')) return false;
            return true;
        });

    if (sentences.length >= 3) {
        console.log(`[${EXTENSION_NAME}] Last resort: extracted ${sentences.length} sentences`);
        return sentences.slice(0, extensionSettings.tmiCount || 10);
    }

    console.error(`[${EXTENSION_NAME}] Could not parse TMI response. Expected <tmi>...</tmi> format.`);
    console.error(`[${EXTENSION_NAME}] Received:`, content.substring(0, 300));
    return null;
}

function renderTMI(messageId, tmi) {
    if (!tmi) return;

    const messageElement = $(`[mesid="${messageId}"] .mes_text`);
    messageElement.find('.tmi-container').remove();
    messageElement.append(createTMIHTML(messageId, tmi));
    attachTMIEventHandlers(messageId);
}

function createTMIHTML(messageId, tmi) {
    const visible = !!tmi.visible;
    const container = $('<div class="tmi-container"></div>').attr('data-tmi-message-id', messageId);
    const header = $('<div class="tmi-header"></div>');
    const title = $('<span class="tmi-title"></span>');

    title.append('📝 TMI ');
    title.append(`<span class="tmi-toggle-icon ${visible ? 'expanded' : ''}">▼</span>`);

    const controls = $('<div class="tmi-controls"></div>');
    controls.append('<button class="tmi-regenerate" title="TMI 재생성">🔄</button>');
    controls.append('<button class="tmi-delete" title="TMI 삭제">❌</button>');

    header.append(title).append(controls);
    container.append(header);

    const content = $('<div class="tmi-content"></div>');
    if (!visible) content.addClass('collapsed');

    tmi.sets.forEach((set, setIndex) => {
        (set.items ?? []).forEach((_, itemIndex) => {
            content.append(createItemElement(messageId, set, setIndex, itemIndex));
        });
    });

    container.append(content);

    return container;
}

/**
 * TMI 항목 하나를 그립니다. 사용자 HTML 템플릿의 결과물에 핀 버튼만 얹으므로
 * 기존 Custom CSS(.tmi-item 등)는 그대로 적용됩니다.
 */
function createItemElement(messageId, set, setIndex, itemIndex) {
    const html = renderHTMLTemplate(extensionSettings.htmlTemplate, getItemText(set, itemIndex), messageId);

    // $(html)은 '<'로 시작하지 않는 문자열을 셀렉터로 해석해 예외를 던지므로 parseHTML을 씁니다
    let element = $($.parseHTML(html) ?? []);
    // 템플릿이 여러 노드거나 텍스트만 반환하면 기본 래퍼로 감쌈
    if (element.length !== 1 || element[0]?.nodeType !== 1) {
        element = $('<div class="tmi-item"></div>').html(html);
    }

    element
        .attr('data-tmi-set', setIndex)
        .attr('data-tmi-item', itemIndex)
        .addClass('tmi-pinnable')
        .toggleClass('tmi-is-pinned', isPinned(set, itemIndex))
        .append('<button class="tmi-pin fa-solid fa-thumbtack" title="핀 - 프롬프트에 계속 주입"></button>');

    return element;
}

function renderHTMLTemplate(template, text, messageId) {
    if (!template) template = DEFAULT_HTML_TEMPLATE;

    // ST의 실제 메시지와 같은 렌더러를 써서 마크다운(굵게/기울임/코드 등)이
    // 그대로 보이게 합니다 (showdown 변환 + 정규식 스크립트 + DOMPurify까지 동일 경로).
    // messageId는 이 TMI가 붙은 실제 메시지 번호라, 그 메시지 기준으로 정규식
    // 스크립트의 depth가 계산됩니다 — 캐릭터 답장에 적용되는 규칙과 동일하게 맞습니다.
    const html = renderMarkdown(text, messageId);

    return template.replace(/\{\{this\}\}/g, html);
}

/**
 * TMI 항목 텍스트를 ST 표준 마크다운 렌더러로 변환합니다.
 * messageFormatting을 쓸 수 없는 예전 ST 버전이거나 렌더링 중 오류가 나면
 * 기존의 단순 이스케이프+줄바꿈 방식으로 안전하게 되돌아갑니다.
 */
function renderMarkdown(text, messageId) {
    const raw = String(text ?? '');

    if (typeof globalContext.messageFormatting === 'function') {
        try {
            const chName = globalContext.chat?.[messageId]?.name || '';
            return globalContext.messageFormatting(raw, chName, false, false, messageId);
        } catch (error) {
            console.warn(`[${EXTENSION_NAME}] messageFormatting 실패, 기본 렌더링으로 대체:`, error);
        }
    }

    return escapeHtml(raw).replace(/\r?\n/g, '<br>');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createLoadingHTML() {
    return $('<div class="tmi-container"><div class="tmi-loading">TMI 생성 중...</div></div>');
}

function createErrorHTML(errorMessage, messageId) {
    const container = $('<div class="tmi-container"></div>');
    const errorDiv = $('<div class="tmi-error" style="flex-direction: column; align-items: flex-start;"></div>');

    // 에러 헤더
    const errorHeader = $('<div style="display: flex; align-items: center; gap: 10px; width: 100%;"></div>');
    errorHeader.append($('<span style="font-weight: bold;">❌ TMI 생성 실패</span>'));

    const retryButton = $('<button class="tmi-error-retry" title="재생성">🔄 재시도</button>');
    retryButton.on('click', async function() {
        $(this).prop('disabled', true).text('생성 중...');
        container.remove();

        deleteTMI(messageId);
        await generateTMI(messageId);
    });
    errorHeader.append(retryButton);
    errorDiv.append(errorHeader);

    // 에러 상세 메시지 (접을 수 있음)
    const errorDetails = $(`
        <details style="margin-top: 8px; width: 100%;">
            <summary style="cursor: pointer; color: var(--SmartThemeQuoteColor); font-size: 0.9em;">
                📋 상세 정보 보기
            </summary>
            <pre style="
                margin-top: 6px;
                padding: 8px;
                background: rgba(0, 0, 0, 0.3);
                color: var(--SmartThemeBodyColor);
                border: 1px solid var(--SmartThemeBorderColor);
                border-radius: 4px;
                font-size: 0.85em;
                white-space: pre-wrap;
                word-break: break-all;
                max-height: 150px;
                overflow-y: auto;
            ">${escapeHtml(errorMessage)}</pre>
        </details>
    `);
    errorDiv.append(errorDetails);

    container.append(errorDiv);
    return container;
}

function attachTMIEventHandlers(messageId) {
    const container = $(`[mesid="${messageId}"] .tmi-container`);

    container.find('.tmi-header').off('click').on('click', function(e) {
        if ($(e.target).closest('.tmi-regenerate, .tmi-delete').length > 0) return;

        const content = container.find('.tmi-content');
        const toggleIcon = container.find('.tmi-toggle-icon');
        const isCollapsed = content.hasClass('collapsed');

        content.toggleClass('collapsed');
        toggleIcon.toggleClass('expanded');

        // 펼침 상태를 메시지에 저장
        const tmi = readTMI(messageId);
        if (tmi) {
            tmi.visible = isCollapsed;
            writeTMI(messageId, tmi);
        }
    });

    container.find('.tmi-pin').off('click').on('click', function(e) {
        e.stopPropagation();

        const item = $(this).closest('[data-tmi-set]');
        const setIndex = Number(item.attr('data-tmi-set'));
        const itemIndex = Number(item.attr('data-tmi-item'));
        if (isNaN(setIndex) || isNaN(itemIndex)) return;

        const pinned = togglePin(messageId, setIndex, itemIndex);
        toastr.success(pinned ? '핀 - 이 항목이 프롬프트에 주입됩니다' : '핀 해제됨');
    });

    container.find('.tmi-regenerate').off('click').on('click', async function(e) {
        e.stopPropagation();
        const button = $(this);
        button.prop('disabled', true);

        // 지우기 전에 기존 항목을 챙겨서 "이건 빼고 다시" 라고 알려줌
        const previousItems = collectItemTexts(readTMI(messageId));

        deleteTMI(messageId);
        await generateTMI(messageId, { avoid: previousItems });
        button.prop('disabled', false);
    });

    container.find('.tmi-delete').off('click').on('click', async function(e) {
        e.stopPropagation();

        const confirmed = await globalContext.Popup.show.confirm(
            '이 TMI를 삭제하시겠습니까?',
            'TMI 삭제'
        );
        if (!confirmed) return;

        deleteTMI(messageId);

        // DOM에서 제거
        container.remove();

        // 자동 생성이 꺼져 있으면 생성 버튼 표시
        if (!extensionSettings.autoGenerate) {
            showGenerateButton(messageId);
        }

        toastr.success('TMI가 삭제되었습니다');
    });
}

// ─────────────────────────────────────────────────────────────
// TMI 관리 패널 (확장 메뉴)
// ─────────────────────────────────────────────────────────────

/**
 * 확장 메뉴(🪄)에 "TMI 관리" 항목을 추가합니다.
 * 메뉴는 ST가 런타임에 만들기 때문에, 아직 없으면 잠시 기다렸다 다시 시도합니다.
 */
async function addManagerMenuButton(retries = 40) {
    let menu = $('#extensionsMenu');

    while (menu.length === 0 && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 250));
        menu = $('#extensionsMenu');
        retries--;
    }

    if (menu.length === 0) {
        console.warn(`[${EXTENSION_NAME}] 확장 메뉴를 찾지 못해 "TMI 관리" 버튼을 추가하지 못했습니다.`);
        return;
    }

    if (menu.find('#tmi_manager_button').length > 0) return;

    const button = $(`
        <div id="tmi_manager_button" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="핀한 TMI를 보고 관리합니다">
            <div class="fa-fw fa-solid fa-thumbtack extensionsMenuExtensionButton"></div>
            <span>TMI 관리</span>
        </div>
    `);

    button.on('click', () => openManagerPanel());
    menu.append(button);
}

async function openManagerPanel() {
    if (!getCurrentChatId()) {
        toastr.warning('채팅을 먼저 열어주세요.');
        return;
    }

    const root = $(`
        <div class="tmi-manager">
            <div class="tmi-manager-preset">
                <label>프롬프트 프리셋</label>
                <select class="text_pole tmi-manager-preset-select"></select>
            </div>
            <div class="tmi-manager-status"></div>
            <div class="tmi-manager-tabs">
                <div class="menu_button interactable tmi-manager-tab" data-tab="pinned">📌 핀 목록</div>
                <div class="menu_button interactable tmi-manager-tab" data-tab="all">📝 이 채팅의 전체 TMI</div>
            </div>
            <div class="tmi-manager-list"></div>
            <details class="tmi-manager-preview">
                <summary>실제 주입될 텍스트 미리보기</summary>
                <pre></pre>
            </details>
            <div class="tmi-manager-footer">
                <div class="menu_button interactable tmi-manager-unpin-all">전체 핀 해제</div>
            </div>
        </div>
    `);

    let activeTab = 'pinned';

    const popup = new globalContext.Popup(root[0], globalContext.POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: '닫기',
    });

    // 팝업 자체에도 표식을 남겨 하단 버튼 스타일을 잡습니다
    popup.dlg?.classList.add('tmi-manager-popup');

    // 프리셋 전환기 (설정 패널까지 안 가도 여기서 바로 바꿉니다)
    const presetSelect = root.find('.tmi-manager-preset-select');
    fillPromptPresetOptions(presetSelect);

    presetSelect.on('change', function() {
        const key = String($(this).val());
        if (!key) return; // "직접 편집"은 되돌릴 내용이 없으므로 무시

        if (!applyPromptPreset(key)) return;
        toastr.success(`프롬프트 "${parsePresetKey(key).name}" 적용됨`);
        refresh();
    });

    async function refresh() {
        const { count, text } = updateInjection();

        // 설정 패널이나 박스 헤더에서 바꿨을 수도 있으니 매번 맞춰줍니다
        presetSelect.val(extensionSettings.selectedPromptPreset || '');

        // 상태 바
        const status = root.find('.tmi-manager-status');
        let tokens = 0;
        try {
            if (text) tokens = await globalContext.getTokenCountAsync(text);
        } catch (error) {
            console.warn(`[${EXTENSION_NAME}] 토큰 수 계산 실패:`, error);
        }
        const positionLabel = describeInjectPosition();
        status.empty().append(`
            <label class="checkbox_label">
                <input type="checkbox" class="tmi-manager-inject-toggle" ${extensionSettings.injectEnabled ? 'checked' : ''} />
                <span><strong>핀 주입 활성화</strong></span>
            </label>
            <div class="tmi-manager-status-meta">
                핀 ${count}개 · 약 ${tokens} 토큰 · ${escapeHtml(positionLabel)}
            </div>
        `);

        status.find('.tmi-manager-inject-toggle').on('change', function() {
            extensionSettings.injectEnabled = $(this).prop('checked');
            saveSettings();
            $('.tmi_settings .inject_enabled').prop('checked', extensionSettings.injectEnabled);
            refresh();
        });

        // 미리보기
        root.find('.tmi-manager-preview pre').text(text || '(주입 없음)');

        // 탭 상태
        root.find('.tmi-manager-tab').each(function() {
            $(this).toggleClass('selected', $(this).data('tab') === activeTab);
        });

        // 목록
        renderManagerList(root.find('.tmi-manager-list'), activeTab, refresh, popup);
    }

    root.find('.tmi-manager-tab').on('click', function() {
        activeTab = String($(this).data('tab'));
        refresh();
    });

    root.find('.tmi-manager-unpin-all').on('click', async function() {
        const confirmed = await globalContext.Popup.show.confirm(
            '이 채팅의 모든 핀을 해제하시겠습니까?',
            '전체 핀 해제'
        );
        if (!confirmed) return;

        const count = unpinAll();
        toastr.success(`핀 ${count}개가 해제되었습니다.`);
        refresh();
    });

    await refresh();
    await popup.show();
}

function describeInjectPosition() {
    const depth = extensionSettings.injectDepth ?? 4;
    const roleLabel = ['system', 'user', 'assistant'][extensionSettings.injectRole ?? 0] ?? 'system';

    switch (Number(extensionSettings.injectPosition)) {
        case INJECT_POSITION.BEFORE_PROMPT: return '메인 프롬프트 바로 앞';
        case INJECT_POSITION.IN_PROMPT: return '메인 프롬프트 바로 뒤';
        default: return `채팅 내 @Depth ${depth} (${roleLabel})`;
    }
}

/** 관리 패널의 목록 영역을 그립니다. */
function renderManagerList(listElement, tab, refresh, popup) {
    listElement.empty();

    const rows = [];

    (globalContext.chat ?? []).forEach((message, messageId) => {
        const tmi = readTMI(messageId);
        if (!tmi) return;

        tmi.sets.forEach((set, setIndex) => {
            (set.items ?? []).forEach((_, itemIndex) => {
                const pinned = isPinned(set, itemIndex);
                if (tab === 'pinned' && !pinned) return;

                rows.push({
                    messageId, setIndex, itemIndex, pinned,
                    text: getItemText(set, itemIndex),
                    edited: typeof set.edits?.[itemIndex] === 'string' && !!set.edits[itemIndex].trim(),
                    preset: set.preset ?? '',
                });
            });
        });
    });

    if (rows.length === 0) {
        listElement.append(`<div class="tmi-manager-empty">${
            tab === 'pinned'
                ? '핀한 항목이 없습니다. TMI 항목에 마우스를 올리면 나오는 📌 를 누르세요.'
                : '이 채팅에는 아직 생성된 TMI가 없습니다.'
        }</div>`);
        return;
    }

    rows.forEach(row => {
        const item = $('<div class="tmi-manager-row"></div>').toggleClass('pinned', row.pinned);

        const meta = row.preset ? `#${row.messageId} · ${escapeHtml(row.preset)}` : `#${row.messageId}`;
        item.append(`
            <div class="tmi-manager-row-main">
                <div class="tmi-manager-row-meta">${meta}${row.edited ? ' · 편집됨' : ''}</div>
                <div class="tmi-manager-row-text">${escapeHtml(row.text)}</div>
            </div>
        `);

        const actions = $('<div class="tmi-manager-row-actions"></div>');
        const pinButton = $(`<div class="menu_button interactable fa-solid fa-thumbtack" title="${row.pinned ? '핀 해제' : '핀'}"></div>`)
            .toggleClass('tmi-is-pinned', row.pinned);
        const editButton = $('<div class="menu_button interactable fa-solid fa-pen" title="주입될 문장 편집"></div>');
        const gotoButton = $('<div class="menu_button interactable fa-solid fa-arrow-right-to-bracket" title="해당 메시지로 이동"></div>');

        pinButton.on('click', () => {
            togglePin(row.messageId, row.setIndex, row.itemIndex);
            refresh();
        });

        editButton.on('click', async () => {
            const edited = await globalContext.Popup.show.input(
                '주입될 문장 편집',
                '원문은 그대로 두고, 프롬프트에 들어갈 문장만 바꿉니다. 비우면 원문으로 되돌아갑니다.',
                row.text,
                { rows: 6 },
            );
            if (edited === null) return;

            const tmi = readTMI(row.messageId);
            const set = tmi?.sets?.[row.setIndex];
            if (!set) return;

            if (!set.edits) set.edits = {};
            if (edited.trim()) {
                set.edits[row.itemIndex] = edited;
            } else {
                delete set.edits[row.itemIndex];
            }

            writeTMI(row.messageId, tmi);
            updateInjection();

            // 메시지에 표시된 내용도 갱신
            renderTMI(row.messageId, tmi);
            refresh();
        });

        gotoButton.on('click', () => {
            popup.complete(globalContext.POPUP_RESULT.AFFIRMATIVE);
            const target = document.querySelector(`#chat .mes[mesid="${row.messageId}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                $(target).find('.tmi-container .tmi-content').removeClass('collapsed');
            } else {
                toastr.info('해당 메시지가 아직 화면에 로드되지 않았습니다. 위로 스크롤해 주세요.');
            }
        });

        actions.append(pinButton).append(editButton).append(gotoButton);
        item.append(actions);
        listElement.append(item);
    });
}

function restoreAllTMI() {
    console.log(`[${EXTENSION_NAME}] TMI 복원 시작, 총 메시지: ${globalContext.chat.length}`);

    // Extension이 비활성화되어 있으면 모든 버튼 숨기기
    if (!extensionSettings.enabled) {
        $('.mes_tmi_generate').hide();
        return;
    }

    let restoredCount = 0;
    let buttonCount = 0;
    globalContext.chat.forEach((message, messageId) => {
        const tmi = readTMI(messageId);
        if (tmi) {
            // DOM 요소가 존재하는지 확인
            const messageElement = $(`[mesid="${messageId}"] .mes_text`);
            if (messageElement.length === 0) {
                // 아직 화면에 안 그려진 옛 메시지 → MORE_MESSAGES_LOADED에서 다시 시도됨
                return;
            }

            // 이미 TMI가 렌더링되어 있으면 건너뛰기
            if (messageElement.find('.tmi-container').length > 0) {
                return;
            }

            renderTMI(messageId, tmi);
            restoredCount++;
        } else {
            // TMI가 없고 자동 생성이 꺼져 있으면 생성 버튼 표시
            if (!extensionSettings.autoGenerate) {
                showGenerateButton(messageId);
                buttonCount++;
            } else {
                hideGenerateButton(messageId);
            }
        }
    });

    console.log(`[${EXTENSION_NAME}] TMI 복원 완료: ${restoredCount}개 복원됨, ${buttonCount}개 생성 버튼 추가됨`);
}

/**
 * 현재 채팅의 모든 메시지에서 TMI를 제거합니다. 다른 스와이프에 저장된 것도 함께 지웁니다.
 * @returns {Promise<number>} 삭제된 항목 수
 */
async function clearCurrentChatTMI() {
    let clearedCount = 0;

    globalContext.chat.forEach(message => {
        if (message?.extra?.tmi) {
            delete message.extra.tmi;
            clearedCount++;
        }

        if (Array.isArray(message?.swipe_info)) {
            message.swipe_info.forEach(info => {
                if (info?.extra?.tmi) {
                    delete info.extra.tmi;
                    clearedCount++;
                }
            });
        }
    });

    if (clearedCount > 0) {
        await globalContext.saveChat();
        updateInjection();
    }

    return clearedCount;
}

function showGenerateButton(messageId) {
    // Extension이 비활성화되어 있으면 버튼 표시 안 함
    if (!extensionSettings.enabled) {
        return;
    }

    const button = $(`[mesid="${messageId}"] .mes_tmi_generate`);
    if (button.length > 0) {
        button.show();
    }
}

function hideGenerateButton(messageId) {
    const button = $(`[mesid="${messageId}"] .mes_tmi_generate`);
    if (button.length > 0) {
        button.hide();
    }
}

jQuery(async () => {
    await init();
});

