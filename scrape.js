const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

const MESSENGER_URL = 'https://www.facebook.com/messages/t/<YOUR_THREAD_ID>'; // Replace <YOUR_THREAD_ID>

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  const page = await browser.newPage();

  // Load saved cookies
  const cookiesPath = path.resolve(__dirname, 'cookies.json');
  const cookies = await fs.readJSON(cookiesPath);
  await page.setCookie(...cookies);

  await page.goto(MESSENGER_URL, { waitUntil: 'networkidle2' });

  // Wait for messages container to load
  await page.waitForSelector('[role="log"]', { timeout: 15000 });

  const outputFile = path.resolve(__dirname, 'messages.txt');
  const seenMessages = new Set();
  await fs.ensureFile(outputFile);
  await fs.writeFile(outputFile, ''); // Clear file

  let prevHeight = 0;
  let finished = false;

  while (!finished) {
    const messages = await page.evaluate(() => {
      const output = [];
      const container = document.querySelector('[role="log"]');
      if (!container) return output;

      const children = Array.from(container.children);
      for (const el of children) {
        const text = el.innerText;
        if (!text) continue;

        // Distinguish date headers and messages
        if (el.querySelector('[aria-label*="Message timestamp"]') || /^\w+ \d{1,2}, \d{4}/.test(text)) {
          output.push({ type: 'date', text: text.trim() });
        } else {
          const spans = el.querySelectorAll('span');
          if (spans.length >= 2) {
            const name = spans[0]?.innerText?.trim();
            const msg = spans[1]?.innerText?.trim();
            if (name && msg) {
              output.push({ type: 'msg', text: `${name}: ${msg}` });
            }
          }
        }

        el.remove(); // Clear DOM to prevent memory issues
      }

      return output;
    });

    for (const item of messages) {
      if (!seenMessages.has(item.text)) {
        await fs.appendFile(outputFile, item.text + '\n');
        seenMessages.add(item.text);
      }
    }

    const scrollHeight = await page.evaluate(() => {
      const container = document.querySelector('[role="log"]');
      container.scrollBy(0, -500); // Scroll up
      return container.scrollHeight;
    });

    await new Promise((res) => setTimeout(res, 1000));

    if (scrollHeight === prevHeight) {
      finished = true;
    } else {
      prevHeight = scrollHeight;
    }
  }

  console.log(' Done scraping. Check messages.txt');
  await browser.close();
})();
