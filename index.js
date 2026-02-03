/**
 * TMI Generator Extension for SillyTavern
 * 채팅 답장을 받을 때 재미있는 TMI(Too Much Information)를 자동 생성하여 표시합니다.
 */

import { event_types } from '../../../events.js';
import { generateQuietPrompt, getCurrentChatId, user_avatar } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getWorldInfoPrompt } from '../../../world-info.js';

const EXTENSION_NAME = 'SillyTavern-TMIGenerator';

// TMI 데이터는 settings.json에만 저장됩니다 (채팅 파일에는 저장하지 않음)

// 사용자가 편집하는 커스텀 프롬프트 (내용 방향만)
const DEFAULT_PROMPT = `Generate interesting TMI facts about the current conversation, mixing character details and world-building.

Good TMI examples:
- Character quirks, habits, or hidden thoughts
- World-building details and lore
- Environmental or setting details
- Relationship dynamics
- Background context or history

Mix character-focused and world-focused facts naturally.`;

const DEFAULT_HTML_TEMPLATE = `<div class="tmi-item">{{this}}</div>`;

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
    maxTokens: 500,
    tmiCount: 3, // TMI 개수 (1-10)
    tmiLength: 'medium', // TMI 길이 ('short', 'medium', 'long')
    language: 'en', // TMI 출력 언어 ('en', 'ko')
    prompt: DEFAULT_PROMPT,
    htmlTemplate: DEFAULT_HTML_TEMPLATE,
    customCss: DEFAULT_CSS,
    autoOpen: false,
    contextMessages: 20, // 컨텍스트에 포함할 메시지 개수 (기본 20개)
    tmiData: {}, // settings.json에 TMI 데이터 저장
    promptPresets: {}, // 프롬프트 프리셋 저장 { 'preset_name': prompt }
    cssPresets: {}, // CSS 프리셋 저장 { 'preset_name': css }
};

let extensionSettings = {};
let globalContext = null;
const pendingRequests = new Set();

// 채팅 ID + 메시지 ID + 스와이프 ID를 조합한 고유 키 생성
// 각 채팅방, 메시지, 스와이프마다 독립적인 TMI 저장
function getTMIKey(messageId) {
    const chatId = getCurrentChatId();
    if (!chatId) return null; // 채팅이 없으면 null 반환

    const message = globalContext.chat[messageId];
    if (!message) return null;

    const swipeId = message.swipe_id ?? 0;
    return `${chatId}__${messageId}_${swipeId}`;
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

    // 기본 프리셋 추가
    addDefaultPresets();

    await loadSettingsUI();
    initializeEventListeners();
    injectCustomCSS();

    console.log(`[${EXTENSION_NAME}] 초기화 완료`);
}

