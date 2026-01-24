export async function run(req, res, browser) {
  const page = await browser.newPage();
  await page.goto('https://varndean.talaxy.app/Glance', {
    waitUntil: 'networkidle0',
  });

  const exists = (await page.$('span::-p-text(Homework)')) !== null;

  if (!exists) {
    await page.locator('#Email').fill(process.env.TALAXY_U);
    await page.locator('#Password').fill(process.env.TALAXY_P);
    // Wait and click on first result.

    await page.locator('button[type="submit"]').click();

    await page.waitForNavigation({ waitUntil: 'networkidle0' });
  }

  const ellis = await getData(page);

  const aHandle = await page.waitForSelector('#dock a:last-of-type');
  await aHandle.evaluate((el) => $('#dock a:last-of-type').click());

  // await page.locator('#dock a:last-of-type').click();
  await new Promise((r) => setTimeout(r, 1000));

  const seren = await getData(page);

  await page.close();

  return {
    ellis,
    seren,
  };
}

async function getData(page) {
  const aHandle = await page.waitForSelector(
    '.hover-group > :not(.d-none) span::-p-text(Achievement)'
  );
  const achievements = await aHandle.evaluate((el) =>
    el.nextElementSibling?.textContent.trim()
  );

  const hwHandle = await page.waitForSelector(
    '.hover-group > :not(.d-none) .card-innerBody span::-p-text(Homework)'
  );
  const siblingTag = await hwHandle.evaluate((el) => el.parentNode.innerHTML);

  const homework = await hwHandle.evaluate((el) =>
    el.nextElementSibling?.textContent.trim()
  );

  return {
    homework: parseInt(homework, 10) || 0,
    achievements: parseInt(achievements, 10) || 0,
  };
}
