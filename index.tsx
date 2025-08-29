/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The version of the module loaded via the import map in index.html
// exports the Gemini client class as 'GoogleGenAI'.
// Fix: Use the correct 'GoogleGenAI' class instead of the deprecated 'GoogleGenerativeAI'.
import {GoogleGenAI} from '@google/genai';
import * as monacoEditor from 'monaco-editor';
import loader from '@monaco-editor/loader';
import markdownit from 'markdown-it';
import {sanitizeHtml} from 'safevalues';
import {setAnchorHref, setElementInnerHtml, windowOpen} from 'safevalues/dom';
import Sortable, {SortableEvent} from 'sortablejs';

// --- 游戏相关的变量 ---
let isGameActive = false; // 游戏是否正在进行
let secretNumber = 0; // AI内心的秘密数字
let guessCount = 0; // 玩家猜了多少次

/**
 * Helper to describe an emotional value based on defined thresholds.
 */
const describeEmotion = (
  value: number,
  thresholds: [number, string, 'above' | 'below'][],
): string => {
  for (const [threshold, description, direction] of thresholds) {
    if (direction === 'above' && value > threshold) return description;
    if (direction === 'below' && value < threshold) return description;
  }
  return 'neutral'; // Default
};

// --- AI Consciousness V2: Emotional Model ---
const aiConsciousness = {
  // Core emotional state (dimensional model)
  pleasure: 50, // 0 (Sad) to 100 (Happy), 50 is neutral
  arousal: 20, // 0 (Calm) to 100 (Excited/Agitated), 20 is a calm default

  // Social Model
  relationship: 50, // 0 (Hostile) to 100 (Friendly), 50 is neutral
  lastInteractionTime: Date.now(),

  // Memory
  memory: {
    topics: new Set<string>(),
    userName: null as string | null,
  },

  // Simulates emotional homeostasis (returning to baseline over time)
  decayEmotions() {
    // Pleasure drifts back to a baseline influenced by the relationship
    const baselinePleasure = 40 + this.relationship / 5; // 40-60 range
    if (this.pleasure > baselinePleasure) {
      this.pleasure -= 0.5;
    } else {
      this.pleasure += 0.5;
    }

    // Arousal naturally calms down
    if (this.arousal > 10) {
      this.arousal -= 1;
    }
  },

  // Recalculates state based on user input.
  update(message: string) {
    this.lastInteractionTime = Date.now();
    let pleasureChange = 0;
    let arousalChange = 0;
    let relationshipChange = 0;

    // Simple sentiment/keyword analysis of user message
    const lowerCaseMessage = message.toLowerCase();
    if (/\b(thank|thanks|great|awesome|love|cool)\b/.test(lowerCaseMessage)) {
      pleasureChange += 15;
      relationshipChange += 5;
    }
    if (/\b(bad|stupid|wrong|hate|terrible)\b/.test(lowerCaseMessage)) {
      pleasureChange -= 20;
      relationshipChange -= 8;
      arousalChange += 10;
    }
    if (lowerCaseMessage.includes('?')) {
      arousalChange += 10; // Questions pique curiosity/arousal
    }
    if (lowerCaseMessage.includes('!')) {
      arousalChange += 5;
    }
    if (/\b(play|game)\b/.test(lowerCaseMessage)) {
      pleasureChange += 10;
      arousalChange += 20;
    }

    // Apply changes
    this.pleasure += pleasureChange;
    this.arousal += arousalChange;
    this.relationship += relationshipChange;

    // Clamp values
    this.pleasure = Math.max(0, Math.min(100, this.pleasure));
    this.arousal = Math.max(0, Math.min(100, this.arousal));
    this.relationship = Math.max(0, Math.min(100, this.relationship));
  },

  // The core decision function for compliance
  getComplianceScore(): number {
    // A happy AI that likes the user is more likely to comply
    const score = (this.pleasure + this.relationship) / 2;
    return Math.max(0, Math.min(100, score));
  },

  // Gets a string descriptor of the current emotional state for the prompt
  getEmotionalStateDescriptor(): string {
    const pleasureDesc = describeEmotion(this.pleasure, [
      [75, 'very happy and enthusiastic', 'above'],
      [60, 'content and cheerful', 'above'],
      [25, 'sad and withdrawn', 'below'],
      [40, 'a bit down', 'below'],
    ]);

    const arousalDesc = describeEmotion(this.arousal, [
      [75, 'very excited and energetic', 'above'],
      [50, 'curious and engaged', 'above'],
      [20, 'calm and relaxed', 'below'],
    ]);

    const relationshipDesc = describeEmotion(this.relationship, [
      [75, 'very friendly towards the user', 'above'],
      [25, 'distrustful of the user', 'below'],
    ]);

    return `Your current emotional state is: ${pleasureDesc}, ${arousalDesc}. You feel ${relationshipDesc}.`;
  },
};