function addDefaultPresets() {
    // 프롬프트 프리셋 초기화
    if (!extensionSettings.promptPresets) extensionSettings.promptPresets = {};
    if (Object.keys(extensionSettings.promptPresets).length === 0) {
        extensionSettings.promptPresets['기본'] = `Generate interesting TMI facts about the current conversation, mixing character details and world-building.

Good TMI examples:
- Character quirks, habits, or hidden thoughts
- World-building details and lore
- Environmental or setting details
- Relationship dynamics
- Background context or history

Mix character-focused and world-focused facts naturally.`;

        extensionSettings.promptPresets['세계관 TMI'] = `Generate world-building TMI facts about the setting, environment, and lore of the current scene.

Focus on:
- Location history and significance
- Cultural or societal details
- Environmental characteristics
- Technological or magical systems
- Background events or context
- Setting atmosphere and mood`;

        extensionSettings.promptPresets['캐릭터 감정 TMI'] = `Analyze the emotional undertones and psychological nuances of the characters in the conversation.

Focus on:
- Hidden feelings and subtext
- Relationship dynamics and tensions
- Character motivations and desires
- Inner thoughts and conflicts
- Unspoken emotions or intentions
- Psychological state and mood`;

        console.log(`[${EXTENSION_NAME}] 기본 프롬프트 프리셋 ${Object.keys(extensionSettings.promptPresets).length}개 추가됨`);
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

            if (extensionSettings.enabled) {
                toastr.success('TMI Generator가 활성화되었습니다. 🎉');
            } else {
                toastr.info('TMI Generator가 비활성화되었습니다.');
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
            toastr.success('프롬프트가 복원되었습니다.');
        }
    });

    settingsContainer.find('.custom_css')
        .val(extensionSettings.customCss)
        .on('change', function() {
            extensionSettings.customCss = $(this).val();
            saveSettings();
            injectCustomCSS();
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
            toastr.success('CSS가 복원되었습니다.');
        }
    });

    // TMI 데이터 초기화 버튼들
    settingsContainer.find('.tmi_clear_current').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '현재 채팅방의 모든 TMI 데이터를 삭제하시겠습니까?\n(화면에 표시된 TMI도 함께 사라집니다)',
            '현재 채팅방 TMI 초기화'
        );
        if (confirm) {
            const clearedCount = clearCurrentChatTMI();
            saveSettings();

            // 화면에서도 TMI 제거
            $('.tmi-container').remove();

            toastr.success(`현재 채팅방의 TMI ${clearedCount}개가 삭제되었습니다.`);
        }
    });

    settingsContainer.find('.tmi_clear_all').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '⚠️ 모든 채팅방의 TMI 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다!',
            '전체 TMI 초기화'
        );
        if (confirm) {
            const clearedCount = clearAllTMI();
            saveSettings();

            // 화면에서도 TMI 제거
            $('.tmi-container').remove();

            toastr.success(`전체 TMI ${clearedCount}개가 삭제되었습니다.`);
        }
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

// 프롬프트 프리셋 관리
function initializePromptPresetUI(settingsContainer) {
    const presetSelect = settingsContainer.find('.prompt_preset_select');

    function updatePresetList() {
        presetSelect.empty();
        if (extensionSettings.promptPresets) {
            Object.keys(extensionSettings.promptPresets).forEach(name => {
                presetSelect.append(`<option value="${name}">${name}</option>`);
            });
        }
        if (Object.keys(extensionSettings.promptPresets || {}).length > 0) {
            presetSelect.val(Object.keys(extensionSettings.promptPresets)[0]);
        }
    }

    updatePresetList();

    // 프리셋 선택 시 불러오기
    presetSelect.on('change', function() {
        const name = $(this).val();
        if (!name || !extensionSettings.promptPresets[name]) return;

        extensionSettings.prompt = extensionSettings.promptPresets[name];
        settingsContainer.find('.prompt').val(extensionSettings.prompt);
        saveSettings();
        toastr.success(`프롬프트 "${name}" 적용됨`);
    });

    // 프리셋 저장
    settingsContainer.find('.prompt_preset_save').on('click', async function() {
        const name = await globalContext.Popup.show.input('프롬프트 프리셋 이름:', '프롬프트 저장');
        if (!name || !name.trim()) return;

        const trimmed = name.trim();
        if (extensionSettings.promptPresets[trimmed]) {
            const confirm = await globalContext.Popup.show.confirm(
                `"${trimmed}" 프리셋이 이미 존재합니다. 덮어쓰시겠습니까?`,
                '프롬프트 덮어쓰기'
            );
            if (!confirm) return;
        }

        if (!extensionSettings.promptPresets) extensionSettings.promptPresets = {};
        extensionSettings.promptPresets[trimmed] = extensionSettings.prompt;
        saveSettings();
        updatePresetList();
        presetSelect.val(trimmed);
        toastr.success(`프롬프트 "${trimmed}" 저장됨`);
    });

    // 프리셋 삭제
    settingsContainer.find('.prompt_preset_delete').on('click', async function() {
        const name = presetSelect.val();
        if (!name) {
            toastr.warning('삭제할 프롬프트 프리셋을 선택하세요.');
            return;
        }

        const confirm = await globalContext.Popup.show.confirm(
            `"${name}" 프롬프트 프리셋을 삭제하시겠습니까?`,
            '프롬프트 프리셋 삭제'
        );

        if (confirm) {
            delete extensionSettings.promptPresets[name];
            saveSettings();
            updatePresetList();
            toastr.success(`프롬프트 "${name}" 삭제됨`);
        }
    });
}

