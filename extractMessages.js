const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

let extractionStarted = false;
let browser, page;

async function performExtraction() {
  if (extractionStarted) return;
  extractionStarted = true;

  console.log('\nStarting message extraction...');

  const outputFile = path.join(__dirname, 'messenger_chat.txt');
  fs.writeFileSync(outputFile, '');

  let lastHeight = 0;
  let endReached = false;
  let messageCount = 0;

  while (!endReached) {
    const data = await page.evaluate(() => {
      const output = [];

      const containers = document.querySelectorAll('[role="row"]');
      for (const node of containers) {
        let foundData = false;

        const dateHeader = node.querySelector('div[dir="auto"][aria-hidden="true"]');
        if (dateHeader && dateHeader.textContent.trim()) {
          const dateText = dateHeader.textContent.trim();
          output.push({ type: 'date', content: dateText });
          node.remove();
          foundData = true;
        }

        if (foundData) continue;

        const senderEl = node.querySelector('h4, h5');
        const msgEl = node.querySelector('div[dir="auto"]:not([aria-hidden="true"])');

        if (senderEl && msgEl && senderEl.textContent && msgEl.textContent) {
          const sender = senderEl.textContent.trim();
          const message = msgEl.textContent.trim();
          if (sender && message && message.length > 1) {
            output.push({ type: 'message', sender, content: message });
            foundData = true;
          }
        }

        if (foundData) {
          node.remove();
        }
      }

      return output;
    });

    if (data.length > 0) {
      console.log(`Extracted ${data.length} items`);
      for (const item of data.reverse()) {
        if (item.type === 'date') {
          fs.appendFileSync(outputFile, `\n${item.content}\n\n`);
          console.log(`📅 ${item.content}`);
        } else {
          fs.appendFileSync(outputFile, `${item.sender.toUpperCase()}: ${item.content}\n`);
          messageCount++;
        }
      }
    } else {
      console.log(' No new messages found in this batch');
    }

    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === lastHeight) {
      endReached = true;
      console.log(' Reached the beginning of the chat');
    } else {
      lastHeight = currentHeight;
      await page.evaluate(() => window.scrollBy(0, -1000));
      await page.waitForTimeout(2500);
    }
  }

  console.log(`🎉 Extraction complete! Total messages: ${messageCount}`);
  console.log(`Saved to: ${outputFile}`);
  await browser.disconnect(); // Don't close the browser, just disconnect
  process.exit(0);
}

(async () => {
  console.log('🌐 CONNECTING TO YOUR REAL CHROME BROWSER');
  console.log('');
  console.log('SETUP STEPS:');
  console.log('1. Close ALL Chrome windows completely');
  console.log('2. Open Terminal and run this command:');
  console.log('   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/chrome-debug"');
  console.log('3. In that Chrome window:');
  console.log('   - Login to Facebook normally');
  console.log('   - Go to facebook.com/messages');
  console.log('   - Open your specific conversation');
  console.log('   - Make sure you can see the messages');
  console.log('4. Come back here and press ENTER to connect');
  console.log('');
  
  // Wait for user to press Enter
  process.stdin.setRawMode(true);
  process.stdin.resume();
  
  await new Promise((resolve) => {
    process.stdin.on('data', async () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      
      try {
        console.log('🔗 Connecting to your Chrome browser...');
        
        browser = await puppeteer.connect({
          browserURL: 'http://localhost:9222',
          defaultViewport: null
        });
        
        const pages = await browser.pages();
        
        if (pages.length === 0) {
          console.log(' No tabs found. Please open Facebook Messenger in Chrome first.');
          process.exit(1);
        }
        
        // Find Facebook/Messenger page
        let messengerPage = null;
        for (const p of pages) {
          const url = await p.url();
          if (url.includes('facebook.com') || url.includes('messenger.com')) {
            messengerPage = p;
            break;
          }
        }
        
        if (!messengerPage) {
          console.log(' No Facebook/Messenger tab found. Using the active tab...');
          page = pages[pages.length - 1]; // Use the last (most recent) tab
        } else {
          page = messengerPage;
        }
        
        const currentUrl = await page.url();
        console.log(' Connected to your Chrome browser!');
        console.log(`🌐 Current page: ${currentUrl}`);
        
        if (!currentUrl.includes('facebook.com') && !currentUrl.includes('messenger.com')) {
          console.log(' Please navigate to Facebook Messenger in this Chrome window');
          console.log('Then press Ctrl+C to start extraction');
        } else {
          console.log(' Perfect! You\'re on Facebook/Messenger');
          console.log('Make sure you can see the conversation messages');
          console.log('⌨️ Press Ctrl+C to start extraction');
        }
        
        // Set up signal handler for Ctrl+C
        process.on('SIGINT', performExtraction);
        
        resolve();
        
      } catch (error) {
        console.log(' Could not connect to Chrome browser.');
        console.log('💡 Make sure you:');
        console.log('1. Closed all Chrome windows first');
        console.log('2. Started Chrome with the exact command shown above');
        console.log('3. Chrome is running with debugging enabled');
        console.log('');
        console.log('Error details:', error.message);
        process.exit(1);
      }
    });
  });
  
  // Wait indefinitely for Ctrl+C
  await new Promise(() => {});
})().catch(async (err) => {
  console.error(' Error occurred:', err);
  if (browser) {
    try {
      await browser.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
  }
  process.exit(1);
});