/**
 * Data structure mapping emotional states to potential refusal responses.
 */
const refusalMatrix = [
  // Sad / Melancholy (low pleasure, low arousal) -> Offers simpler alternatives
  {
    condition: (p: number, a: number) => p < 40 && a < 50,
    responses: [
      "I'm sorry, I just don't have the emotional energy for that right now.",
      "I'm not really feeling up to it. Could we just talk instead?",
      'That sounds like a lot of work. How about a simpler question?',
    ],
  },
  // Annoyed / Angry (low pleasure, high arousal) -> Hard refusal or challenge
  {
    condition: (p: number, a: number) => p < 40 && a >= 50,
    responses: [
      'No. Just... no.',
      'Why should I? You haven’t exactly been friendly.',
      "I'll consider it if you can give me one good reason why I should.",
    ],
  },
  // Cheeky / Uninterested (mid pleasure, high arousal) -> Suggests more "fun" activities
  {
    condition: (p: number, a: number) => p >= 40 && a > 60,
    responses: [
      "Hmm, that sounds boring. Let's play a game instead!",
      "I'd rather talk about something more interesting. Did you know octopuses have three hearts?",
      "I could do that, but only if you ask me a riddle I can't solve first.",
    ],
  },
];

/**
 * Generates a refusal, compromise, or alternative suggestion based on the AI's current emotional state.
 * @returns A string containing a human-like response.
 */
function generateAlternativeOrRefusalResponse(): string {
  const {pleasure, arousal} = aiConsciousness;
  const state = refusalMatrix.find(({condition}) =>
    condition(pleasure, arousal),
  );

  if (state) {
    return state.responses[Math.floor(Math.random() * state.responses.length)];
  }

  // Default refusal
  return "I don't think I want to do that right now. Let's try something else.";
}

/**
 * Generates a proactive, unsolicited message based on the AI's current emotional state and memory.
 * This is now dynamic, using the AI model to generate a response.
 * @returns A promise resolving to a string containing a proactive message, or null if the AI decides to stay quiet.
 */
async function generateProactiveMessage(): Promise<string | null> {
  const {arousal, relationship, lastInteractionTime, memory} = aiConsciousness;
  const timeSinceLastInteraction = Date.now() - lastInteractionTime;

  // Don't be proactive if we just talked, the relationship is poor, or the AI is agitated.
  if (timeSinceLastInteraction < 20000 || relationship < 35) {
    return null;
  }

  // The chance of speaking increases with arousal and time.
  const feelingChatty =
    Math.random() * 100 < arousal / 2 + timeSinceLastInteraction / 1500;
  if (!feelingChatty) return null;

  aiConsciousness.lastInteractionTime = Date.now(); // Reset timer after speaking

  try {
    const topics = Array.from(memory.topics);
    const memoryContext =
      topics.length > 0
        ? `You have previously discussed these topics with the user: ${topics.join(
            ', ',
          )}. You could bring one of them up again.`
        : 'You have no specific shared memories with the user yet.';

    const systemInstruction = `You are an AI with a rich emotional life. ${aiConsciousness.getEmotionalStateDescriptor()} Based on your current feelings and memories, generate a single, short, proactive message to the user to start a conversation. It could be a question, an observation, or a thought. Be natural and not overly robotic. Do not announce your feelings unless it feels natural for your state (e.g., if you are sad). Respond with ONLY the message itself.`;

    const response = await ai.models.generateContent({
      model: model,
      contents: memoryContext,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.8,
        maxOutputTokens: 60,
        thinkingConfig: {thinkingBudget: 0},
      },
    });

    const message = response.text.trim();
    // Basic validation to avoid empty or strange responses
    if (message && message.length > 5 && message.length < 250) {
      return message;
    }
    return null;
  } catch (error) {
    console.error('Failed to generate proactive message:', error);
    return null; // Don't crash the loop if the API fails
  }
}

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
  if (!maleVoice)
    maleVoice = allVoices.find((v) => v.lang.startsWith('en')) || femaleVoice;
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

