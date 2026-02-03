/**
 * TMI Generator Extension for SillyTavern
 * 채팅 답장을 받을 때 재미있는 TMI(Too Much Information)를 자동 생성하여 표시합니다.
 */

import { event_types } from '../../../events.js';
import { generateQuietPrompt } from '../../../../script.js';

const EXTENSION_NAME = 'SillyTavern-TMIGenerator';

const KEYS = {
    EXTRA: {
        TMI_DATA: 'tmi_data',
        TMI_VISIBLE: 'tmi_visible',
    },
};

const DEFAULT_PROMPT = `Generate 3-5 short, interesting TMI (Too Much Information) facts about the current conversation.

CRITICAL FORMAT - You MUST use this EXACT structure:
<tmi>
- Fact 1 here
- Fact 2 here
- Fact 3 here
</tmi>

Good TMI examples:
- Character quirks or hidden thoughts
- World-building details
- Humorous meta-observations
- Contextual trivia

Rules:
- MUST start with <tmi> and end with </tmi>
- Each fact on a new line starting with "- "
- 1-2 sentences per fact
- NO other text outside the tags`;

const DEFAULT_HTML_TEMPLATE = `<div class="tmi-item">💡 {{this}}</div>`;

const DEFAULT_CSS = `/* 커스텀 TMI 스타일을 여기에 추가하세요 */
.tmi-wrapper {
    /* 기본 스타일은 style.css에 정의되어 있습니다 */
}`;

const DEFAULT_SETTINGS = {
    enabled: true,
    source: 'main',
    profileId: '',
    autoGenerate: true,
    maxTokens: 500,
    prompt: DEFAULT_PROMPT,
    htmlTemplate: DEFAULT_HTML_TEMPLATE,
    customCss: DEFAULT_CSS,
    autoOpen: false,
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

    await loadSettingsUI();
    initializeEventListeners();
    injectCustomCSS();

    console.log(`[${EXTENSION_NAME}] 초기화 완료`);
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

    settingsContainer.find('.html_template')
        .val(extensionSettings.htmlTemplate)
        .on('change', function() {
            extensionSettings.htmlTemplate = $(this).val();
            saveSettings();
        });

    settingsContainer.find('.restore_html').on('click', async function() {
        const confirm = await globalContext.Popup.show.confirm(
            '기본 HTML 템플릿으로 복원하시겠습니까?',
            'HTML 템플릿 복원'
        );
        if (confirm) {
            extensionSettings.htmlTemplate = DEFAULT_HTML_TEMPLATE;
            settingsContainer.find('.html_template').val(DEFAULT_HTML_TEMPLATE);
            saveSettings();
            toastr.success('HTML 템플릿이 복원되었습니다.');
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

        if (message.extra?.[KEYS.EXTRA.TMI_DATA]) {
            const visible = message.extra[KEYS.EXTRA.TMI_VISIBLE] !== false;
            renderTMI(messageId, message.extra[KEYS.EXTRA.TMI_DATA], visible);
            return;
        }

        await generateTMI(messageId);
    });

    globalContext.eventSource.on(event_types.CHAT_CHANGED, () => {
        if (!extensionSettings.enabled) return;
        setTimeout(() => restoreAllTMI(), 500);
    });
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
        let result = '';

        if (extensionSettings.source === 'main') {
            // Main API 사용
            const contextText = buildContextText(messageId);
            const fullPrompt = contextText + '\n\n' + globalContext.substituteParams(extensionSettings.prompt);

            result = await generateQuietPrompt({
                quietPrompt: fullPrompt,
                responseLength: extensionSettings.maxTokens,
            });
        } else {
            // Connection Profile 사용
            const contextMessages = buildContextMessages(messageId);
            contextMessages.push({
                role: 'user',
                content: globalContext.substituteParams(extensionSettings.prompt),
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
            if (!message.extra) message.extra = {};
            message.extra[KEYS.EXTRA.TMI_DATA] = tmiItems;
            message.extra[KEYS.EXTRA.TMI_VISIBLE] = extensionSettings.autoOpen;

            await globalContext.saveChat();

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
            return items.slice(0, 5); // 최대 5개
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
        return listItems.slice(0, 5);
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
        return sentences.slice(0, 5);
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

    title.append('💡 TMI');
    title.append(`<span class="tmi-toggle-icon ${visible ? 'expanded' : ''}">▶</span>`);

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

        const message = globalContext.chat[messageId];
        if (message?.extra) {
            message.extra[KEYS.EXTRA.TMI_VISIBLE] = isCollapsed;
            globalContext.saveChat();
        }
    });

    container.find('.tmi-regenerate').off('click').on('click', async function(e) {
        e.stopPropagation();
        const button = $(this);
        button.addClass('spinning');

        const message = globalContext.chat[messageId];
        if (message?.extra) delete message.extra[KEYS.EXTRA.TMI_DATA];

        await generateTMI(messageId);
        button.removeClass('spinning');
    });
}

function restoreAllTMI() {
    globalContext.chat.forEach((message, messageId) => {
        if (message.extra?.[KEYS.EXTRA.TMI_DATA]) {
            const tmiData = message.extra[KEYS.EXTRA.TMI_DATA];
            const visible = message.extra[KEYS.EXTRA.TMI_VISIBLE] !== false;
            renderTMI(messageId, tmiData, visible);
        }
    });
}

jQuery(async () => {
    await init();
});

