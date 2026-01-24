import express from 'express';
import puppeteer from 'puppeteer';
import multer from 'multer';
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';
import 'renvy';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SCRIPTS_DIR = join(__dirname, 'scripts');
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || TEMPLATE_SCRIPTS_DIR;
const RESOLVED_SCRIPTS_DIR = resolve(SCRIPTS_DIR);
const VIEWS_DIR = join(__dirname, 'views');
const SCRIPT_EXTENSION = '.mjs';

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

const escapeHtml = (input = '') =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const scriptTemplate = `export async function run(req, res, browser) {
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
  });

  return html;
};

const sanitizeScriptName = (name = '') =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

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

const ensureRunExport = (content = '') => {
  const runExportRegex = /export\s+(async\s+)?function\s+run/;
  if (runExportRegex.test(content)) {
    return content;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return `export async function run(req, res, browser) {
  // TODO: add your scraping logic here
  return {};
}
`;
  }

  const indented = trimmed
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return `export async function run(req, res, browser) {
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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const getIngressPath = (req) => {
  const ingressPath = req.headers['x-ingress-path'];
  if (!ingressPath) {
    return '';
  }

  const path = ingressPath.replace(/\/+$/, '');
  if (path === '/') {
    return '';
  }

  return path;
};

const withIngressPath = (req, targetPath = '/') => {
  const normalizedPath = targetPath.startsWith('/')
    ? targetPath
    : `/${targetPath}`;
  const ingressPath = getIngressPath(req);
  if (!ingressPath) {
    return normalizedPath;
  }

  return `${ingressPath}${normalizedPath}`;
};

const getBaseHref = (req) => {
  const ingressPath = getIngressPath(req);
  return ingressPath ? `${ingressPath}/` : '/';
};

const getScripts = () =>
  readFileEntries(SCRIPTS_DIR)
    .map((entry) => entry.name)
    .filter((_) => _.startsWith('.') === false)
    .sort();

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
  res.json({ scripts: getScripts() });
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
      return res
        .status(400)
        .json({
          error: 'New name must be alphanumeric with dashes or underscores.',
        });
    }

    const original = getResolvedPath(originalFileName);
    const targetFileName = `${sanitizedNewName}${SCRIPT_EXTENSION}`;
    const { resolvedPath: newPath } = getResolvedPath(targetFileName);

    if (newPath === original.resolvedPath) {
      return res.json({ message: 'Name unchanged.', scripts: getScripts() });
    }

    if (existsSync(newPath)) {
      return res
        .status(409)
        .json({ error: 'A script with that name already exists.' });
    }

    await rename(original.resolvedPath, newPath);
    res.json({
      message: `Renamed to ${targetFileName}`,
      scripts: getScripts(),
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
    res.json({ message: `Deleted ${fileName}`, scripts: getScripts() });
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

    const finalContent = ensureRunExport(incomingContent);
    await writeFile(targetPath, finalContent, 'utf8');

    if (previousPath) {
      await unlink(previousPath).catch(() => {});
    }

    res.json({
      fileName: targetFileName,
      message: `Saved ${targetFileName}`,
      scripts: getScripts(),
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
  const finalContent = ensureRunExport(incomingContent);

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
  const scriptName = req.params.scriptName;
  const scriptPath = join(SCRIPTS_DIR, `${scriptName}${SCRIPT_EXTENSION}`);

  console.log(`req: /api/${scriptName}`);

  // Check if the script exists
  if (existsSync(scriptPath)) {
    try {
      // Dynamically import the script, forcing a fresh reload
      const script = await import(scriptPath + `?cacheBust=${Math.random()}`);

      // Run the script and pass Puppeteer instance
      const result = await script.run(req, res, browser);
      console.log(`result: ${JSON.stringify(result)}`);
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error executing script' });
    }
  } else {
    res.status(404).json({ error: 'Script not found' });
  }
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT} @ ${new Date().toISOString()}`);
});