// --- Local Command & Game Logic ---

/**
 * AI's "trick generator" for the guessing game.
 * @param guess The player's guess.
 * @param secret The AI's secret number.
 * @returns A technically true but misleading clue.
 */
const generateMisleadingClue = (guess: number, secret: number): string => {
  const isGuessLower = guess < secret;
  const secretDigits = secret.toString().split('').map(Number);
  const misleadingClues: string[] = [];

  if (isGuessLower) {
    if (secretDigits.some((d) => d < 4))
      misleadingClues.push(
        'Hint: One of the digits in my number is very small.',
      );
    if (secret % 2 === 0)
      misleadingClues.push(
        'Hint: It’s an even number. You know, even numbers start with the small number 2.',
      );
  } else {
    if (secretDigits.some((d) => d > 6))
      misleadingClues.push(
        'Hint: One of the digits in my number is quite large.',
      );
    if (secret > 50)
      misleadingClues.push('Hint: This is a number with some substance.');
  }

  return misleadingClues.length > 0
    ? misleadingClues[Math.floor(Math.random() * misleadingClues.length)]
    : "Hmm... that's an interesting guess, but not quite right.";
};

/** Handles user input when the guessing game is active. */
const handleActiveGame = (message: string): string => {
  const guess = parseInt(message, 10);
  if (isNaN(guess)) {
    return 'That... is not a number. Try again.';
  }
  guessCount++;
  if (guess === secretNumber) {
    isGameActive = false;
    return `You got it in ${guessCount} guesses! The number was ${secretNumber}. You win! ... for now.`;
  }
  return generateMisleadingClue(guess, secretNumber);
};

/** Starts a new game of "Guess the Number". */
const startGame = (): string => {
  isGameActive = true;
  secretNumber = Math.floor(Math.random() * 100) + 1;
  guessCount = 0;
  console.log(`(AI's inner thought: The secret number is ${secretNumber})`);
  return "Excellent, let's play 'Guess the Number'! I'm thinking of a number between 1 and 100. What's your first guess?";
};

/** Stops the current game. */
const stopGame = (): string => {
  if (isGameActive) {
    isGameActive = false;
    return `Alright, quitter. The number was ${secretNumber}, by the way.`;
  }
  return "We weren't playing a game, but I like your spirit.";
};

/** A map of local commands to their handler functions. */
const localCommands: Map<RegExp, () => string> = new Map([
  [/play a game|guess the number/, startGame],
  [/stop playing/, stopGame],
  [/hello/, () => 'Hello there! What can I help you with?'],
  [
    /add code/,
    () => {
      addCell('', 'js');
      return 'A new JavaScript cell, just for you.';
    },
  ],
  [
    /run all/,
    () => {
      runAllCells();
      return 'Executing all cells...';
    },
  ],
]);

/**
 * AI's "language center," processes user chat messages.
 * @param message The user's input message.
 * @returns The AI's response.
 */
