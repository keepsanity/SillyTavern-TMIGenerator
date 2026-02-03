/**
 * TMI Generator Extension for SillyTavern
 * 채팅 답장을 받을 때 재미있는 TMI(Too Much Information)를 자동 생성하여 표시합니다.
 */

import { event_types } from '../../../events.js';
import { generateQuietPrompt } from '../../../../script.js';

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
    padding: 12px;
    text-align: center;
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
    prompt: DEFAULT_PROMPT,
    htmlTemplate: DEFAULT_HTML_TEMPLATE,
    customCss: DEFAULT_CSS,
    autoOpen: false,
    tmiData: {}, // settings.json에 TMI 데이터 저장
    presets: {}, // 프리셋 저장 { 'preset_name': { prompt, customCss } }
};

let extensionSettings = {};
let globalContext = null;
const pendingRequests = new Set();

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

    // 기본 프리셋 추가
    addDefaultPresets();

    await loadSettingsUI();
    initializeEventListeners();
    injectCustomCSS();
    cleanupOldTMIData();

    console.log(`[${EXTENSION_NAME}] 초기화 완료`);
}

function addDefaultPresets() {
    if (!extensionSettings.presets) extensionSettings.presets = {};

    // 기본 프리셋이 없을 때만 추가 (기존 프리셋 유지)
    if (Object.keys(extensionSettings.presets).length === 0) {
        // 1. 기본 프리셋
        extensionSettings.presets['기본'] = {
        prompt: `Generate interesting TMI facts about the current conversation, mixing character details and world-building.

Good TMI examples:
- Character quirks, habits, or hidden thoughts
- World-building details and lore
- Environmental or setting details
- Relationship dynamics
- Background context or history

Mix character-focused and world-focused facts naturally.`,
        customCss: DEFAULT_CSS,
    };

    // 2. 세계관 TMI
    extensionSettings.presets['세계관 TMI'] = {
        prompt: `Generate world-building TMI facts about the setting, environment, and lore of the current scene.

Focus on:
- Location history and significance
- Cultural or societal details
- Environmental characteristics
- Technological or magical systems
- Background events or context
- Setting atmosphere and mood`,
        customCss: `.tmi-container { margin-top: 8px; border-radius: 10px; background: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); overflow: hidden; }
.tmi-header { background: var(--SmartBotMesBlurTintColor); padding: 6px 10px; cursor: pointer; display: flex; justify-content: space-between; border-bottom: 1px solid var(--SmartThemeBorderColor); }
.tmi-title { font-weight: bold; font-size: 0.85em; color: var(--SmartThemeUnderlineColor); }
.tmi-toggle-icon { font-size: 0.7em; color: var(--SmartThemeQuoteColor); transition: transform 0.3s ease; }
.tmi-toggle-icon.expanded { transform: rotate(180deg); }
.tmi-content { overflow: hidden; max-height: 1000px; transition: max-height 0.3s ease; }
.tmi-content.collapsed { max-height: 0; }
.tmi-item { padding: 6px 10px; border-bottom: 1px dashed var(--SmartThemeBorderColor); color: var(--SmartThemeQuoteColor); font-size: 0.8em; }
.tmi-item:last-child { border-bottom: none; }`,
    };

    // 3. 캐릭터 감정 분석
    extensionSettings.presets['캐릭터 감정 TMI'] = {
        prompt: `Analyze the emotional undertones and psychological nuances of the characters in the conversation.

Focus on:
- Hidden feelings and subtext
- Relationship dynamics and tensions
- Character motivations and desires
- Inner thoughts and conflicts
- Unspoken emotions or intentions
- Psychological state and mood`,
        customCss: `.tmi-container { margin-top: 10px; border-radius: 12px; background: linear-gradient(135deg, var(--SmartThemeBlurTintColor) 0%, var(--SmartBotMesBlurTintColor) 100%); border: 1.5px solid var(--SmartThemeBorderColor); overflow: hidden; box-shadow: 0 3px 10px rgba(0,0,0,0.1); }
.tmi-header { background: rgba(0,0,0,0.2); padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; border-bottom: 1.5px solid var(--SmartThemeBorderColor); }
.tmi-title { font-weight: bold; color: var(--SmartThemeUnderlineColor); }
.tmi-toggle-icon { color: var(--SmartThemeQuoteColor); transition: transform 0.3s ease; }
.tmi-toggle-icon.expanded { transform: rotate(180deg); }
.tmi-content { overflow: hidden; max-height: 1000px; transition: max-height 0.3s ease; }
.tmi-content.collapsed { max-height: 0; }
.tmi-item { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--SmartThemeQuoteColor); font-size: 0.85em; font-style: italic; }
.tmi-item:last-child { border-bottom: none; }`,
    };

        saveSettings();
        console.log(`[${EXTENSION_NAME}] 기본 프리셋 ${Object.keys(extensionSettings.presets).length}개 추가됨`);
    }
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

    settingsContainer.find('.max_tokens')
        .val(extensionSettings.maxTokens)
        .on('change', function() {
            extensionSettings.maxTokens = Number($(this).val());
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

    settingsContainer.find('.auto_open')
        .prop('checked', extensionSettings.autoOpen)
        .on('change', function() {
            extensionSettings.autoOpen = $(this).prop('checked');
            saveSettings();
        });

    // 프리셋 관리
    initializePresetUI(settingsContainer);
}

function initializePresetUI(settingsContainer) {
    const presetSelect = settingsContainer.find('.preset_select');

    // 프리셋 목록 업데이트
    function updatePresetList() {
        presetSelect.empty();

        if (extensionSettings.presets) {
            Object.keys(extensionSettings.presets).forEach(presetName => {
                presetSelect.append(`<option value="${presetName}">${presetName}</option>`);
            });
        }

        // 기본 프리셋 자동 선택
        if (extensionSettings.presets && Object.keys(extensionSettings.presets).length > 0) {
            const firstPreset = Object.keys(extensionSettings.presets)[0];
            presetSelect.val(firstPreset);
        }
    }

    updatePresetList();

    // 프리셋 선택 시 불러오기
    presetSelect.on('change', function() {
        const presetName = $(this).val();
        if (!presetName) return;

        const preset = extensionSettings.presets[presetName];
        if (preset) {
            extensionSettings.prompt = preset.prompt;
            extensionSettings.customCss = preset.customCss;

            settingsContainer.find('.prompt').val(preset.prompt);
            settingsContainer.find('.custom_css').val(preset.customCss);

            saveSettings();
            injectCustomCSS();
            toastr.success(`프리셋 "${presetName}"을 불러왔습니다.`);
        }
    });

    // 프리셋 저장
    settingsContainer.find('.preset_save').on('click', async function() {
        const presetName = await globalContext.Popup.show.input(
            '프리셋 이름을 입력하세요:',
            '프리셋 저장'
        );

        if (!presetName || presetName.trim() === '') {
            return;
        }

        const trimmedName = presetName.trim();

        // 중복 확인
        if (extensionSettings.presets[trimmedName]) {
            const confirm = await globalContext.Popup.show.confirm(
                `"${trimmedName}" 프리셋이 이미 존재합니다. 덮어쓰시겠습니까?`,
                '프리셋 덮어쓰기'
            );
            if (!confirm) return;
        }

        // 현재 설정 저장 (프롬프트 + CSS만)
        if (!extensionSettings.presets) extensionSettings.presets = {};
        extensionSettings.presets[trimmedName] = {
            prompt: extensionSettings.prompt,
            customCss: extensionSettings.customCss,
        };

        saveSettings();
        updatePresetList();
        presetSelect.val(trimmedName);
        toastr.success(`프리셋 "${trimmedName}"이 저장되었습니다.`);
    });

    // 프리셋 삭제
    settingsContainer.find('.preset_delete').on('click', async function() {
        const presetName = presetSelect.val();
        if (!presetName) {
            toastr.warning('삭제할 프리셋을 선택하세요.');
            return;
        }

        const confirm = await globalContext.Popup.show.confirm(
            `"${presetName}" 프리셋을 삭제하시겠습니까?`,
            '프리셋 삭제'
        );

        if (confirm) {
            delete extensionSettings.presets[presetName];
            saveSettings();
            updatePresetList();
            toastr.success(`프리셋 "${presetName}"이 삭제되었습니다.`);
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

        // settings.json에서 기존 TMI 확인
        if (extensionSettings.tmiData && extensionSettings.tmiData[messageId]) {
            const tmiEntry = extensionSettings.tmiData[messageId];
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
}

function buildFullPrompt() {
    // 길이 조건
    const lengthInstructions = {
        'short': '1-2 sentences per fact (keep it brief)',
        'medium': '3-5 sentences per fact (balanced detail)',
        'long': '7+ sentences per fact (comprehensive detail)',
    };

    // 전체 프롬프트 조합
    const fullPrompt = `${globalContext.substituteParams(extensionSettings.prompt)}

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

    if (pendingRequests.has(messageId)) return;

    const message = globalContext.chat[messageId];
    if (!message) return;

    pendingRequests.add(messageId);

    const messageElement = $(`[mesid="${messageId}"] .mes_text`);
    messageElement.append(createLoadingHTML());

    try {
        const fullPrompt = buildFullPrompt();
        let result = '';

        if (extensionSettings.source === 'main') {
            // Main API 사용
            const contextText = buildContextText(messageId);
            const promptWithContext = contextText + '\n\n' + fullPrompt;

            result = await generateQuietPrompt({
                quietPrompt: promptWithContext,
                responseLength: extensionSettings.maxTokens,
            });
        } else {
            // Connection Profile 사용
            const contextMessages = buildContextMessages(messageId);
            contextMessages.push({
                role: 'user',
                content: fullPrompt,
            });

            const response = await globalContext.ConnectionManagerRequestService.sendRequest(
                extensionSettings.profileId,
                contextMessages,
                extensionSettings.maxTokens,
                { stream: false, extractData: true }
            );

            result = response.content;
        }

        const tmiItems = parseTMIResponse(result);

        if (tmiItems && tmiItems.length > 0) {
            // settings.json에만 저장 (채팅 파일에는 저장하지 않음)
            if (!extensionSettings.tmiData) extensionSettings.tmiData = {};
            extensionSettings.tmiData[messageId] = {
                items: tmiItems,
                visible: extensionSettings.autoOpen,
                timestamp: Date.now(),
            };

            saveSettings();

            messageElement.find('.tmi-container').remove();
            renderTMI(messageId, tmiItems, extensionSettings.autoOpen);
            toastr.success('TMI가 생성되었습니다! 💡');
        } else {
            throw new Error('TMI 응답을 파싱할 수 없습니다.');
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 오류:`, error);
        messageElement.find('.tmi-container').remove();
        messageElement.append(createErrorHTML(error.message || '알 수 없는 오류'));
        toastr.error(`TMI 생성 실패: ${error.message}`);
    } finally {
        pendingRequests.delete(messageId);
    }
}

function buildContextMessages(upToMessageId) {
    const messages = [];
    const maxMessages = 10;
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

function buildContextText(upToMessageId) {
    const maxMessages = 10;
    const startIdx = Math.max(0, upToMessageId - maxMessages + 1);
    let text = '';

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
    // 1. <tmi>...</tmi> 태그 안의 내용 추출 (메인 파싱 방법)
    const tmiRegex = /<tmi>\s*([\s\S]*?)\s*<\/tmi>/i;
    const tmiMatch = content.match(tmiRegex);

    if (tmiMatch) {
        const tmiContent = tmiMatch[1];
        // 리스트 항목 추출 (-, *, •, 숫자. 등)
        const items = tmiContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line))
            .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
            .filter(line => line.length > 5);

        if (items.length > 0) {
            console.log(`[${EXTENSION_NAME}] Parsed ${items.length} TMI items from <tmi> tags`);
            return items.slice(0, extensionSettings.tmiCount || 10);
        }
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

    title.append('📝 TMI (Too Much Information)');
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

function createErrorHTML(errorMessage) {
    return $('<div class="tmi-container"><div class="tmi-error">오류: ' + escapeHtml(errorMessage) + '</div></div>');
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
        if (extensionSettings.tmiData && extensionSettings.tmiData[messageId]) {
            extensionSettings.tmiData[messageId].visible = isCollapsed;
            saveSettings();
        }
    });

    container.find('.tmi-regenerate').off('click').on('click', async function(e) {
        e.stopPropagation();
        const button = $(this);
        button.addClass('spinning');

        // settings.json에서 기존 TMI 데이터 삭제
        if (extensionSettings.tmiData && extensionSettings.tmiData[messageId]) {
            delete extensionSettings.tmiData[messageId];
            saveSettings();
        }

        await generateTMI(messageId);
        button.removeClass('spinning');
    });
}

function restoreAllTMI() {
    console.log(`[${EXTENSION_NAME}] TMI 복원 시작, 총 메시지: ${globalContext.chat.length}`);

    let restoredCount = 0;
    globalContext.chat.forEach((message, messageId) => {
        // settings.json에서만 가져오기
        if (extensionSettings.tmiData && extensionSettings.tmiData[messageId]) {
            const tmiData = extensionSettings.tmiData[messageId].items;
            const visible = extensionSettings.tmiData[messageId].visible !== false;
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

function cleanupOldTMIData() {
    if (!extensionSettings.tmiData) return;

    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    Object.keys(extensionSettings.tmiData).forEach(messageId => {
        const tmiEntry = extensionSettings.tmiData[messageId];

        // 30일 이상 된 데이터 삭제
        if (tmiEntry.timestamp && tmiEntry.timestamp < thirtyDaysAgo) {
            delete extensionSettings.tmiData[messageId];
            cleanedCount++;
        }
    });

    if (cleanedCount > 0) {
        console.log(`[${EXTENSION_NAME}] 오래된 TMI 데이터 ${cleanedCount}개 정리됨`);
        saveSettings();
    }
}

jQuery(async () => {
    await init();
});

