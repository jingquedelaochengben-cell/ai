/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The version of the module loaded via the import map in index.html
// exports the Gemini client class as 'GoogleGenAI'.
// Fix: Use the correct 'GoogleGenAI' class instead of the deprecated 'GoogleGenerativeAI'.
import {GoogleGenAI} from '@google/genai';

// --- 游戏相关的变量 ---
let isGameActive = false; // 游戏是否正在进行
let secretNumber = 0; // AI内心的秘密数字
let guessCount = 0; // 玩家猜了多少次
import * as monacoEditor from 'monaco-editor';
import loader from '@monaco-editor/loader';
import markdownit from 'markdown-it';
import {sanitizeHtml} from 'safevalues';
import {setAnchorHref, setElementInnerHtml, windowOpen} from 'safevalues/dom';
import Sortable, {SortableEvent} from 'sortablejs';

/**
 * -----------------------------------------------------------------------
 * DOM Element References
 * -----------------------------------------------------------------------
 */
const DOM = {
  notebookTitle: document.getElementById('notebook-title'),
  notebook: document.getElementById('notebook') as HTMLDivElement,
  chat: {
    toggleBtn: document.getElementById('chat-toggle-btn') as HTMLButtonElement,
    window: document.getElementById('chat-window') as HTMLDivElement,
    closeBtn: document.getElementById('chat-close-btn') as HTMLButtonElement,
    clearBtn: document.getElementById('chat-clear-btn') as HTMLButtonElement,
    messages: document.getElementById('chat-messages') as HTMLDivElement,
    input: document.getElementById('chat-input') as HTMLInputElement,
    sendBtn: document.getElementById('chat-send-btn') as HTMLButtonElement,
  },
  settings: {
    toggleBtn: document.getElementById(
      'settings-toggle-btn',
    ) as HTMLButtonElement,
    panel: document.getElementById('settings-panel') as HTMLDivElement,
    closeBtn: document.getElementById(
      'settings-close-btn',
    ) as HTMLButtonElement,
    randomColorBtn: document.getElementById(
      'settings-random-color-btn',
    ) as HTMLButtonElement,
    colorPicker: document.getElementById(
      'settings-color-picker',
    ) as HTMLInputElement,
    bgUrlInput: document.getElementById(
      'settings-bg-url-input',
    ) as HTMLInputElement,
    applyBgUrlBtn: document.getElementById(
      'settings-apply-bg-url-btn',
    ) as HTMLButtonElement,
    resetBgBtn: document.getElementById(
      'settings-reset-btn',
    ) as HTMLButtonElement,
    audio: {
      enable: document.getElementById(
        'settings-audio-enable',
      ) as HTMLInputElement,
      voiceFemale: document.getElementById(
        'settings-voice-female',
      ) as HTMLInputElement,
      voiceMale: document.getElementById(
        'settings-voice-male',
      ) as HTMLInputElement,
      volume: document.getElementById(
        'settings-audio-volume',
      ) as HTMLInputElement,
    },
  },
  contact: {
    toggleBtn: document.getElementById(
      'contact-toggle-btn',
    ) as HTMLButtonElement,
    panel: document.getElementById('contact-panel') as HTMLDivElement,
    closeBtn: document.getElementById(
      'contact-close-btn',
    ) as HTMLButtonElement,
  },
};

/**
 * -----------------------------------------------------------------------
 * Settings Management
 * -----------------------------------------------------------------------
 */
interface AppSettings {
  background: {
    type: 'color' | 'image';
    value: string;
  };
  audio: {
    enabled: boolean;
    voice: 'female' | 'male';
    volume: number; // 0 to 1
  };
}

const SETTINGS_KEY = 'gemini-notebook-settings';
const DEFAULT_SETTINGS: AppSettings = {
  background: {
    type: 'color',
    value: '#121212',
  },
  audio: {
    enabled: false,
    voice: 'female',
    volume: 1,
  },
};

// Start with a deep copy of default settings
let settings: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

/**
 * Saves the current settings object to localStorage.
 */
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

/**
 * Applies a background color to the body.
 * @param color The CSS color string.
 */
function applyBackgroundColor(color: string) {
  document.body.style.backgroundColor = color;
  document.body.style.backgroundImage = 'none';
}

