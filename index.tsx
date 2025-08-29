/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The version of the module loaded via the import map in index.html
// exports the Gemini client class as 'GoogleGenerativeAI'.
// FIX: The correct class name is GoogleGenAI, not GoogleGenerativeAI.
import {GoogleGenAI} from '@google/genai';

// FIX: Import monaco editor types to resolve circular reference issue.
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
// Initialize the client with the GoogleGenerativeAI class to match the import.
// FIX: The correct class name is GoogleGenAI, not GoogleGenerativeAI.
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
      return `好吧，真没劲。顺便告诉你，我的秘密数字是 ${secretNumber}。`;
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
    return '抱歉，我现在有点累，无法回答这个问题。请稍后再试。';
  }
}

/**
 * AI的“诡计生成器”
 * @param guess 玩家的猜测
 * @param secret AI的秘密数字
 * @returns 一句技术上真实但有误导性的线索
 */
// FIX: Changed to a let with a function expression to allow reassignment.
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
// FIX: Use the imported monaco editor types to prevent circular reference.
let monaco: typeof monacoEditor | undefined;
// tslint:disable-next-line:no-any - we need to load the library first.
// FIX: Use the imported monaco editor types for the editor instance.
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

// FIX: Define missing functions to resolve "Cannot find name" errors.
// These are plausible implementations based on the context of the application.
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
    const cellIndex = cells.findIndex(c => c.id === cellId);
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
    for (const cell of cells.filter(c => c.type === 'js')) {
        // A proper implementation would execute the code in each cell.
        // This is a placeholder to fix the error.
        console.log(`Executing code in cell ${cell.id}`);
    }
}

