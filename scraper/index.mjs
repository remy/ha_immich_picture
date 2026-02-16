import express from 'express';
import puppeteer from 'puppeteer';
import multer from 'multer';
import * as cheerio from 'cheerio';
import yaml from 'js-yaml';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  watch,
} from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { spawnSync } from 'child_process';
import { format } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import ejs from 'ejs';
import createHomeAssistantAPI from './hass.mjs';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SCRIPTS_DIR = join(__dirname, 'scripts');
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || TEMPLATE_SCRIPTS_DIR;
const RESOLVED_SCRIPTS_DIR = resolve(SCRIPTS_DIR);
const VIEWS_DIR = join(__dirname, 'views');
const SCRIPT_EXTENSION = '.mjs';
const LOGS_DIR = join(__dirname, 'logs');

// Store active cron tasks so we can destroy them when re-initializing
const activeCronTasks = new Map();

// Store cron expressions for each scheduled script
const scriptCronExpressions = new Map();

// Debounce timer for scheduler reinitialization
let schedulerReinitTimer = null;

// File watcher reference for cleanup
let scriptsWatcher = null;

// Flag to prevent concurrent reloads
let isReloadInProgress = false;

// Execution queue for Puppeteer access control
const executionQueue = [];
let isExecutingScript = false;

// Read version from config.yaml for cache busting
let APP_VERSION = '1.0.0';
if (process.env.NODE_ENV === 'development') {
  // In development, use a random number for cache busting on every reload
  APP_VERSION = Math.random().toString(36).substring(2, 11);
} else {
  // In production, use version from config.yaml
  try {
    const configPath = join(__dirname, 'config.yaml');
    const configContent = readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent);
    APP_VERSION = config?.version || '1.0.0';
  } catch (error) {
    console.warn('Could not read version from config.yaml:', error.message);
  }
}

let now = Date.now();
const { writeFile, readFile, unlink, rename } = fsPromises;

const readFileEntries = (dir) => {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).filter((entry) =>
    entry.isFile()
  );
};

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });

  if (result.error) {
    console.error('Failed to run syntax check', result.error);
    return result.error;
  }

  if (result.status === 0) {
    return null;
  }

  const output = [result.stderr, result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();

  const message = output || `Syntax error detected while checking ${filePath}.`;
  const error = new Error(message);
  error.stack = message;
  return error;
}

