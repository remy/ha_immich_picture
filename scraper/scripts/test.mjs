// scrape1.mjs - Example Puppeteer script

export async function run(req, res, browser) {
  const page = await browser.newPage();
  await page.goto('https://example.com'); // Customize the URL or use req.query parameters

  const data = await page.evaluate(() => {
    return document.title; // Or customize to scrape specific data
  });

  await page.close();
  return data;
}