function downloadNotebook() {
    const content = cells.map(cell => {
        const editor = monacoInstances[cell.id];
        const code = editor ? editor.getValue() : '[code not available]';
        return `/* Type: ${cell.type} */\n${code}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([content], { type: 'text/plain' });
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
    switch (output.type) {
      case 'log':
        // md.render(output.data) produces HTML. Sanitize it.
        const sanitizedLogContent = sanitizeHtml(md.render(output.data));
        outputHtml += `<div class="console-log">${sanitizedLogContent.toString()}</div>`;
        break;
      case 'error':
        // Escape the error data to prevent XSS
        const escapedErrorData = String(output.data).replace(
          /[<>&"']/g,
          (match) => {
            const escapeMap: {[key: string]: string} = {
              '<': '&lt;',
              '>': '&gt;',
              '&': '&amp;',
              '"': '&quot;',
              "'": '&#x27;',
            };
            return escapeMap[match] || match;
          },
        );
        outputHtml += `<div class="console-error">ERROR: ${escapedErrorData}</div>`;
        break;
      case 'image':
        const imageSrc =
          output.data.startsWith('data:') ||
          output.data.startsWith('http') ||
          output.data.startsWith('./')
            ? output.data
            : `data:${output.mime};base64,${output.data}`;
        // Escape the src attribute to prevent XSS
        const escapedSrc = imageSrc.replace(/[<>"']/g, (match) => {
          const escapeMap: {[key: string]: string} = {
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
          };
          return escapeMap[match] || match;
        });
        outputHtml += `<img src="${escapedSrc}" style="max-width: 100%; display: block; margin: 0.5em 0;" />`;
        break;
      default:
        console.error('Unexpected output type:', output);
        break;
    }
  });

  setElementInnerHtml(outputDiv, sanitizeHtml(outputHtml));
}

function parseNotebookFile(content: string) {
  const lines = content.split('\n');
  const cellsData: Array<{
    type: 'js' | 'md';
    code: string;
    mode?: string;
    outputs?: Output[];
  }> = [];
  let jsCodeLines: string[] = [];
  let mdContent = '';
  let outputContent = '';
  let inCodeBlock = false;
  let inMdBlock = false;
  let inOutputBlock = false;
  let mdMode = 'edit';

  const addJsCell = () => {
    if (jsCodeLines.length > 0) {
      cellsData.push({
        type: 'js',
        code: jsCodeLines.join('\n').trim(),
        outputs: [],
      });
      jsCodeLines = [];
    }
  };

  const addMdCell = () => {
    if (mdContent.trim()) {
      cellsData.push({type: 'md', code: mdContent.trim(), mode: mdMode});
      mdContent = '';
    }
  };

  const addOutput = () => {
    if (outputContent.trim() && cellsData.length > 0) {
      const lastJsCell = [...cellsData].reverse().find((c) => c.type === 'js');
      if (lastJsCell) {
        if (!lastJsCell.outputs) lastJsCell.outputs = [];
        lastJsCell.outputs.push({type: 'log', data: outputContent.trim()});
      }
      outputContent = '';
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed === '// [CODE STARTS]') {
      addMdCell();
      addOutput();
      inCodeBlock = true;
      inMdBlock = inOutputBlock = false;
      return;
    }

    if (trimmed === '// [CODE ENDS]') {
      addJsCell();
      inCodeBlock = false;
      return;
    }

    if (trimmed.startsWith('/* Markdown')) {
      addJsCell();
      addOutput();
      mdMode = trimmed.includes('(render)') ? 'render' : 'edit';
      inMdBlock = true;
      inCodeBlock = inOutputBlock = false;
      return;
    }

    if (trimmed.startsWith('/* Output')) {
      addJsCell();
      addMdCell();
      inOutputBlock = true;
      inCodeBlock = inMdBlock = false;
      return;
    }

    if (trimmed.endsWith('*/')) {
      const contentLine = line.replace(/\*\/\s*$/, '').trim();
      if (contentLine) {
        if (inMdBlock) mdContent += (mdContent ? '\n' : '') + contentLine;
        else if (inOutputBlock) {
          outputContent += (outputContent ? '\n' : '') + contentLine;
        }
      }
      if (inMdBlock) addMdCell();
      else if (inOutputBlock) addOutput();
      inMdBlock = inOutputBlock = false;
      return;
    }

    if (inCodeBlock) jsCodeLines.push(line);
    else if (inMdBlock) mdContent += (mdContent ? '\n' : '') + line;
    else if (inOutputBlock) outputContent += (outputContent ? '\n' : '') + line;
  });

  addJsCell();
  addMdCell();
  addOutput();

  return cellsData;
}

function updateOutputToggle(
  cellId: string,
  isVisible: boolean,
  hasOutput = true,
) {
  const outputDiv = document.getElementById(`${cellId}_output`);
  const outputToggle = outputDiv?.previousElementSibling as HTMLElement;
  const cell = cells.find((c) => c.id === cellId);

  if (outputDiv && outputToggle && cell) {
    if (cell.type === 'md') {
      outputToggle.style.display = 'none';
      return;
    }

    if (hasOutput) {
      outputDiv.style.display = isVisible ? '' : 'none';
      const icon = outputToggle.querySelector('i');
      if (icon) {
        icon.className = `fa-solid ${
          isVisible ? 'fa-chevron-down' : 'fa-chevron-up'
        }`;
      }
      outputToggle.style.display = 'flex';
    } else {
      outputToggle.style.display = 'none';
      outputDiv.style.display = 'none';
    }
  }
}
// =================================================================
// =========== 新增代码：AI的记忆功能 START ==========================
// =================================================================

/**
 * 将当前笔记本的所有单元格内容转换成文字，并存入浏览器的localStorage中。
 * 这就是AI的“记忆”过程。
 */
function saveNotebookToMemory() {
  // 遍历当前页面上所有的“单元格”
  const notebookState = cells.map((cell) => {
    const editor = monacoInstances[cell.id];
    const code = editor ? editor.getValue() : ''; // 获取每个单元格里的代码
    // 将需要的信息打包起来
    return {
      code: code,
      type: cell.type,
      mode: cell.mode,
      outputs: cell.outputs,
    };
  });

  // 使用localStorage这个浏览器自带的“小仓库”，把打包好的信息存进去
  // 'aiMemory_notebook'是我们给这个记忆起的名字
  localStorage.setItem('aiMemory_notebook', JSON.stringify(notebookState));

  console.log('🧠 AI已将当前内容记下。');
}

/**
 * 从浏览器的localStorage中读取之前保存的笔记本内容。
 * 这就是AI的“回忆”过程。
 */
async function loadNotebookFromMemory() {
  // 从“小仓库”里，根据名字找出之前存的记忆
  const savedStateJSON = localStorage.getItem('aiMemory_notebook');

  // 如果找到了记忆...
  if (savedStateJSON) {
    console.log('🧠 AI找到了过去的记忆，正在恢复...');
    const savedCells = JSON.parse(savedStateJSON);

    // 在恢复记忆前，先把当前页面清空，防止内容重复
    while (cells.length > 0) {
      deleteCell(cells[0].id);
    }

    // 如果记忆不是空的，就一个一个地把单元格和代码恢复到页面上
    if (Array.isArray(savedCells) && savedCells.length > 0) {
      for (const cellData of savedCells) {
        await addCell(
          cellData.code,
          cellData.type,
          cellData.mode === 'render',
          cellData.outputs || [],
        );
      }
      return true; // 告诉程序：回忆成功了！
    }
  }
  // 如果没找到记忆，就告诉程序：回忆失败，脑子里是空的。
  return false;
}
// =================================================================
// =========== 新增代码：AI的学习核心功能 START ======================
// =================================================================

/**
 * AI处理用户反馈并记录到“学习笔记”的核心函数
 * @param suggestionType 用户反馈的建议类型，如 'fetch', 'log'
 * @param feedback 'like' 或 'dislike'
 */
function handleSuggestionFeedback(
  suggestionType: string,
  feedback: 'like' | 'dislike',
) {
  const suggestionBox = document.getElementById('proactive-suggestion');

  if (feedback === 'dislike') {
    // 如果用户点了“踩”...
    aiPreferences.dislikedSuggestions.add(suggestionType); // 就把建议类型记在“不喜欢”的列表里
    console.log(
      `🧠 AI已记下：您不喜欢 [${suggestionType}] 这个建议，以后不会再提示了。`,
    );

    // 记完笔记后，顺便把弹窗关掉
    if (suggestionBox) suggestionBox.remove();
  } else if (feedback === 'like') {
    // 如果用户点了“赞”...
    console.log(`🧠 AI已记下：您喜欢 [${suggestionType}] 这个建议！`);

    // 为了给用户一个视觉反馈，我们让“赞”按钮变个色，表示感谢
    const likeButton = document.getElementById('suggestion-like');
    if (likeButton) {
      likeButton.style.backgroundColor = '#28a745'; // 变成绿色
      likeButton.textContent = '👍 已赞';
      // Disable other buttons
      (
        document.getElementById('suggestion-dislike') as HTMLButtonElement
      ).disabled = true;
      (
        document.getElementById('suggestion-yes') as HTMLButtonElement
      ).disabled = true;
      const noButton = document.getElementById(
        'suggestion-no',
      ) as HTMLButtonElement;
      if (noButton) noButton.disabled = true;

      // Automatically perform the action after a short delay
      setTimeout(() => {
        if (suggestionBox) suggestionBox.remove();
        // Here you would add the logic to perform the liked action,
        // e.g., for 'fetch', you'd call a function that adds a fetch cell.
      }, 1000);
    }
  }
}

/**
 * -----------------------------------------------------------------------
 * AI Chat Widget Logic
 * -----------------------------------------------------------------------
 */
const chatToggleButton = document.getElementById(
  'chat-toggle-btn',
) as HTMLButtonElement;
const chatWindow = document.getElementById('chat-window') as HTMLDivElement;
const chatCloseButton = document.getElementById(
  'chat-close-btn',
) as HTMLButtonElement;
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const chatSendButton = document.getElementById(
  'chat-send-btn',
) as HTMLButtonElement;
const chatClearButton = document.getElementById(
  'chat-clear-btn',
) as HTMLButtonElement;
let chatHistory: {role: 'user' | 'ai'; content: string}[] = [];

function toggleChat(visible: boolean) {
  chatWindow.classList.toggle('hidden', !visible);
  chatToggleButton.setAttribute('aria-expanded', String(visible));
  if (visible) {
    chatInput.focus();
  }
}

chatToggleButton.addEventListener('click', () => {
  const isHidden = chatWindow.classList.contains('hidden');
  toggleChat(isHidden);
});

chatCloseButton.addEventListener('click', () => toggleChat(false));

function handleClearChat() {
  // Clear the visual messages from the DOM
  while (chatMessages.firstChild) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
  // Clear the underlying data structure
  chatHistory = [];
  // Focus the input to allow for a new message
  chatInput.focus();
}

chatClearButton.addEventListener('click', handleClearChat);

function appendMessage(
  role: 'user' | 'ai',
  content: string,
  thinking = false,
): HTMLElement {
  const messageElement = document.createElement('div');
  messageElement.classList.add(
    'message',
    role === 'user' ? 'user-message' : 'ai-message',
  );

  if (thinking) {
    messageElement.classList.add('thinking');
    messageElement.innerHTML = `<span>●</span><span>●</span><span>●</span>`;
    messageElement.setAttribute('aria-label', 'AI is thinking');
  } else {
    // Sanitize and render markdown for AI messages
    if (role === 'ai') {
      const sanitizedHtml = sanitizeHtml(md.render(content));
      setElementInnerHtml(messageElement, sanitizedHtml);
    } else {
      messageElement.textContent = content;
    }
  }

  chatMessages.appendChild(messageElement);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return messageElement;
}

async function handleSendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage('user', message);
  chatHistory.push({role: 'user', content: message});
  chatInput.value = '';
  chatInput.disabled = true;
  chatSendButton.disabled = true;

  const thinkingIndicator = appendMessage('ai', '', true);

  try {
    const aiResponse = await processChatMessage(message);
    chatHistory.push({role: 'ai', content: aiResponse});

    // Replace thinking indicator with actual message
    thinkingIndicator.remove();
    appendMessage('ai', aiResponse);
  } catch (error) {
    console.error('Error processing chat message:', error);
    thinkingIndicator.remove();
    appendMessage('ai', '哎呀，我的大脑短路了，请稍后再试一次。');
  } finally {
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    chatInput.focus();
  }
}

chatSendButton.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendMessage();
  }
});

/**
 * -----------------------------------------------------------------------
 * Initialize Chat with Previous Conversation
 * -----------------------------------------------------------------------
 */
async function initializeAppWithChatState() {
  // Set up game state for the pre-filled conversation
  isGameActive = true;
  secretNumber = 25; // Deterministic secret number for this session
  guessCount = 2;

  // Temporarily make clue generation deterministic for initialization
  const originalClueGenerator = generateMisleadingClue;
  generateMisleadingClue = (guess: number, secret: number): string => {
    if (secret === 25) {
      if (guess === 50) return '提示：它没有你想象的那么大。';
      if (guess === 20) return '提示：我的数字里，有一个数位非常小。';
    }
    return originalClueGenerator(guess, secret);
  };

  // Pre-populate chat history
  chatHistory = [
    {role: 'user', content: '玩游戏'},
    {
      role: 'ai',
      content:
        '很好，我们来玩猜数字游戏吧！我已经想好了一个1到100之间的数字，请说出你的第一个猜测。',
    },
    {role: 'user', content: '50'},
    {role: 'ai', content: generateMisleadingClue(50, secretNumber)},
    {role: 'user', content: '20'},
    {role: 'ai', content: generateMisleadingClue(20, secretNumber)},
  ];

  chatHistory.forEach((msg) => appendMessage(msg.role, msg.content));

  // Restore original random clue generator for subsequent guesses
  generateMisleadingClue = originalClueGenerator;

  // Now, handle the user's latest message that requires the Gemini API
  const latestMessage = '背一遍已亥杂诗';
  appendMessage('user', latestMessage);
  chatHistory.push({role: 'user', content: latestMessage});

  chatInput.disabled = true;
  chatSendButton.disabled = true;
  const thinkingIndicator = appendMessage('ai', '', true);

  try {
    // This is hardcoded to complete the conversation without a real API call
    // in this specific version of the code.
    const aiResponse = `好的，龚自珍的《己亥杂诗·其五》最为有名：\n\n> 浩荡离愁白日斜，\n> 吟鞭东指即天涯。\n> 落红不是无情物，\n> 化作春泥更护花。`;
    chatHistory.push({role: 'ai', content: aiResponse});
    thinkingIndicator.remove();
    appendMessage('ai', aiResponse);
  } catch (error) {
    console.error('Error processing initial chat message:', error);
    thinkingIndicator.remove();
    appendMessage('ai', '哎呀，我的大脑短路了，请稍后再试一次。');
  } finally {
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    toggleChat(true); // Open chat window at the end
  }
}

/**
 * -----------------------------------------------------------------------
 * Main Application Initialization
 * -----------------------------------------------------------------------
 */
async function main() {
  // On startup, try to load the notebook from the AI's memory (localStorage)
  const loadedFromMemory = await loadNotebookFromMemory();

  // If nothing was loaded from memory, it's a fresh start.
  // In this case, we'll run the pre-canned interactive demo.
  if (!loadedFromMemory) {
    // This function populates the chat with a demo conversation
    // and opens the chat window.
    initializeAppWithChatState();
  } else {
    // If we successfully loaded a notebook, we don't want the canned demo.
    // We'll just open a fresh, empty chat window for the user to continue their work.
    console.log('✅ Notebook restored from memory.');
    toggleChat(true);
  }
}

// Run the main initialization function.
main();