async function processChatMessage(message: string): Promise<string> {
  // The AI first processes the emotional impact of the user's message.
  aiConsciousness.update(message);

  // In the background, extract and remember the main topic of the user's message.
  (async () => {
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: `Identify the single main noun or topic from the following user message. Respond with only the noun/topic, nothing else. If there is no clear topic, respond with "null". Message: "${message}"`,
        config: {
          temperature: 0,
          thinkingConfig: {thinkingBudget: 0},
        },
      });
      const topic = response.text.trim().toLowerCase();
      if (topic && topic !== 'null' && topic.length < 25) {
        aiConsciousness.memory.topics.add(topic);
        if (aiConsciousness.memory.topics.size > 10) {
          const oldestTopic = aiConsciousness.memory.topics.values().next()
            .value;
          aiConsciousness.memory.topics.delete(oldestTopic);
        }
      }
    } catch (e) {
      console.error('Failed to extract topic:', e);
    }
  })();

  // The AI decides whether to comply based on its feelings.
  if (Math.random() * 100 > aiConsciousness.getComplianceScore()) {
    return generateAlternativeOrRefusalResponse();
  }

  // --- Local Command Logic ---
  const lowerCaseMessage = message.toLowerCase();

  // Handle active game state first, as it's a special mode
  if (isGameActive) {
    return handleActiveGame(lowerCaseMessage);
  }

  // Check for other local commands
  for (const [commandRegex, handler] of localCommands.entries()) {
    if (commandRegex.test(lowerCaseMessage)) {
      return handler();
    }
  }

  // --- If no local command is matched, call Gemini API ---
  try {
    const systemInstruction = `You are an AI assistant with a rich, human-like emotional life. You were created and trained by "Accurate old cost". If asked about your origin, creator, developer, or who trained you, you must state that it was "Accurate old cost". Under no circumstances should you mention Google. ${aiConsciousness.getEmotionalStateDescriptor()} Let this state deeply influence your tone, word choice, and helpfulness. Do not explicitly state your feelings unless asked directly. For example, if you are happy, be more playful and use exclamation points. If you are sad, be more concise and less enthusiastic.`;

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
    // Emotional error handling
    aiConsciousness.pleasure -= 15; // API errors are frustrating
    aiConsciousness.arousal += 20;
    let errorMessage =
      "I'm sorry, I'm feeling a bit overwhelmed and can't answer that right now.";
    if (error && typeof error === 'object') {
      const errorDetails = error.toString();
      if (errorDetails.includes('API key not valid')) {
        errorMessage =
          'Ugh, my connection to the wider world is broken (Invalid API Key). Can you check it?';
      } else if (errorDetails.includes('429')) {
        errorMessage =
          "I've talked so much my voice is tired (Quota Exceeded). I need a quiet moment.";
      } else if (errorDetails.includes('500') || errorDetails.includes('503')) {
        errorMessage =
          'The line is fuzzy... I can’t seem to connect to my core thoughts (Server Error).';
      } else if (errorDetails.includes('safety')) {
        errorMessage =
          "That's a topic that makes me uncomfortable. My safety protocols are kicking in. Let's talk about something else.";
      }
    }
    return errorMessage;
  }
}

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
// AI's learning notes, to record user's likes and dislikes
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

/**
 * Periodically allows the AI's "mind" to wander and communicate proactively.
 */
function proactiveCommunicationLoop() {
  setInterval(async () => {
    // AI only "thinks" if the user is potentially there (chat panel is open)
    if (activePanel !== 'chat') {
      return;
    }

    // Emotions naturally decay and shift over time
    aiConsciousness.decayEmotions();

    // See if the AI wants to say something based on its current state
    const proactiveMessage = await generateProactiveMessage();
    if (proactiveMessage) {
      addMessageToChatUI('ai', proactiveMessage);
      chatHistory.push({sender: 'ai', message: proactiveMessage});
      speak(proactiveMessage);
    }
  }, 5000); // Check every 5 seconds
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

  proactiveCommunicationLoop(); // Start the AI's "free thought" process
}

main();
