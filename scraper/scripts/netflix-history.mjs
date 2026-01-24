export async function run(req, res, browser) {
  const page = await browser.newPage();

  await page.goto(
    'https://www.netflix.com/login?nextpage=https%3A%2F%2Fwww.netflix.com%2Fviewingactivity',
    { waitUntil: 'networkidle2' }
  );

  let history = [];
  let needsSignIn = true;

  if (!page.url().includes('login')) {
    await page.goto('https://www.netflix.com/viewingactivity', {
      waitUntil: 'networkidle2',
    });
    needsSignIn = false;
  }

  try {
    if (needsSignIn) {
      await page.type('input[type="text"]', process.env.NETFLIX_U);
      await page.type('input[type="password"]', process.env.NETFLIX_P);

      await page.click('[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
    }

    history = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll('.profile-hub-header + ul li')
      ).map((el) => {
        const [d, m, y] = el.querySelector('.date').textContent.split('/');
        const title = el.querySelector('.title');

        return {
          date: `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
          title: title.textContent,
          url: title.querySelector('a').href,
        };
      });
    });
  } catch (error) {
    console.log(error.toString());
  }

  await page.close();
  return { history };
}
