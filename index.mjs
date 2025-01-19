import express from 'express';
import puppeteer from 'puppeteer';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, 'scripts');

// Middleware to dynamically route based on script files in 'scripts' folder
app.use('/api/:scriptName', async (req, res) => {
  const scriptName = req.params.scriptName;
  const scriptPath = join(SCRIPTS_DIR, `${scriptName}.mjs`);

  console.log(`req: /api/${scriptName}`);

  // Check if the script exists
  if (existsSync(scriptPath)) {
    try {
      // Dynamically import the script, forcing a fresh reload
      const script = await import(scriptPath + `?cacheBust=${Date.now()}`);

      // Run the script and pass Puppeteer instance
      const result = await script.run(req, res, puppeteer);
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
  console.log(`API running on port ${PORT}`);
});
