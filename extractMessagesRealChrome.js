const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let extractionStarted = false;
let browser, page;

async function performExtraction() {
  if (extractionStarted) return;
  extractionStarted = true;
  
  console.log('\nStarting message extraction...');
  
  // First, let's check what's available on the page
  console.log(' Analyzing page structure...');
  const pageInfo = await page.evaluate(() => {
    const info = {
      url: window.location.href,
      totalDivs: document.querySelectorAll('div').length,
      totalSpans: document.querySelectorAll('span').length,
      roleRows: document.querySelectorAll('[role="row"]').length,
      dirAuto: document.querySelectorAll('div[dir="auto"]').length,
      h4h5: document.querySelectorAll('h4, h5').length,
    };
    return info;
  });
  
  console.log(`Page analysis:`, pageInfo);
  
  const outputFile = path.join(__dirname, 'messenger_chat.txt');
  fs.writeFileSync(outputFile, ''); // clear old file
  console.log(`Chat will be saved to: ${outputFile}`);

  let lastHeight = 0;
  let endReached = false;
  let messageCount = 0;

  while (!endReached) {
    const data = await page.evaluate(() => {
      const output = [];

      // Multiple selector strategies for better compatibility
      const selectors = {
        containers: [
          '[role="row"]',
          '[data-testid="message_group"]',
          '[aria-label*="message"]',
          'div[dir="auto"]',
          '.x1n2onr6',
        ],
        dateHeaders: [
          'div[dir="auto"][aria-hidden="true"]',
          '[data-testid="message_timestamp"]',
          'div[role="separator"]',
          '.x1i10hfl.x1ejq31n',
        ],
        senders: [
          'h4', 'h5', 'h3',
          '[data-testid="messenger_sender_name"]',
          'strong',
          '.x1heor9g',
        ],
        messages: [
          'div[dir="auto"]:not([aria-hidden="true"])',
          '[data-testid="messenger_message"]',
          'span[dir="auto"]',
          '.x193iq5w',
        ]
      };

      let containers = [];
      for (const selector of selectors.containers) {
        containers = document.querySelectorAll(selector);
        if (containers.length > 0) {
          console.log(`Found ${containers.length} containers with selector: ${selector}`);
          break;
        }
      }

      if (containers.length === 0) {
        console.log('No message containers found with any selector');
        return output;
      }

      for (const node of containers) {
        let foundData = false;

        for (const dateSelector of selectors.dateHeaders) {
          const dateHeader = node.querySelector(dateSelector);
          if (dateHeader && dateHeader.textContent && dateHeader.textContent.trim()) {
            const dateText = dateHeader.textContent.trim();
            if (dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}|\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}|AM|PM/i)) {
              output.push({ type: 'date', content: dateText });
              node.remove();
              foundData = true;
              break;
            }
          }
        }

        if (foundData) continue;

        let senderEl = null;
        let msgEl = null;

        for (const senderSelector of selectors.senders) {
          senderEl = node.querySelector(senderSelector);
          if (senderEl && senderEl.textContent && senderEl.textContent.trim()) {
            break;
          }
        }

        for (const msgSelector of selectors.messages) {
          msgEl = node.querySelector(msgSelector);
          if (msgEl && msgEl.textContent && msgEl.textContent.trim()) {
            break;
          }
        }

        if (senderEl && msgEl) {
          const sender = senderEl.textContent.trim();
          const message = msgEl.textContent.trim();
          
          if (message && sender && message.length > 1 && !message.match(/^[\s\u200B-\u200D\uFEFF]*$/)) {
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
      console.log(` Found ${data.length} items in this batch`);
      for (const item of data.reverse()) {
        if (item.type === 'date') {
          fs.appendFileSync(outputFile, `\n${item.content}\n\n`);
          console.log(`Date: ${item.content}`);
        } else {
          fs.appendFileSync(outputFile, `${item.sender.toUpperCase()}: ${item.content}\n`);
          messageCount++;
          if (messageCount % 5 === 0) {
            console.log(`Extracted ${messageCount} messages...`);
          }
        }
      }
    } else {
      console.log('  No new messages found in this batch');
    }

    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === lastHeight) {
      console.log('Reached the beginning of the conversation.');
      endReached = true;
    } else {
      lastHeight = currentHeight;
      await page.evaluate(() => {
        window.scrollBy(0, -1000);
      });
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }

  console.log(` Chat history extraction completed!`);
  console.log(`📁 Total messages extracted: ${messageCount}`);
  console.log(`Chat saved to: ${outputFile}`);
  
  await browser.disconnect(); // Don't close, just disconnect
  process.exit(0);
}

(async () => {
  console.log('🌐 CONNECTING TO YOUR REGULAR CHROME BROWSER');
  console.log('');
  console.log('FIRST, you need to start Chrome with debugging enabled:');
  console.log('   1. Close ALL Chrome windows completely');
  console.log('   2. Open Terminal and run this command:');
  console.log('      /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug');
  console.log('   3. Login to Facebook and navigate to your Messenger conversation');
  console.log('   4. Make sure you can see the messages');
  console.log('   5. Come back to this terminal and press ENTER to continue');
  console.log('');
  
  // Wait for user to press Enter
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    
    try {
      console.log('🔗 Attempting to connect to your Chrome browser...');
      
      browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: null
      });
      
      const pages = await browser.pages();
      
      if (pages.length === 0) {
        console.log(' No tabs found. Please open Facebook Messenger in Chrome first.');
        process.exit(1);
      }
      
      // Find the Facebook/Messenger page
      let messengerPage = null;
      for (const p of pages) {
        const url = await p.url();
        if (url.includes('facebook.com') || url.includes('messenger.com')) {
          messengerPage = p;
          break;
        }
      }
      
      if (!messengerPage) {
        console.log('  No Facebook/Messenger tab found. Using the first tab...');
        page = pages[0];
      } else {
        page = messengerPage;
      }
      
      const currentUrl = await page.url();
      console.log(' Connected to your Chrome browser!');
      console.log(`🌐 Current page: ${currentUrl}`);
      
      if (!currentUrl.includes('facebook.com') && !currentUrl.includes('messenger.com')) {
        console.log('  Please navigate to Facebook Messenger in this Chrome window');
        console.log('   Then press Ctrl+C to start extraction');
      } else {
        console.log(' Great! You\'re on Facebook/Messenger');
        console.log('Make sure you can see the conversation messages');
        console.log('⌨️  Press Ctrl+C to start extraction');
      }
      
      // Set up signal handler for Ctrl+C to start extraction
      process.on('SIGINT', performExtraction);
      
      // Wait indefinitely until user presses Ctrl+C
      await new Promise(() => {});
      
    } catch (error) {
      console.log(' Could not connect to Chrome browser.');
      console.log('💡 Make sure you:');
      console.log('   1. Closed all Chrome windows first');
      console.log('   2. Started Chrome with the exact command shown above');
      console.log('   3. Chrome is running on port 9222');
      console.log('');
      console.log('Error details:', error.message);
      process.exit(1);
    }
  });
  
})().catch(error => {
  console.error(' An error occurred:', error);
  process.exit(1);
});
