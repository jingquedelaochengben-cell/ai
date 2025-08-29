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

const notebookTitleElement = document.getElementById('notebook-title');
if (notebookTitleElement) {
  // Sanitize metadata.name before setting as textContent to prevent any potential HTML content
  notebookTitleElement.textContent = String(appMetadata.name || '').replace(
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

const notebook = document.getElementById('notebook') as HTMLDivElement;
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
        notebook.innerHTML = '';
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
  notebook.appendChild(cellElement);

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

// --- Chat Widget Logic ---
const chatToggleBtn = document.getElementById(
  'chat-toggle-btn',
) as HTMLButtonElement;
const chatWindow = document.getElementById('chat-window') as HTMLDivElement;
const chatCloseBtn = document.getElementById(
  'chat-close-btn',
) as HTMLButtonElement;
const chatClearBtn = document.getElementById(
  'chat-clear-btn',
) as HTMLButtonElement;
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;

let chatHistory: {sender: 'user' | 'ai'; message: string}[] = [];

function toggleChat(visible?: boolean) {
  const isHidden = chatWindow.classList.contains('hidden');
  const show = visible === undefined ? isHidden : visible;
  chatWindow.classList.toggle('hidden', !show);
  chatToggleBtn.setAttribute('aria-expanded', String(show));
  if (show) {
    chatInput.focus();
  }
}

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
    if (sender === 'ai') {
      // Fix: Sanitize the HTML output from markdown-it before setting it as inner HTML.
      setElementInnerHtml(messageElement, sanitizeHtml(md.render(message)));
    } else {
      messageElement.textContent = message;
    }
  }
  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return messageElement;
}

async function handleSendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  addMessageToChatUI('user', message);
  chatHistory.push({sender: 'user', message});
  chatInput.value = '';
  chatInput.disabled = true;
  chatSendBtn.disabled = true;

  const thinkingIndicator = addMessageToChatUI('ai', '', true);

  const aiResponse = await processChatMessage(message);

  chatMessages.removeChild(thinkingIndicator);
  addMessageToChatUI('ai', aiResponse);
  chatHistory.push({sender: 'ai', message: aiResponse});

  chatInput.disabled = false;
  chatSendBtn.disabled = false;
  chatInput.focus();
}

function clearChat() {
  chatMessages.innerHTML = '';
  chatHistory = [];
}

chatToggleBtn.addEventListener('click', () => toggleChat());
chatCloseBtn.addEventListener('click', () => toggleChat(false));
chatSendBtn.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});
chatClearBtn.addEventListener('click', clearChat);

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

  toggleChat(true); // Open chat to show the demo
}

async function main() {
  const loadedFromMemory = await loadNotebookFromMemory();
  if (!loadedFromMemory) {
    // If nothing in memory, load default demo notebook and chat
    initializeAppWithChatState();
  }
}

main();