const ensureScriptsDir = () => {
  if (!existsSync(SCRIPTS_DIR)) {
    mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  if (SCRIPTS_DIR !== TEMPLATE_SCRIPTS_DIR) {
    const existingScripts = readFileEntries(SCRIPTS_DIR);
    if (existingScripts.length === 0 && existsSync(TEMPLATE_SCRIPTS_DIR)) {
      const templateScripts = readFileEntries(TEMPLATE_SCRIPTS_DIR);
      templateScripts.forEach((entry) => {
        const source = join(TEMPLATE_SCRIPTS_DIR, entry.name);
        const target = join(SCRIPTS_DIR, entry.name);
        copyFileSync(source, target);
      });
    }
  }
};

ensureScriptsDir();
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

const escapeHtml = (input = '') =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const scriptTemplate = `export default async function handler(context) {
  const { request, response, browser, cheerio } = context;
  const page = await browser.newPage();
  await page.goto('https://example.com');

  const data = await page.evaluate(() => {
    return document.title;
  });

  await page.close();
  return data;
}`;

const renderHomePage = async (req, message = '') => {
  const scripts = getScripts();
  const ingressPath = getIngressPath(req);
  const baseHref = getBaseHref(req);
  const apiBasePath = withIngressPath(req, '/api/');

  const html = await ejs.renderFile(join(VIEWS_DIR, 'home.ejs'), {
    message,
    scripts,
    baseHref,
    apiBasePath,
    scriptTemplate: scriptTemplate.replace(/`/g, '\\`'),
    escapeHtml,
    appVersion: APP_VERSION,
  });

  return html;
};

const sanitizeScriptName = (name = '') =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

const trimScriptExtension = (name = '') => name.replace(/\.[^.]+$/, '');

const isSafeFileName = (fileName = '') => /^[a-zA-Z0-9._-]+$/.test(fileName);

const getResolvedPath = (fileName = '') => {
  const safeName = basename(fileName);
  if (!isSafeFileName(safeName)) {
    throw new Error('Invalid script name');
  }

  const resolvedPath = resolve(SCRIPTS_DIR, safeName);
  if (!resolvedPath.startsWith(RESOLVED_SCRIPTS_DIR)) {
    throw new Error('Invalid script path');
  }

  return { safeName, resolvedPath };
};

const toSerializable = (value) => {
  const seen = new WeakSet();
  const replacer = (_, val) => {
    if (typeof val === 'bigint') {
      return val.toString();
    }
    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }
    if (typeof val === 'function') {
      return `[Function ${val.name || 'anonymous'}]`;
    }
    if (val && typeof val === 'object') {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  };

  try {
    return JSON.parse(JSON.stringify(value, replacer));
  } catch (error) {
    try {
      return String(value);
    } catch (fallbackError) {
      return '[Unserializable value]';
    }
  }
};

const stripQuery = (value = '') => value.replace(/\?.*?(?=[:)]|$)/, '');

const filterStackTrace = (stack = '', scriptPath = '') => {
  if (!stack) return stack;
  const normalizedScriptPath = scriptPath ? scriptPath.replace(/\\/g, '/') : '';
  const normalizedScriptsDir = SCRIPTS_DIR.replace(/\\/g, '/');
  const lines = stack.split('\n');
  const header = lines.shift() || '';

  const isUserFrame = (line = '') => {
    if (!line) return false;
    const normalizedLine = line.replace(/\\/g, '/');
    const lineWithoutQuery = stripQuery(normalizedLine);
    if (normalizedScriptPath && normalizedLine.includes(normalizedScriptPath)) {
      return true;
    }
    if (
      normalizedScriptPath &&
      lineWithoutQuery.includes(normalizedScriptPath)
    ) {
      return true;
    }
    return (
      normalizedLine.includes(normalizedScriptsDir) ||
      lineWithoutQuery.includes(normalizedScriptsDir)
    );
  };

  const userFrames = lines.filter(isUserFrame);
  const fallbackFrames =
    userFrames.length > 0
      ? userFrames
      : lines.filter((line) => line && !line.includes('node:internal'));

  const framesToUse =
    fallbackFrames.length > 0
      ? fallbackFrames
      : scriptPath
        ? [`    at ${scriptPath}`]
        : lines;

  const cleanedFrames = framesToUse.map((line) => stripQuery(line));
  return [header, ...cleanedFrames].join('\n').trim();
};

const serializeError = (error, scriptPath = '') => {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: filterStackTrace(error.stack || '', scriptPath),
    };
  }
  return toSerializable(error);
};

const captureConsoleLogs = () => {
  const levels = ['log', 'info', 'warn', 'error'];
  const original = {};
  const logs = [];

  levels.forEach((level) => {
    original[level] = console[level];
    console[level] = (...args) => {
      const message = format(...args);
      logs.push({
        level,
        message,
        timestamp: new Date().toISOString(),
      });
      return original[level](...args);
    };
  });

  const restore = () => {
    levels.forEach((level) => {
      if (original[level]) {
        console[level] = original[level];
      }
    });
  };

  return { logs, restore };
};

const getLogPath = (scriptBaseName = '') => {
  const safeName = sanitizeScriptName(scriptBaseName);
  if (!safeName) {
    throw new Error('Invalid log name');
  }
  return join(LOGS_DIR, `${safeName}.json`);
};