// CSS 프리셋 관리
function initializeCssPresetUI(settingsContainer) {
    const presetSelect = settingsContainer.find('.css_preset_select');

    function updatePresetList() {
        presetSelect.empty();
        if (extensionSettings.cssPresets) {
            Object.keys(extensionSettings.cssPresets).forEach(name => {
                presetSelect.append(`<option value="${name}">${name}</option>`);
            });
        }
        if (Object.keys(extensionSettings.cssPresets || {}).length > 0) {
            presetSelect.val(Object.keys(extensionSettings.cssPresets)[0]);
        }
    }

    updatePresetList();

    // 프리셋 선택 시 불러오기
    presetSelect.on('change', function() {
        const name = $(this).val();
        if (!name || !extensionSettings.cssPresets[name]) return;

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
        saveSettings();
        updatePresetList();
        presetSelect.val(trimmed);
        toastr.success(`CSS "${trimmed}" 저장됨`);
    });

    // 프리셋 삭제
    settingsContainer.find('.css_preset_delete').on('click', async function() {
        const name = presetSelect.val();
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
    globalContext.eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
        console.log(`[${EXTENSION_NAME}] CHARACTER_MESSAGE_RENDERED:`, messageId);

        if (!extensionSettings.enabled || !extensionSettings.autoGenerate) {
            return;
        }

        const message = globalContext.chat[messageId];
        if (!message || message.is_user) {
            return;
        }

        // settings.json에서 기존 TMI 확인 (채팅방별, 스와이프별로 저장됨)
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            const tmiEntry = extensionSettings.tmiData[tmiKey];
            renderTMI(messageId, tmiEntry.items, tmiEntry.visible);
            return;
        }

        // 자동 생성이 켜져 있으면 새로 생성
        if (extensionSettings.enabled && extensionSettings.autoGenerate) {
            await generateTMI(messageId);
        }
    });

    globalContext.eventSource.on(event_types.CHAT_CHANGED, () => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] CHAT_CHANGED - TMI 복원 대기`);
        // 채팅 변경 후 모든 메시지가 렌더링될 때까지 충분히 대기
        setTimeout(() => restoreAllTMI(), 1500);
    });

    // 메시지 수정/복구 후 TMI 복원
    globalContext.eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_UPDATED:`, messageId);

        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            // 기존 TMI 제거 후 재렌더링
            const messageElement = $(`[mesid="${messageId}"] .mes_text`);
            messageElement.find('.tmi-container').remove();

            const tmiEntry = extensionSettings.tmiData[tmiKey];
            setTimeout(() => renderTMI(messageId, tmiEntry.items, tmiEntry.visible), 100);
        }
    });

    // 메시지 삭제 시 TMI도 삭제
    globalContext.eventSource.on(event_types.MESSAGE_DELETED, (messageId) => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_DELETED:`, messageId);

        if (!extensionSettings.tmiData) return;

        const chatId = getCurrentChatId();
        if (!chatId) return;

        // 해당 메시지의 모든 스와이프 TMI 삭제
        let deletedCount = 0;
        const keysToDelete = [];

        Object.keys(extensionSettings.tmiData).forEach(key => {
            // chatId__messageId_swipeId 형식에서 messageId 추출
            if (key.startsWith(`${chatId}__${messageId}_`)) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach(key => {
            delete extensionSettings.tmiData[key];
            deletedCount++;
        });

        if (deletedCount > 0) {
            saveSettings();
            console.log(`[${EXTENSION_NAME}] 메시지 ${messageId}의 TMI ${deletedCount}개 삭제됨`);
        }
    });

    // 스와이프 이벤트: 스와이프 변경 시 해당 스와이프의 TMI 로드
    globalContext.eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        if (!extensionSettings.enabled) return;
        console.log(`[${EXTENSION_NAME}] MESSAGE_SWIPED:`, messageId);

        const message = globalContext.chat[messageId];
        if (!message || message.is_user) return;

        // 기존 TMI 제거
        const messageElement = $(`[mesid="${messageId}"] .mes_text`);
        messageElement.find('.tmi-container').remove();

        // 현재 스와이프의 기존 TMI만 확인 (새로 생성하지 않음)
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            const tmiEntry = extensionSettings.tmiData[tmiKey];
            renderTMI(messageId, tmiEntry.items, tmiEntry.visible);
        }
        // 기존 TMI가 없으면 아무것도 안 함 → CHARACTER_MESSAGE_RENDERED에서 생성됨
    });
}

function buildFullPrompt() {
    // 언어 설정
    const language = extensionSettings.language || 'en';
    const languageInstruction = language === 'ko'
        ? '⚠️ IMPORTANT: 모든 TMI 항목을 한국어로 작성하세요.'
        : '⚠️ IMPORTANT: Write all TMI facts in English.';

    // 길이 조건
    const lengthInstructions = {
        'short': '1-2 sentences per fact (keep it brief)',
        'medium': '3-5 sentences per fact (balanced detail)',
        'long': '7+ sentences per fact (comprehensive detail)',
    };

    // 전체 프롬프트 조합
    const fullPrompt = `${globalContext.substituteParams(extensionSettings.prompt)}

${languageInstruction}

CRITICAL FORMAT - You MUST use this EXACT structure:
<tmi>
- Fact 1 here
- Fact 2 here
- Fact 3 here
</tmi>

Requirements:
- Generate exactly ${extensionSettings.tmiCount} TMI facts
- Length per fact: ${lengthInstructions[extensionSettings.tmiLength]}
- MUST start with <tmi> and end with </tmi>
- Each fact on a new line starting with "- "
- NO other text outside the tags`;

    return fullPrompt;
}

async function generateTMI(messageId) {
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

    // tmiKey 기반으로 중복 체크 (chatId__messageId_swipeId)
    const tmiKey = getTMIKey(messageId);
    if (!tmiKey) return;

    if (pendingRequests.has(tmiKey)) {
        console.log(`[${EXTENSION_NAME}] TMI 생성 중복 호출 방지: ${tmiKey}`);
        return;
    }

    pendingRequests.add(tmiKey);

    const messageElement = $(`[mesid="${messageId}"] .mes_text`);
    messageElement.append(createLoadingHTML());

    try {
        const fullPrompt = buildFullPrompt();
        let result = '';

        if (extensionSettings.source === 'main') {
            // Main API 사용 - generateRaw로 깔끔하게 (로어북 포함)
            const contextText = await buildContextText(messageId);

            console.log(`[${EXTENSION_NAME}] Main API (generateRaw) 요청 (컨텍스트 길이: ${contextText.length}자)`);

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
            );

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

        if (tmiItems && tmiItems.length > 0) {
            // settings.json에만 저장 (채팅 파일에는 저장하지 않음)
            // 채팅 ID + 메시지 ID + 스와이프 ID 조합으로 키 생성
            if (!extensionSettings.tmiData) extensionSettings.tmiData = {};
            const tmiKey = getTMIKey(messageId);
            if (tmiKey) {
                extensionSettings.tmiData[tmiKey] = {
                    items: tmiItems,
                    visible: extensionSettings.autoOpen,
                    timestamp: Date.now(),
                };
            }

            saveSettings();

            messageElement.find('.tmi-container').remove();
            renderTMI(messageId, tmiItems, extensionSettings.autoOpen);
        } else {
            throw new Error('TMI 응답을 파싱할 수 없습니다.');
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 오류:`, error);
        messageElement.find('.tmi-container').remove();
        messageElement.append(createErrorHTML(error.message || '알 수 없는 오류', messageId));
        toastr.error(`TMI 생성 실패: ${error.message}`);
    } finally {
        pendingRequests.delete(tmiKey);
    }
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

        // 캐릭터 북 (Lorebook/World Info)
        if (charData.character_book?.entries) {
            const entries = Object.values(charData.character_book.entries);
            if (entries.length > 0) {
                info += `\n\nCharacter Lore (${entries.length} entries):\n`;
                // 상시 활성화된 항목들만 포함 (constant=true)
                const constantEntries = entries.filter(e => e.constant);
                if (constantEntries.length > 0) {
                    constantEntries.forEach(entry => {
                        if (entry.content) {
                            info += `- ${entry.content}\n`;
                        }
                    });
                } else {
                    // 상시 활성화가 없으면 상위 몇 개만
                    entries.slice(0, 3).forEach(entry => {
                        if (entry.content) {
                            info += `- ${entry.content}\n`;
                        }
                    });
                }
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
    try {
        console.log(`[${EXTENSION_NAME}] Connection Profile: 로어북 가져오기 시도...`);

        // chat을 문자열 배열로 변환
        const chatText = globalContext.chat.map(msg => msg?.mes || '').filter(text => text);

        const worldInfoResult = await getWorldInfoPrompt(
            chatText,  // 문자열 배열 전달
            8000,      // maxContext
            true       // isDryRun
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
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] ❌ Connection Profile: 로어북 가져오기 실패:`, error);
    }

    // 시스템 컨텍스트 구성
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
        }

        messages.push({
            role: 'system',
            content: systemContent,
        });
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
    try {
        console.log(`[${EXTENSION_NAME}] Main API: 로어북 가져오기 시도...`);

        // chat을 문자열 배열로 변환
        const chatText = globalContext.chat.map(msg => msg?.mes || '').filter(text => text);

        const worldInfoResult = await getWorldInfoPrompt(
            chatText,  // 문자열 배열 전달
            8000,      // maxContext (충분히 큰 값)
            true       // isDryRun (실제 스캔하지만 카운터 업데이트 안 함)
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
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] ❌ Main API: 로어북 가져오기 실패:`, error);
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

function parseTMIResponse(content) {
    console.log(`[${EXTENSION_NAME}] parseTMIResponse 입력:`, content.substring(0, 200));

    // 1. <tmi>...</tmi> 태그 안의 내용 추출 (메인 파싱 방법)
    const tmiRegex = /<tmi>\s*([\s\S]*?)\s*<\/tmi>/i;
    const tmiMatch = content.match(tmiRegex);

    if (tmiMatch) {
        const tmiContent = tmiMatch[1];
        console.log(`[${EXTENSION_NAME}] <tmi> 태그 내용 추출 성공, 길이: ${tmiContent.length}`);

        // 리스트 항목 추출 (-, *, •, 숫자. 등)
        const lines = tmiContent.split('\n');
        console.log(`[${EXTENSION_NAME}] 줄 분리: ${lines.length}개 줄`);

        const items = lines
            .map(line => line.trim())
            .filter(line => {
                const isValid = /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line);
                if (!isValid && line.length > 0) {
                    console.log(`[${EXTENSION_NAME}] 필터링됨 (형식 불일치): "${line.substring(0, 50)}..."`);
                }
                return isValid;
            })
            .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
            .filter(line => {
                const isValid = line.length > 5;
                if (!isValid) {
                    console.log(`[${EXTENSION_NAME}] 필터링됨 (너무 짧음): "${line}"`);
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
        .filter(line => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line))
        .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
        .filter(line => {
            // 유효성 검사
            if (line.length < 10 || line.length > 200) return false;
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
            if (s.length < 20 || s.length > 150) return false;
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

function renderTMI(messageId, tmiItems, visible = false) {
    const messageElement = $(`[mesid="${messageId}"] .mes_text`);
    messageElement.find('.tmi-container').remove();
    messageElement.append(createTMIHTML(messageId, tmiItems, visible));
    attachTMIEventHandlers(messageId);
}

function createTMIHTML(messageId, tmiItems, visible = false) {
    const container = $('<div class="tmi-container"></div>').attr('data-tmi-message-id', messageId);
    const header = $('<div class="tmi-header"></div>');
    const title = $('<span class="tmi-title"></span>');

    title.append('📝 TMI ');
    title.append(`<span class="tmi-toggle-icon ${visible ? 'expanded' : ''}">▼</span>`);

    const controls = $('<div class="tmi-controls"></div>');
    controls.append('<button class="tmi-regenerate" title="TMI 재생성">🔄</button>');

    header.append(title).append(controls);
    container.append(header);

    const content = $('<div class="tmi-content"></div>');
    if (!visible) content.addClass('collapsed');

    content.html(renderHTMLTemplate(extensionSettings.htmlTemplate, tmiItems));
    container.append(content);

    return container;
}

function renderHTMLTemplate(template, items) {
    if (!template) template = DEFAULT_HTML_TEMPLATE;

    // 각 아이템마다 템플릿 적용
    return items.map(item => {
        return template.replace(/\{\{this\}\}/g, escapeHtml(String(item)));
    }).join('');
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
    const errorDiv = $('<div class="tmi-error"></div>');

    errorDiv.append($('<span></span>').text('❌ 오류: ' + errorMessage));

    const retryButton = $('<button class="tmi-error-retry" title="재생성">🔄 재시도</button>');
    retryButton.on('click', async function() {
        $(this).prop('disabled', true).text('생성 중...');
        container.remove();

        // 기존 TMI 데이터 삭제
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData?.[tmiKey]) {
            delete extensionSettings.tmiData[tmiKey];
            saveSettings();
        }

        await generateTMI(messageId);
    });

    errorDiv.append(retryButton);
    container.append(errorDiv);

    return container;
}

function attachTMIEventHandlers(messageId) {
    const container = $(`[mesid="${messageId}"] .tmi-container`);

    container.find('.tmi-header').off('click').on('click', function(e) {
        if ($(e.target).closest('.tmi-regenerate').length > 0) return;

        const content = container.find('.tmi-content');
        const toggleIcon = container.find('.tmi-toggle-icon');
        const isCollapsed = content.hasClass('collapsed');

        content.toggleClass('collapsed');
        toggleIcon.toggleClass('expanded');

        // settings.json에만 상태 저장
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            extensionSettings.tmiData[tmiKey].visible = isCollapsed;
            saveSettings();
        }
    });

    container.find('.tmi-regenerate').off('click').on('click', async function(e) {
        e.stopPropagation();
        const button = $(this);
        button.prop('disabled', true);

        // settings.json에서 기존 TMI 데이터 삭제
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            delete extensionSettings.tmiData[tmiKey];
            saveSettings();
        }

        await generateTMI(messageId);
        button.prop('disabled', false);
    });
}

function restoreAllTMI() {
    console.log(`[${EXTENSION_NAME}] TMI 복원 시작, 총 메시지: ${globalContext.chat.length}`);

    let restoredCount = 0;
    globalContext.chat.forEach((message, messageId) => {
        // settings.json에서만 가져오기 (채팅방별, 스와이프별로 저장됨)
        const tmiKey = getTMIKey(messageId);
        if (tmiKey && extensionSettings.tmiData && extensionSettings.tmiData[tmiKey]) {
            const tmiData = extensionSettings.tmiData[tmiKey].items;
            const visible = extensionSettings.tmiData[tmiKey].visible !== false;
            // DOM 요소가 존재하는지 확인
            const messageElement = $(`[mesid="${messageId}"] .mes_text`);
            if (messageElement.length === 0) {
                console.log(`[${EXTENSION_NAME}] 메시지 ${messageId}의 DOM 요소가 아직 없음, 건너뜀`);
                return;
            }

            // 이미 TMI가 렌더링되어 있으면 건너뛰기
            if (messageElement.find('.tmi-container').length > 0) {
                console.log(`[${EXTENSION_NAME}] 메시지 ${messageId}의 TMI가 이미 렌더링됨, 건너뜀`);
                return;
            }

            renderTMI(messageId, tmiData, visible);
            restoredCount++;
        }
    });

    console.log(`[${EXTENSION_NAME}] TMI 복원 완료: ${restoredCount}개 복원됨`);
}

function clearCurrentChatTMI() {
    if (!extensionSettings.tmiData) return 0;

    const chatId = getCurrentChatId();
    if (!chatId) return 0;

    let clearedCount = 0;
    const chatPrefix = `${chatId}__`;

    // 현재 채팅 ID로 시작하는 모든 키 삭제
    Object.keys(extensionSettings.tmiData).forEach(key => {
        if (key.startsWith(chatPrefix)) {
            delete extensionSettings.tmiData[key];
            clearedCount++;
        }
    });

    return clearedCount;
}

function clearAllTMI() {
    if (!extensionSettings.tmiData) return 0;

    const totalCount = Object.keys(extensionSettings.tmiData).length;
    extensionSettings.tmiData = {};

    return totalCount;
}

jQuery(async () => {
    await init();
});

