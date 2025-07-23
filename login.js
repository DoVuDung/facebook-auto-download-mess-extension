const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // We want to manually login
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // Go to login page
  await page.goto('https://www.facebook.com/login');

  // Wait for user to login and 2FA manually
  console.log('Please login manually and complete 2FA. Then press ENTER in this terminal.');
  process.stdin.once('data', async () => {
    // Save cookies
    const cookies = await page.cookies();
    await fs.writeJSON(path.resolve(__dirname, 'cookies.json'), cookies, { spaces: 2 });

    console.log(' Cookies saved. You can now run `scrape.js`');
    await browser.close();
    process.exit();
  });
})();