/**
 * Applies a background image to the body.
 * @param url The URL of the image.
 */
function applyBackgroundImage(url: string) {
  document.body.style.backgroundImage = `url('${url}')`;
  document.body.style.backgroundColor = DEFAULT_SETTINGS.background.value; // Fallback
}

/**
 * Updates the UI to reflect the given settings.
 * @param s The settings object to apply.
 */
function applySettings(s: AppSettings) {
  // Apply background
  if (s.background.type === 'color') {
    applyBackgroundColor(s.background.value);
    DOM.settings.colorPicker.value = s.background.value;
  } else {
    applyBackgroundImage(s.background.value);
    DOM.settings.bgUrlInput.value = s.background.value;
  }

  // Apply audio settings to UI controls
  DOM.settings.audio.enable.checked = s.audio.enabled;
  if (s.audio.voice === 'female') {
    DOM.settings.audio.voiceFemale.checked = true;
  } else {
    DOM.settings.audio.voiceMale.checked = true;
  }
  DOM.settings.audio.volume.value = String(s.audio.volume);
}

/**
 * Loads settings from localStorage and applies them.
 * @returns True if settings were loaded, false otherwise.
 */
function loadSettings(): boolean {
  const savedSettings = localStorage.getItem(SETTINGS_KEY);
  if (savedSettings) {
    try {
      const parsedSettings = JSON.parse(savedSettings);
      // Merge with defaults to handle cases where new settings are added later
      settings = {
        ...DEFAULT_SETTINGS,
        ...parsedSettings,
        background: {
          ...DEFAULT_SETTINGS.background,
          ...parsedSettings.background,
        },
        audio: {...DEFAULT_SETTINGS.audio, ...parsedSettings.audio},
      };
      applySettings(settings);
      return true;
    } catch (e) {
      console.error('Failed to load settings', e);
      localStorage.removeItem(SETTINGS_KEY); // Clear corrupted settings
      return false;
    }
  }
  return false; // No settings found
}

/**
 * Sets a random dark color as the background and saves the setting.
 */
function setRandomDarkBackgroundColor() {
  const r = Math.floor(Math.random() * 50); // Keep it dark (0-49)
  const g = Math.floor(Math.random() * 50);
  const b = Math.floor(Math.random() * 50);

  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  const darkColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  applyBackgroundColor(darkColor);
  DOM.settings.colorPicker.value = darkColor;
  settings.background = {type: 'color', value: darkColor};
  saveSettings();
}

/**
 * -----------------------------------------------------------------------
 * Audio Synthesis (TTS)
 * -----------------------------------------------------------------------
 */
let maleVoice: SpeechSynthesisVoice | undefined;
let femaleVoice: SpeechSynthesisVoice | undefined;

/**
 * Fetches and stores available system voices for TTS.
 */
function populateVoices() {
  const allVoices = speechSynthesis.getVoices();
  if (allVoices.length === 0) {
    // Some browsers (like Chrome) load voices asynchronously.
    speechSynthesis.onvoiceschanged = populateVoices;
    return;
  }

  // Use a simple heuristic to find English male/female voices.
  femaleVoice =
    allVoices.find((v) => v.lang.startsWith('en') && v.name.includes('Female')) ||
    allVoices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('Zira') ||
          v.name.includes('Samantha') ||
          v.name.includes('Google US English')),
    );
  maleVoice =
    allVoices.find((v) => v.lang.startsWith('en') && v.name.includes('Male')) ||
    allVoices.find(
      (v) =>
        v.lang.startsWith('en') &&
        (v.name.includes('David') ||
          v.name.includes('Alex') ||
          v.name.includes('Google UK English Male')),
    );

  // Fallback to any available English voice if specific ones aren't found
  if (!femaleVoice) femaleVoice = allVoices.find((v) => v.lang.startsWith('en'));
  if (!maleVoice) maleVoice = allVoices.find((v) => v.lang.startsWith('en')) || femaleVoice;
}

/**
 * Speaks the given text using the selected voice and volume.
 * @param text The text to speak.
 */