const writeEndpointLog = async (scriptBaseName = '', data = {}) => {
  try {
    const logPath = getLogPath(scriptBaseName);

    // Read existing log to preserve lastError if this is a successful run
    let lastError = null;
    try {
      const existingLog = JSON.parse(await readFile(logPath, 'utf8'));
      if (existingLog.lastError) {
        lastError = existingLog.lastError;
      }
    } catch {
      // File doesn't exist or can't be parsed, no lastError to preserve
    }

    const payload = {
      endpoint: sanitizeScriptName(scriptBaseName),
      timestamp: new Date().toISOString(),
      ...data,
    };

    // If this is a failed run, update lastError
    if (data.success === false && data.error) {
      payload.lastError = {
        timestamp: payload.timestamp,
        error: data.error,
        durationMs: data.durationMs,
        logs: data.logs,
      };
    } else if (lastError) {
      // If successful, preserve the last error information
      payload.lastError = lastError;
    }

    await writeFile(logPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('Unable to write endpoint log', error);
  }
};

const readLatestLogs = () => {
  if (!existsSync(LOGS_DIR)) {
    return {};
  }

  const entries = {};
  const files = readdirSync(LOGS_DIR, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json')
  );

  files.forEach((entry) => {
    const filePath = join(LOGS_DIR, entry.name);
    try {
      const content = JSON.parse(readFileSync(filePath, 'utf8'));
      const baseName = trimScriptExtension(entry.name);
      entries[baseName] = content;
    } catch (error) {
      console.error('Unable to read log file', entry.name, error);
    }
  });

  return entries;
};

const ensureDefaultExport = (content = '') => {
  const defaultExportRegex = /export\s+default\s+/;
  if (defaultExportRegex.test(content)) {
    return content;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return `export default async function handler(context) {
  // TODO: add your scraping logic here
  return {};
}
`;
  }

  const indented = trimmed
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `export default async function handler(context) {
${indented}
}
`;
};

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, SCRIPTS_DIR),
  filename: (req, file, cb) => {
    const requestedName =
      sanitizeScriptName(req.body?.scriptName) ||
      sanitizeScriptName(file.originalname.replace(/\.[^.]+$/, '')) ||
      `script-${Date.now()}`;
    cb(null, `${requestedName}${SCRIPT_EXTENSION}`);
  },
});

const upload = multer({ storage });

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--disable-features=FedCm',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu',
  ],
});

// Initialize cron scheduler after browser is ready
await initializeScheduler();

// Watch scripts directory for changes and reload scheduler when needed
watchScriptsDirectory();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

function getIngressPath(req) {
  const ingressPath = req.headers['x-ingress-path'];
  if (!ingressPath) {
    return '';
  }

  const path = ingressPath.replace(/\/+$/, '');
  if (path === '/') {
    return '';
  }

  return path;
}

function withIngressPath(req, targetPath = '/') {
  const normalizedPath = targetPath.startsWith('/')
    ? targetPath
    : `/${targetPath}`;
  const ingressPath = getIngressPath(req);
  if (!ingressPath) {
    return normalizedPath;
  }

  return `${ingressPath}${normalizedPath}`;
}

function getBaseHref(req) {
  const ingressPath = getIngressPath(req);
  return ingressPath ? `${ingressPath}/` : '/';
}

function getScripts() {
  return readFileEntries(SCRIPTS_DIR)
    .map((entry) => entry.name)
    .filter((_) => _.startsWith('.') === false)
    .sort();
}

/**
 * Get schedule information for a script
 */
function getScriptScheduleInfo(scriptName) {
  const cronExpression = scriptCronExpressions.get(scriptName);
  if (!cronExpression) {
    return { scheduled: false };
  }

  const task = activeCronTasks.get(scriptName);
  if (!task) {
    return { scheduled: false, cron: cronExpression };
  }

  try {
    // Parse the cron expression to get the next run time
    const interval = CronExpressionParser.parse(cronExpression);
    const nextDate = interval.next();
    const nextRunTime = nextDate ? nextDate.toISOString() : null;

    return {
      scheduled: true,
      cron: cronExpression,
      nextRunTime,
    };
  } catch (error) {
    console.warn(
      `[SCHEDULER] Failed to get next run time for ${scriptName}:`,
      error.message
    );
    return {
      scheduled: true,
      cron: cronExpression,
    };
  }
}

