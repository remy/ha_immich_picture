export async function run(req, res, browser) {
  const page = await browser.newPage();
  await page.goto('https://cityclean.brighton-hove.gov.uk/link/collections'); // Customize the URL or use req.query parameters

  // Type into search box.
  await page.locator('input[type="text"]').fill('bn16pu');
  // Wait and click on first result.
  await page.locator('button').click();

  // Locate the full title with a unique string.
  const h1 = await page.waitForSelector(
    'select option::-p-text(39A Whittingehame Gardens, Brighton, BN1 6PU)'
  );

  const optionValue = await page.evaluate(() => {
    const option = Array.from(document.querySelectorAll('select option')).find(
      (opt) =>
        opt.textContent === '39A Whittingehame Gardens, Brighton, BN1 6PU'
    );
    return option ? option.value : null;
  });

  await page.select('select', optionValue); // single selection

  await page.locator('button::-p-text(Next collections)').click();

  await page.locator('::-p-text(Due date)').waitHandle();

  const data = await page.evaluate(() => {
    return Array.from(document.querySelector('.row').querySelectorAll('*'))
      .filter((_) => _.children && _.children.length === 0 && _.textContent)
      .map((_) => _.textContent)
      .filter((_, i) => i % 2 == 1);
  });

  await page.close();

  return {
    [slugify(data[0])]: parseFutureDate(data[0 + 2]),
    [slugify(data[4])]: parseFutureDate(data[4 + 2]),
    [slugify(data[8])]: parseFutureDate(data[8 + 2]),
    [slugify(data[12])]: parseFutureDate(data[12 + 2]),
  };
}

function parseFutureDate(dateString) {
  const currentDate = new Date(); // Get the current date
  currentDate.setHours(10, 0, 0, 0);
  let futureDate = new Date(
    dateString + ' ' + currentDate.getFullYear() + ' 10:00:00'
  );

  if (futureDate < currentDate) {
    futureDate.setFullYear(currentDate.getFullYear() + 1);
  }

  return futureDate;
}

function slugify(text) {
  return text
    .toString() // Convert to string
    .toLowerCase() // Convert to lowercase
    .trim() // Remove leading/trailing spaces
    .replace(/\s+/g, '_') // Replace spaces with dashes
    .replace(/[^\w\_]+/g, '') // Remove all non-word characters
    .replace(/\_\_+/g, '_'); // Replace multiple dashes with a single dash
}