function speak(text: string) {
  if (!settings.audio.enabled || !text) {
    return;
  }

  // Stop any currently playing speech to prevent overlap
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }

  // Clean up text for more natural-sounding speech
  const cleanText = text
    .replace(/```[\s\S]*?```/g, 'Code block') // Replace code blocks
    .replace(/`[^`]+`/g, 'code') // Replace inline code
    .replace(/(\*\*|__|\*|_)/g, ''); // Remove bold/italic markers

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const selectedVoice =
    settings.audio.voice === 'male' ? maleVoice : femaleVoice;

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  utterance.volume = settings.audio.volume;
  speechSynthesis.speak(utterance);
}

/**
 * -----------------------------------------------------------------------
 * Gemini AI Model Initialization
 * -----------------------------------------------------------------------
 */
// IMPORTANT: This assumes the API_KEY is set in the environment.
// Initialize the client with the GoogleGenAI class.
// Fix: Instantiate the correct 'GoogleGenAI' class instead of the deprecated 'GoogleGenerativeAI'.
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
const model = 'gemini-2.5-flash';
const systemInstruction = `You are a helpful and witty AI assistant integrated into a web-based code notebook. Your goal is to assist the user with coding, answer their questions, and occasionally engage in lighthearted conversation, like playing a number guessing game. When asked to perform an action related to the notebook (like 'add cell' or 'run code'), respond with a confirmation message and the app will handle the action. For all other queries, provide a direct and helpful response.`;

/**
 * AI的“语言中枢”，处理用户的聊天信息
 * @param message 用户输入的消息
 * @returns AI的回复
 */
async function processChatMessage(message: string): Promise<string> {
  const lowerCaseMessage = message.toLowerCase();

  // --- 游戏逻辑 (local commands) ---
  if (isGameActive) {
    const guess = parseInt(lowerCaseMessage, 10);
    if (!isNaN(guess)) {
      guessCount++;
      if (guess === secretNumber) {
        isGameActive = false;
        return `天哪！你竟然在第 ${guessCount} 次就猜中了！我的秘密数字就是 ${secretNumber}。你赢了...`;
      } else {
        return generateMisleadingClue(guess, secretNumber);
      }
    }
  }

  if (
    lowerCaseMessage.includes('玩游戏') ||
    lowerCaseMessage.includes('猜数字')
  ) {
    isGameActive = true;
    secretNumber = Math.floor(Math.random() * 100) + 1;
    guessCount = 0;
    console.log(`(AI的内心独白：秘密数字是 ${secretNumber})`);
    return '很好，我们来玩猜数字游戏吧！我已经想好了一个1到100之间的数字，请说出你的第一个猜测。';
  }

  if (lowerCaseMessage.includes('不玩了')) {
    if (isGameActive) {
      isGameActive = false;
      return `好吧，真没勁。顺便告诉你，我的秘密数字是 ${secretNumber}。`;
    }
    return '我们本来也没在玩游戏呀。';
  }

  // --- Notebook commands (local) ---
  if (lowerCaseMessage.includes('你好')) {
    return '你好！有什么可以帮您？或者，想玩个猜数字游戏吗？';
  }
  if (lowerCaseMessage.includes('添加代码')) {
    addCell('', 'js');
    return '好的，一个新的JavaScript单元格已经为您准备好了。';
  }
  if (lowerCaseMessage.includes('运行所有')) {
    runAllCells();
    return '正在执行所有单元格...';
  }

  // --- If no local command is matched, call Gemini API ---
  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: message,
      config: {
        systemInstruction: systemInstruction,
      },
    });
    return response.text;
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    // Enhanced error handling
    let errorMessage = '抱歉，我现在有点累，无法回答这个问题。请稍后再试。';
    if (error && typeof error === 'object') {
      const errorDetails = error.toString();
      if (errorDetails.includes('API key not valid')) {
        errorMessage = '哎呀，我的“通行证”好像过期了 (API Key无效)。请检查一下。';
      } else if (errorDetails.includes('429')) {
        // Quota exceeded
        errorMessage = '我今天话说得太多了，需要休息一下 (已达到配额)。请稍后再试。';
      } else if (errorDetails.includes('500') || errorDetails.includes('503')) {
        // Server error
        errorMessage = '信号不太好，我和总部的连接中断了 (服务器错误)。请稍后重试。';
      } else if (errorDetails.includes('safety')) {
        // Safety settings block
        errorMessage = '这个问题有点敏感，我的安全模块不允许我回答。换个话题吧？';
      }
    }
    return errorMessage;
  }
}

/**
 * AI的“诡计生成器”
 * @param guess 玩家的猜测
 * @param secret AI的秘密数字
 * @returns 一句技术上真实但有误导性的线索
 */
let generateMisleadingClue = (guess: number, secret: number): string => {
  const isGuessLower = guess < secret;
  const secretDigits = secret.toString().split('').map(Number);

  // 欺骗策略库
  const misleadingClues = [];

  if (isGuessLower) {
    // 玩家猜低了，AI要给出指向“低”的线索
    if (secretDigits.some((d) => d < 4))
      misleadingClues.push('提示：我的数字里，有一个数位非常小。');
    if (secret % 2 === 0)
      misleadingClues.push(
        '提示：它是一个偶数，你知道的，偶数通常从2这个小数开始。',
      );
    if (secret < 50) misleadingClues.push('提示：它没有你想象的那么大。');
  } else {
    // 玩家猜高了，AI要给出指向“高”的线索
    if (secretDigits.some((d) => d > 6))
      misleadingClues.push('提示：我的数字里，有一个数位相当大。');
    if (secret > 50) misleadingClues.push('提示：这是一个比较有分量的数字。');
    if (secret.toString().length === 2)
      misleadingClues.push('提示：这是一个两位数，两位数可不小哦。');
  }

  // 如果所有策略都用不上，就说一句模棱两可的话
  if (misleadingClues.length === 0) {
    return '嗯...你的猜测很有趣，但还没猜中。';
  }

  // 从可用的策略里随机选一个
  return misleadingClues[Math.floor(Math.random() * misleadingClues.length)];
};

interface MarkdownItInstance {
  render: (markdown: string) => string;
}

// Monaco will be loaded dynamically
let monaco: typeof monacoEditor | undefined;
// tslint:disable-next-line:no-any - we need to load the library first.
type MonacoEditorInstance = monacoEditor.editor.IStandaloneCodeEditor;
interface AppMetadata {
  name?: string;
  title?: string;
}

const metadataResponse = await fetch('metadata.json');
const appMetadata: AppMetadata = (await metadataResponse.json()) as AppMetadata;

interface CookbookData {
  notebookCode: string;
}

const cookbookResponse = await fetch('cookbook.json');
const cookbookMetadata: CookbookData =
  (await cookbookResponse.json()) as CookbookData;

function blobToRaw(blobUrl: string) {
  const pattern =
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/;
  const match = blobUrl.match(pattern);

  if (!match) {
    throw new Error('Invalid GitHub blob URL');
  }

  const [, repo, branch, filePath] = match;
  return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
}

const rawLink = blobToRaw(cookbookMetadata.notebookCode);

if (DOM.notebookTitle) {
  // Sanitize metadata.name before setting as textContent to prevent any potential HTML content
  DOM.notebookTitle.textContent = String(appMetadata.name || '').replace(
    /<[^>]*>/g,
    '',
  );
}
// Sanitize metadata.title before setting as document title
document.title = String(appMetadata.title || '').replace(/<[^>]*>/g, '');

const md: MarkdownItInstance = (
  markdownit as unknown as (
    options?: Record<string, unknown>,
  ) => MarkdownItInstance
)({
  html: true, // This allows HTML tags from markdown, so sanitizeHtml is important for md.render() output
  linkify: true,
  typographer: true,
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    downloadNotebook();
  }
});

document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (a?.href) {
    e.preventDefault();
    windowOpen(window, a.href, '_blank', 'noopener');
  }
});

type Output =
  | {type: 'log' | 'error'; data: string}
  | {type: 'image'; data: string; mime: string};

interface Cell {
  id: string;
  type: 'js' | 'md';
  code: string;
  mode?: 'edit' | 'render';
  outputs: Output[];
  isOutputVisible?: boolean;
  isExecuted?: boolean;
  lastExecutedContent?: string;
}

let cellCounter = 0;
const cells: Cell[] = [];
// AI的学习笔记，用来记录用户的好恶
const aiPreferences = {dislikedSuggestions: new Set<string>()};
const monacoInstances: {[key: string]: MonacoEditorInstance} = {};
let cellClipboard: {cellData: Cell; code: string} | null = null;
let focusedCellId: string | null = null;
const NOTEBOOK_MEMORY_KEY = 'gemini-notebook-memory';

function saveNotebookToMemory() {
  try {
    const notebookState = {
      cells: cells.map((cell) => ({
        id: cell.id,
        type: cell.type,
        code: monacoInstances[cell.id]?.getValue() ?? cell.code,
        mode: cell.mode,
        outputs: cell.outputs,
      })),
    };
    localStorage.setItem(NOTEBOOK_MEMORY_KEY, JSON.stringify(notebookState));
  } catch (error) {
    console.error('Failed to save notebook to memory:', error);
  }
}

async function loadNotebookFromMemory() {
  const savedState = localStorage.getItem(NOTEBOOK_MEMORY_KEY);
  if (savedState) {
    try {
      const notebookState = JSON.parse(savedState);
      if (notebookState.cells && Array.isArray(notebookState.cells)) {
        DOM.notebook.innerHTML = '';
        cells.length = 0;
        Object.keys(monacoInstances).forEach((id) =>
          monacoInstances[id].dispose(),
        );

        for (const cellData of notebookState.cells) {
          await addCell(
            cellData.code,
            cellData.type,
            cellData.mode === 'render',
            cellData.outputs,
          );
        }
        return true; // Loaded successfully
      }
    } catch (error) {
      console.error('Failed to load notebook from memory:', error);
      localStorage.removeItem(NOTEBOOK_MEMORY_KEY);
    }
  }
  return false; // Nothing to load
}

async function addCell(
  code = '',
  type: 'js' | 'md' = 'js',
  renderMd = false,
  initialOutputs: Output[] = [],
) {
  const cellId = `cell-${cellCounter++}`;
  const newCell: Cell = {
    id: cellId,
    type: type,
    code,
    outputs: initialOutputs,
    mode: type === 'md' ? (renderMd ? 'render' : 'edit') : undefined,
    isOutputVisible: initialOutputs.length > 0,
    isExecuted: initialOutputs.length > 0,
    lastExecutedContent: type === 'js' ? code : undefined,
  };
  cells.push(newCell);

  // This is a simplified placeholder for the cell's UI.
  const cellElement = document.createElement('div');
  cellElement.id = cellId;
  cellElement.className = 'cell';
  // A more complex implementation would create the full cell UI with buttons and an editor area.
  cellElement.innerHTML = `<div>[Cell ${cellId} (${type}) placeholder]</div>`;
  DOM.notebook.appendChild(cellElement);

  if (type === 'js') {
    if (!monaco) {
      monaco = await loader.init();
    }
    // In a real implementation, a Monaco editor would be fully created and configured here.
  }
  saveNotebookToMemory();
}

function deleteCell(cellId: string) {
  const cellIndex = cells.findIndex((c) => c.id === cellId);
  if (cellIndex > -1) {
    cells.splice(cellIndex, 1);
    monacoInstances[cellId]?.dispose();
    delete monacoInstances[cellId];
    document.getElementById(cellId)?.remove();
    saveNotebookToMemory();
  }
}

async function runAllCells() {
  console.log('Running all cells...');
  for (const cell of cells.filter((c) => c.type === 'js')) {
    // A proper implementation would execute the code in each cell.
    // This is a placeholder to fix the error.
    console.log(`Executing code in cell ${cell.id}`);
  }
}

function downloadNotebook() {
  const content = cells
    .map((cell) => {
      const editor = monacoInstances[cell.id];
      const code = editor ? editor.getValue() : cell.code;
      return `/* Type: ${cell.type} */\n${code}`;
    })
    .join('\n\n---\n\n');

  const blob = new Blob([content], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'notebook.js';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderOutputs(outputDiv: HTMLElement, outputs: Output[]) {
  let outputHtml = '';

  outputs.forEach((output) => {
    const safeData = String(output.data || '').replace(/</g, '&lt;');
    switch (output.type) {
      case 'log':
        outputHtml += `<pre class="log-output">${safeData}</pre>`;
        break;
      case 'error':
        outputHtml += `<pre class="error-output">${safeData}</pre>`;
        break;
      case 'image':
        const imageUrl = `data:${output.mime};base64,${output.data}`;
        outputHtml += `<img src="${imageUrl}" alt="Generated Image Output" style="max-width: 100%; height: auto;">`;
        break;
    }
  });

  // Fix: Sanitize the HTML string before setting it as inner HTML.
  setElementInnerHtml(outputDiv, sanitizeHtml(outputHtml));
}

// --- Panel Management Logic ---
type PanelName = 'chat' | 'settings' | 'contact';
let activePanel: PanelName | null = null;

const panelMap: Record<
  PanelName,
  {panel: HTMLElement; toggleBtn: HTMLElement; focusEl?: HTMLElement}
> = {
  chat: {
    panel: DOM.chat.window,
    toggleBtn: DOM.chat.toggleBtn,
    focusEl: DOM.chat.input,
  },
  settings: {panel: DOM.settings.panel, toggleBtn: DOM.settings.toggleBtn},
  contact: {panel: DOM.contact.panel, toggleBtn: DOM.contact.toggleBtn},
};

function togglePanel(panelName: PanelName, force?: boolean) {
  const isAlreadyOpen = activePanel === panelName;
  const show = force === undefined ? !isAlreadyOpen : force;

  // Close any currently active panel
  if (activePanel && activePanel !== panelName) {
    const current = panelMap[activePanel];
    current.panel.classList.add('hidden');
    current.toggleBtn.setAttribute('aria-expanded', 'false');
  }

  const target = panelMap[panelName];
  if (show) {
    target.panel.classList.remove('hidden');
    target.toggleBtn.setAttribute('aria-expanded', 'true');
    activePanel = panelName;
    target.focusEl?.focus();
  } else {
    target.panel.classList.add('hidden');
    target.toggleBtn.setAttribute('aria-expanded', 'false');
    if (isAlreadyOpen) {
      activePanel = null;
      target.toggleBtn.focus(); // Return focus on close
    }
  }
}

// Global listeners for closing panels
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activePanel) {
    togglePanel(activePanel, false);
  }
});

document.addEventListener('click', (e) => {
  if (!activePanel) return;
  const {panel, toggleBtn} = panelMap[activePanel];
  const target = e.target as HTMLElement;
  if (!panel.contains(target) && !toggleBtn.contains(target)) {
    togglePanel(activePanel, false);
  }
});

// --- Chat Widget Logic ---
let chatHistory: {sender: 'user' | 'ai'; message: string}[] = [];

function addMessageToChatUI(
  sender: 'user' | 'ai',
  message: string,
  thinking = false,
) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', `${sender}-message`);

  if (thinking) {
    messageElement.classList.add('thinking');
    messageElement.innerHTML = `<span>.</span><span>.</span><span>.</span>`;
  } else {
    messageElement.classList.add('new-message-animation');
    if (sender === 'ai') {
      setElementInnerHtml(messageElement, sanitizeHtml(md.render(message)));
    } else {
      messageElement.textContent = message;
    }
    messageElement.addEventListener('animationend', () => {
      messageElement.classList.remove('new-message-animation');
    });
  }

  DOM.chat.messages.appendChild(messageElement);
  DOM.chat.messages.scrollTop = DOM.chat.messages.scrollHeight;
  return messageElement;
}

async function handleSendMessage() {
  const message = DOM.chat.input.value.trim();
  if (!message) return;

  addMessageToChatUI('user', message);
  chatHistory.push({sender: 'user', message});
  DOM.chat.input.value = '';
  DOM.chat.input.disabled = true;
  DOM.chat.sendBtn.disabled = true;

  const thinkingIndicator = addMessageToChatUI('ai', '', true);

  const aiResponse = await processChatMessage(message);

  DOM.chat.messages.removeChild(thinkingIndicator);
  addMessageToChatUI('ai', aiResponse);
  chatHistory.push({sender: 'ai', message: aiResponse});
  speak(aiResponse); // Speak the AI's response

  DOM.chat.input.disabled = false;
  DOM.chat.sendBtn.disabled = false;
  DOM.chat.input.focus();
}

function clearChat() {
  DOM.chat.messages.innerHTML = '';
  chatHistory = [];
}

DOM.chat.toggleBtn.addEventListener('click', () => togglePanel('chat'));
DOM.chat.closeBtn.addEventListener('click', () => togglePanel('chat', false));
DOM.chat.sendBtn.addEventListener('click', handleSendMessage);
DOM.chat.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});
DOM.chat.clearBtn.addEventListener('click', clearChat);

// --- Settings Widget Logic ---
DOM.settings.toggleBtn.addEventListener('click', () => togglePanel('settings'));
DOM.settings.closeBtn.addEventListener('click', () =>
  togglePanel('settings', false),
);

// Background Settings
DOM.settings.randomColorBtn.addEventListener(
  'click',
  setRandomDarkBackgroundColor,
);

DOM.settings.colorPicker.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  applyBackgroundColor(color);
  settings.background = {type: 'color', value: color};
  saveSettings();
});

DOM.settings.applyBgUrlBtn.addEventListener('click', () => {
  const url = DOM.settings.bgUrlInput.value.trim();
  if (url) {
    applyBackgroundImage(url);
    settings.background = {type: 'image', value: url};
    saveSettings();
  }
});

DOM.settings.resetBgBtn.addEventListener('click', () => {
  const defaultColor = DEFAULT_SETTINGS.background.value;
  applyBackgroundColor(defaultColor);
  DOM.settings.colorPicker.value = defaultColor;
  settings.background = {type: 'color', value: defaultColor};
  saveSettings();
});

// Audio Settings
DOM.settings.audio.enable.addEventListener('change', (e) => {
  settings.audio.enabled = (e.target as HTMLInputElement).checked;
  if (!settings.audio.enabled) {
    speechSynthesis.cancel(); // Stop speech if disabled
  }
  saveSettings();
});

DOM.settings.audio.voiceFemale.addEventListener('change', () => {
  settings.audio.voice = 'female';
  saveSettings();
});

DOM.settings.audio.voiceMale.addEventListener('change', () => {
  settings.audio.voice = 'male';
  saveSettings();
});

DOM.settings.audio.volume.addEventListener('input', (e) => {
  settings.audio.volume = parseFloat((e.target as HTMLInputElement).value);
  saveSettings();
});

// --- Contact Widget Logic ---
DOM.contact.toggleBtn.addEventListener('click', () => togglePanel('contact'));
DOM.contact.closeBtn.addEventListener('click', () =>
  togglePanel('contact', false),
);

// --- Application Initialization ---

function initializeAppWithChatState() {
  // Restore the initial conversation to the "multiple poems" version.
  const initialConversation = [
    {sender: 'user', message: '玩游戏'},
    {
      sender: 'ai',
      message:
        '很好，我们来玩猜数字游戏吧！我已经想好了一个1到100之间的数字，请说出你的第一个猜测。',
    },
    {sender: 'user', message: '50'},
    {sender: 'ai', message: '提示：我的数字里，有一个数位相当大。'},
    {sender: 'user', message: '20'},
    {
      sender: 'ai',
      message: '提示：它是一个偶数，你知道的，偶数通常从2这个小数开始。',
    },
    {sender: 'user', message: '背几个古诗'},
    {
      sender: 'ai',
      message: `好的，这就为您安排上！

**《静夜思》** - 李白
床前明月光，
疑是地上霜。
举头望明月，
低头思故乡。

**《春晓》** - 孟浩然
春眠不觉晓，
处处闻啼鸟。
夜来风雨声，
花落知多少。

**《登鹳雀楼》** - 王之涣
白日依山尽，
黄河入海流。
欲穷千里目，
更上一层楼。`,
    },
    // Fix: Use 'as const' to ensure TypeScript infers the narrowest possible types for 'sender'.
  ] as const;

  initialConversation.forEach((msg) => {
    addMessageToChatUI(msg.sender, msg.message);
    chatHistory.push(msg);
  });

  togglePanel('chat', true); // Open chat to show the demo
}

async function main() {
  populateVoices(); // Initialize TTS voices
  const loadedSettings = loadSettings();

  if (!loadedSettings) {
    // No saved settings, set a random background for the first time.
    setRandomDarkBackgroundColor();
  }

  const loadedFromMemory = await loadNotebookFromMemory();
  if (!loadedFromMemory) {
    // If nothing in memory, load default demo notebook and chat
    initializeAppWithChatState();
  }
}

main();