/**
 * Get all scripts with their schedule information
 */
function getScriptsWithScheduleInfo() {
  return getScripts().map(scriptFile => {
    const scriptName = trimScriptExtension(scriptFile);
    return {
      file: scriptFile,
      name: scriptName,
      schedule: getScriptScheduleInfo(scriptName),
    };
  });
}

/*
 * Queue system for script executions to prevent concurrent Puppeteer access
 */
async function queueScriptExecution(executionFn, scriptName) {
  return new Promise((resolve, reject) => {
    const queueItem = {
      executionFn,
      resolve,
      reject,
      scriptName,
      queuedAt: Date.now(),
    };

    executionQueue.push(queueItem);
    const queuePosition = executionQueue.length;

    if (queuePosition > 1) {
      console.log(
        `[QUEUE] ${scriptName} queued at position ${queuePosition} (${queuePosition - 1} ahead)`
      );
    }

    processExecutionQueue();
  });
}

/**
 * Process the execution queue one script at a time
 */
async function processExecutionQueue() {
  if (isExecutingScript || executionQueue.length === 0) {
    return;
  }

  isExecutingScript = true;
  const queueItem = executionQueue.shift();
  const waitTime = Date.now() - queueItem.queuedAt;

  if (waitTime > 100) {
    console.log(
      `[QUEUE] ${queueItem.scriptName} starting (waited ${waitTime}ms in queue)`
    );
  }

  try {
    const result = await queueItem.executionFn();
    queueItem.resolve(result);
  } catch (error) {
    queueItem.reject(error);
  } finally {
    isExecutingScript = false;

    // Log remaining queue size
    if (executionQueue.length > 0) {
      console.log(
        `[QUEUE] ${executionQueue.length} script(s) waiting in queue`
      );
    }

    // Process next item in queue
    if (executionQueue.length > 0) {
      setImmediate(() => processExecutionQueue());
    }
  }
}

/**
 * Core script execution logic shared by both scheduled and manual runs
 */
async function executeScriptCore(
  scriptPath,
  scriptName,
  context,
  isScheduled = false
) {
  const startTime = Date.now();
  const { logs, restore } = captureConsoleLogs();

  let callerStackStage = 0;
  let result = null;

  try {
    const scriptUrl = pathToFileURL(scriptPath);
    scriptUrl.searchParams.set('cacheBust', Date.now().toString());
    callerStackStage = 1;
    const scriptModule = await import(scriptUrl.href);
    callerStackStage = 2;
    const handler =
      typeof scriptModule?.default === 'function'
        ? scriptModule.default
        : typeof scriptModule?.run === 'function'
          ? scriptModule.run
          : null;

    if (!handler) {
      throw new Error(
        'Script must export a default async function (or legacy run function).'
      );
    }

    result = await handler(context);
    const durationMs = Date.now() - startTime;

    await writeEndpointLog(scriptName, {
      success: true,
      durationMs,
      result: toSerializable(result),
      logs,
      scheduled: isScheduled,
    });

    const prefix = isScheduled ? '[SCHEDULED]' : '';
    console.log(`${prefix} ${scriptName} completed in ${durationMs}ms`.trim());

    return { success: true, result, durationMs, logs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const prefix = isScheduled ? '[SCHEDULED]' : '';

    if (callerStackStage === 0) {
      console.error(
        `${prefix} ${scriptName} - Failed to read script: ${error.message}`.trim()
      );
    } else if (callerStackStage === 1) {
      console.error(
        `${prefix} ${scriptName} - Failed to parse script: ${error.message}`.trim()
      );

      const syntaxErr = checkSyntax(scriptPath);
      if (syntaxErr) {
        console.error(syntaxErr.stack);
        error = syntaxErr;
      }
    } else if (callerStackStage === 2) {
      console.error(
        `${prefix} ${scriptName} - Error:`.trim(),
        serializeError(error, scriptPath).stack
      );
    }

    await writeEndpointLog(scriptName, {
      success: false,
      durationMs,
      error: serializeError(error, scriptPath),
      logs,
      scheduled: isScheduled,
    });

    throw error;
  } finally {
    // Before restore, ensure that all browser pages are closed
    const pages = await browser.pages();
    await Promise.all(
      pages.map(async (page) => {
        try {
          if (!page.isClosed()) {
            await page.close();
          }
        } catch {
          // nothing
        }
      })
    );
    restore();
  }
}

/**
 * Execute a script in scheduled mode (without HTTP request/response)
 */
async function executeScheduledScript(scriptPath, scriptName) {
  // Check if file still exists before attempting execution
  if (!existsSync(scriptPath)) {
    console.warn(
      `[SCHEDULED] ${scriptName} - File no longer exists at ${scriptPath}, skipping execution`
    );
    return;
  }

  // Queue the execution to prevent concurrent Puppeteer access
  return queueScriptExecution(async () => {
    const context = { browser, cheerio, isScheduled: true };

    // Add Home Assistant API client to context if token is available
    if (process.env.SUPERVISOR_TOKEN) {
      context.hass = createHomeAssistantAPI(process.env.SUPERVISOR_TOKEN);
    }

    return await executeScriptCore(scriptPath, scriptName, context, true);
  }, scriptName);
}

/**
 * Destroy all active cron tasks
 */
function destroyAllScheduledTasks() {
  if (activeCronTasks.size === 0) {
    return;
  }

  console.log(
    `[SCHEDULER] Destroying ${activeCronTasks.size} active scheduled task(s)`
  );
  for (const [scriptName, task] of activeCronTasks.entries()) {
    try {
      task.stop();
      console.log(`[SCHEDULER] Stopped task for ${scriptName}`);
    } catch (error) {
      console.error(
        `[SCHEDULER] Error stopping task for ${scriptName}:`,
        error.message
      );
    }
  }
  activeCronTasks.clear();
  scriptCronExpressions.clear();
}

/**
 * Initialize the cron scheduler by scanning all scripts and registering schedules
 */
async function initializeScheduler(isReload = false) {
  // Prevent concurrent reloads
  if (isReloadInProgress) {
    console.warn('[SCHEDULER] Reload already in progress, skipping...');
    return;
  }

  isReloadInProgress = true;

  try {
    if (isReload) {
      console.log('[SCHEDULER] Reloading scheduler due to file changes...');
      destroyAllScheduledTasks();
    } else {
      console.log('[SCHEDULER] Initializing cron scheduler...');
    }

    const scripts = getScripts();
    let scheduledCount = 0;

    for (const scriptFile of scripts) {
      try {
        const { resolvedPath, safeName } = getResolvedPath(scriptFile);
        const scriptPath = resolvedPath;
        const scriptName = trimScriptExtension(safeName);

        // Import script to check for cron export
        const scriptUrl = pathToFileURL(scriptPath);
        scriptUrl.searchParams.set('cacheBust', Date.now().toString());
        const scriptModule = await import(scriptUrl.href);

        // Check if script exports a cron schedule
        if (scriptModule.cron && typeof scriptModule.cron === 'string') {
          const cronExpression = scriptModule.cron;

          // Validate cron expression
          if (!cron.validate(cronExpression)) {
            console.warn(
              `[SCHEDULER] Invalid cron expression "${cronExpression}" in ${scriptName}, skipping`
            );
            continue;
          }

          // Schedule the script and store the task
          const task = cron.schedule(cronExpression, () => {
            console.log(`[SCHEDULER] Triggering ${scriptName}`);
            executeScheduledScript(scriptPath, scriptName).catch((err) => {
              console.error(
                `[SCHEDULER] Unexpected error running ${scriptName}:`,
                err
              );
            });
          });

          activeCronTasks.set(scriptName, task);
          scriptCronExpressions.set(scriptName, cronExpression);
          scheduledCount++;
          console.log(
            `[SCHEDULER] Scheduled ${scriptName} with cron: ${cronExpression}`
          );
        }
      } catch (error) {
        console.warn(
          `[SCHEDULER] Failed to check schedule for ${scriptFile}:`,
          error.message
        );
      }
    }

    const action = isReload ? 'Reloaded' : 'Initialized';
    console.log(`[SCHEDULER] ${action} ${scheduledCount} scheduled script(s)`);
  } finally {
    isReloadInProgress = false;
  }
}

/**
 * Debounced re-initialization of scheduler
 * Waits 60 seconds after the last file change before reloading
 */
function scheduleSchedulerReload() {
  // Clear existing timer
  if (schedulerReinitTimer) {
    clearTimeout(schedulerReinitTimer);
    console.log(
      '[SCHEDULER] Previous reload timer cancelled, resetting 60-second countdown...'
    );
  }

  console.log(
    '[SCHEDULER] File change detected, will reload in 60 seconds if no more changes...'
  );

  // Set new timer for 60 seconds
  schedulerReinitTimer = setTimeout(async () => {
    schedulerReinitTimer = null;
    try {
      await initializeScheduler(true);
    } catch (error) {
      console.error('[SCHEDULER] Error during reload:', error);
    }
  }, 60000); // 60 seconds
}

/**
 * Watch the scripts directory for changes and reload scheduler
 */
function watchScriptsDirectory() {
  try {
    scriptsWatcher = watch(
      SCRIPTS_DIR,
      { persistent: true },
      (eventType, filename) => {
        if (!filename) {
          return;
        }

        // Only watch .mjs files
        if (!filename.endsWith(SCRIPT_EXTENSION)) {
          return;
        }

        // Ignore hidden files
        if (filename.startsWith('.')) {
          return;
        }

        console.log(`[SCHEDULER] File ${eventType}: ${filename}`);
        scheduleSchedulerReload();
      }
    );

    scriptsWatcher.on('error', (error) => {
      console.error('[SCHEDULER] File watcher error:', error);
    });

    console.log(`[SCHEDULER] Watching ${SCRIPTS_DIR} for changes...`);
  } catch (error) {
    console.error('[SCHEDULER] Failed to start file watcher:', error);
  }
}

/**
 * Cleanup function for graceful shutdown
 */
function cleanupScheduler() {
  console.log('[SCHEDULER] Shutting down...');

  // Clear pending reload timer
  if (schedulerReinitTimer) {
    clearTimeout(schedulerReinitTimer);
    schedulerReinitTimer = null;
    console.log('[SCHEDULER] Cancelled pending reload timer');
  }

  // Clear execution queue
  if (executionQueue.length > 0) {
    console.log(
      `[SCHEDULER] Clearing ${executionQueue.length} queued script(s)`
    );
    executionQueue.forEach((item) => {
      item.reject(new Error('Shutdown in progress'));
    });
    executionQueue.length = 0;
  }

  // Stop all scheduled tasks
  destroyAllScheduledTasks();

  // Close file watcher
  if (scriptsWatcher) {
    try {
      scriptsWatcher.close();
      console.log('[SCHEDULER] File watcher closed');
    } catch (error) {
      console.error('[SCHEDULER] Error closing file watcher:', error);
    }
    scriptsWatcher = null;
  }

  console.log('[SCHEDULER] Shutdown complete');
}

app.get('/', async (req, res) => {
  const message = req.query.message
    ? decodeURIComponent(req.query.message)
    : '';
  const html = await renderHomePage(req, message);
  res.send(html);
});

app.use('/reset', (req, res) => {
  now = Date.now();
  res.json({ message: 'Cache reset' });
});

app.get('/scripts/list', (req, res) => {
  const includeLogs =
    req.query.includeLogs === '1' || req.query.includeLogs === 'true';
  const payload = { scripts: getScriptsWithScheduleInfo() };

  if (includeLogs) {
    payload.logs = readLatestLogs();
  }

  res.json(payload);
});

app.get('/scripts/logs/:scriptName', (req, res) => {
  const scriptBaseName = sanitizeScriptName(req.params.scriptName);
  if (!scriptBaseName) {
    return res.status(400).json({ error: 'Invalid script name' });
  }

  const logs = readLatestLogs();
  const entry = logs[scriptBaseName];
  if (!entry) {
    return res.status(404).json({ error: 'Log not found' });
  }

  res.json({ log: entry });
});

app.get('/scripts/logs/:scriptName/error', (req, res) => {
  const scriptBaseName = sanitizeScriptName(req.params.scriptName);
  if (!scriptBaseName) {
    return res.status(400).json({ error: 'Invalid script name' });
  }

  const logs = readLatestLogs();
  const entry = logs[scriptBaseName];
  if (!entry) {
    return res.status(404).json({ error: 'Log not found' });
  }

  if (!entry.lastError) {
    return res.status(404).json({ error: 'No error history found' });
  }

  res.json({
    scriptName: scriptBaseName,
    lastError: entry.lastError,
    lastSuccess: entry.success ? entry.timestamp : null,
  });
});

app.get('/scripts/content/:fileName', async (req, res) => {
  try {
    const { resolvedPath, safeName } = getResolvedPath(req.params.fileName);
    const content = await readFile(resolvedPath, 'utf8');
    res.json({ fileName: safeName, content });
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: 'Script not found' });
  }
});

app.post('/scripts/rename', async (req, res) => {
  const { originalFileName, newName } = req.body || {};
  if (!originalFileName || !newName) {
    return res
      .status(400)
      .json({ error: 'Original and new names are required.' });
  }

  try {
    const sanitizedNewName = sanitizeScriptName(newName);
    if (!sanitizedNewName) {
      return res.status(400).json({
        error: 'New name must be alphanumeric with dashes or underscores.',
      });
    }

    const original = getResolvedPath(originalFileName);
    const targetFileName = `${sanitizedNewName}${SCRIPT_EXTENSION}`;
    const { resolvedPath: newPath } = getResolvedPath(targetFileName);

    if (newPath === original.resolvedPath) {
      return res.json({ message: 'Name unchanged.', scripts: getScriptsWithScheduleInfo() });
    }

    if (existsSync(newPath)) {
      return res
        .status(409)
        .json({ error: 'A script with that name already exists.' });
    }

    await rename(original.resolvedPath, newPath);
    res.json({
      message: `Renamed to ${targetFileName}`,
      scripts: getScriptsWithScheduleInfo(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to rename script.' });
  }
});

app.delete('/scripts/:fileName', async (req, res) => {
  const fileName = req.params.fileName;
  try {
    const { resolvedPath } = getResolvedPath(fileName);
    if (!existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Script not found.' });
    }
    await unlink(resolvedPath);
    res.json({ message: `Deleted ${fileName}`, scripts: getScriptsWithScheduleInfo() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to delete script.' });
  }
});

app.post('/scripts/save', async (req, res) => {
  const { fileName, scriptName, scriptContent = '' } = req.body || {};
  const incomingContent =
    typeof scriptContent === 'string' ? scriptContent : '';

  try {
    let targetFileName = '';
    let targetPath = '';
    let previousPath = '';

    if (fileName) {
      const { resolvedPath, safeName } = getResolvedPath(fileName);
      const baseName = safeName.replace(/\.[^.]+$/, '');
      targetFileName = `${baseName}${SCRIPT_EXTENSION}`;
      const { resolvedPath: desiredPath } = getResolvedPath(targetFileName);
      if (desiredPath !== resolvedPath && existsSync(desiredPath)) {
        return res
          .status(409)
          .json({ error: 'A script with that name already exists.' });
      }
      targetPath = desiredPath;
      previousPath = desiredPath === resolvedPath ? '' : resolvedPath;
    } else {
      const sanitizedName = sanitizeScriptName(scriptName);
      if (!sanitizedName) {
        return res
          .status(400)
          .json({ error: 'A valid script name is required.' });
      }
      targetFileName = `${sanitizedName}${SCRIPT_EXTENSION}`;
      targetPath = getResolvedPath(targetFileName).resolvedPath;
    }

    const finalContent = ensureDefaultExport(incomingContent);
    await writeFile(targetPath, finalContent, 'utf8');

    if (previousPath) {
      await unlink(previousPath).catch(() => { });
    }

    res.json({
      fileName: targetFileName,
      message: `Saved ${targetFileName}`,
      scripts: getScriptsWithScheduleInfo(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save script.' });
  }
});

app.post('/upload-file', upload.single('scriptFile'), async (req, res) => {
  if (!req.file) {
    const html = await renderHomePage(
      req,
      'No file was uploaded. Please choose a file and try again.'
    );
    return res.send(html);
  }

  const message = encodeURIComponent(`Saved ${req.file.filename}`);
  return res.redirect(withIngressPath(req, `/?message=${message}`));
});

app.post('/upload-text', async (req, res) => {
  const { scriptName, scriptContent } = req.body || {};
  const incomingContent =
    typeof scriptContent === 'string' ? scriptContent : '';

  if (!scriptName || !scriptContent) {
    const html = await renderHomePage(
      req,
      'Both a script name and content are required.'
    );
    return res.send(html);
  }

  const sanitizedName = sanitizeScriptName(scriptName);
  if (!sanitizedName) {
    const html = await renderHomePage(
      req,
      'Script name must include letters, numbers, dashes, or underscores.'
    );
    return res.send(html);
  }

  const targetFileName = `${sanitizedName}${SCRIPT_EXTENSION}`;
  const { resolvedPath } = getResolvedPath(targetFileName);
  const finalContent = ensureDefaultExport(incomingContent);

  try {
    await writeFile(resolvedPath, finalContent, 'utf8');
  } catch (error) {
    console.error(error);
    const html = await renderHomePage(
      req,
      'Unable to save script. Check the logs for details.'
    );
    return res.send(html);
  }

  const message = encodeURIComponent(
    `Saved ${sanitizedName}${SCRIPT_EXTENSION}`
  );
  return res.redirect(withIngressPath(req, `/?message=${message}`));
});

// Middleware to dynamically route based on script files in 'scripts' folder
app.use('/api/:scriptName', async (req, res) => {
  const rawScriptName = req.params.scriptName;
  let scriptPath = '';
  let safeScriptName = '';

  try {
    const { resolvedPath, safeName } = getResolvedPath(
      `${rawScriptName}${SCRIPT_EXTENSION}`
    );
    scriptPath = resolvedPath;
    safeScriptName = trimScriptExtension(safeName);
  } catch (error) {
    console.error('Invalid script request', error);
    return res.status(400).json({ error: 'Invalid script name' });
  }

  console.log(`req: /api/${safeScriptName}`);

  if (!existsSync(scriptPath)) {
    return res.status(404).json({ error: 'Script not found' });
  }

  try {
    // Queue the execution to prevent concurrent Puppeteer access
    const result = await queueScriptExecution(async () => {
      const context = {
        request: req,
        response: res,
        browser,
        cheerio,
        isScheduled: false,
      };

      // Add Home Assistant API client to context if token is available
      if (process.env.SUPERVISOR_TOKEN) {
        context.hass = createHomeAssistantAPI(process.env.SUPERVISOR_TOKEN);
      }

      return await executeScriptCore(
        scriptPath,
        safeScriptName,
        context,
        false
      );
    }, safeScriptName);

    res.json(result.result);
  } catch (error) {
    res.status(500).json({ error: 'Error executing script' });
  }
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT} @ ${new Date().toISOString()}`);
});

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  cleanupScheduler();
  await browser.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  cleanupScheduler();
  await browser.close();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  cleanupScheduler();
  process.exit(1);
});
