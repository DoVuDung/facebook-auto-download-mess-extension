const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let extractionStarted = false;
let browser, page;

async function performExtraction() {
  if (extractionStarted) return;
  extractionStarted = true;
  
  console.log('\nStarting message extraction...');
  
  const outputFile = path.join(__dirname, 'messenger_chat.txt');
  fs.writeFileSync(outputFile, '');
  console.log(`Output will be saved to: ${outputFile}`);

  let lastHeight = 0;
  let endReached = false;
  let messageCount = 0;
  let batchCount = 0;

  while (!endReached) {
    batchCount++;
    console.log(` Processing batch #${batchCount}...`);
    
    const data = await page.evaluate(() => {
      const output = [];

      // Try multiple selectors for message containers
      const containerSelectors = [
        '[role="row"]',
        '[data-testid="message_container"]',
        'div[dir="auto"]',
        '[aria-label*="message"]'
      ];
      
      let containers = [];
      for (const selector of containerSelectors) {
        containers = document.querySelectorAll(selector);
        if (containers.length > 0) {
          break;
        }
      }

      for (const node of containers) {
        let foundData = false;

        // Look for date headers
        const dateSelectors = [
          'div[dir="auto"][aria-hidden="true"]',
          '[data-testid="message_timestamp"]',
          'div[role="separator"]'
        ];
        
        for (const dateSelector of dateSelectors) {
          const dateHeader = node.querySelector(dateSelector);
          if (dateHeader && dateHeader.textContent.trim()) {
            const dateText = dateHeader.textContent.trim();
            if (dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}|\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}|AM|PM/i)) {
              output.push({ type: 'date', content: dateText });
              foundData = true;
              break;
            }
          }
        }

        if (foundData) {
          node.remove();
          continue;
        }

        // Look for messages
        const senderSelectors = ['h4', 'h5', 'h3', 'strong'];
        const messageSelectors = [
          'div[dir="auto"]:not([aria-hidden="true"])',
          'span[dir="auto"]',
          '[data-testid="message_text"]'
        ];

        let senderEl = null;
        let msgEl = null;

        for (const selector of senderSelectors) {
          senderEl = node.querySelector(selector);
          if (senderEl && senderEl.textContent.trim()) break;
        }

        for (const selector of messageSelectors) {
          msgEl = node.querySelector(selector);
          if (msgEl && msgEl.textContent.trim()) break;
        }

        if (senderEl && msgEl) {
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
      console.log(`Found ${data.length} items in this batch`);
      for (const item of data.reverse()) {
        if (item.type === 'date') {
          fs.appendFileSync(outputFile, `\n${item.content}\n\n`);
          console.log(`${item.content}`);
        } else {
          fs.appendFileSync(outputFile, `${item.sender.toUpperCase()}: ${item.content}\n`);
          messageCount++;
        }
      }
      console.log(`Total messages so far: ${messageCount}`);
    } else {
      console.log(' No new messages found in this batch');
    }

    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === lastHeight) {
      console.log('Reached the beginning of the conversation');
      endReached = true;
    } else {
      lastHeight = currentHeight;
      await page.evaluate(() => window.scrollBy(0, -1000));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Safety break
    if (batchCount > 200) {
      console.log(' Reached maximum batches (200) - stopping to prevent infinite loop');
      endReached = true;
    }
  }

  console.log(`🎉 Extraction complete!`);
  console.log(`📁 Total messages extracted: ${messageCount}`);
  console.log(`Total batches processed: ${batchCount}`);
  console.log(`Saved to: ${outputFile}`);
  
  await browser.disconnect();
  process.exit(0);
}

(async () => {
  console.log('🌐 CONNECTING TO YOUR EXISTING CHROME BROWSER');
  console.log('');
  console.log('SIMPLE SETUP - Just 3 steps:');
  console.log('');
  console.log('1️⃣ In your EXISTING Chrome browser:');
  console.log('   • Make sure you\'re logged into Facebook');
  console.log('   • Go to facebook.com/messages');
  console.log('   • Open the conversation you want to extract');
  console.log('   • Make sure you can see the messages');
  console.log('');
  console.log('2️⃣ Keep that Chrome window open and come back here');
  console.log('');
  console.log('3️⃣ Restart Chrome with debugging enabled:');
  console.log('   • Close Chrome completely (Cmd+Q)');
  console.log('   • Open Terminal and run:');
  console.log('     /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
  console.log('   • This will reopen Chrome with your same session');
  console.log('   • Navigate back to your Messenger conversation');
  console.log('');
  console.log('4️⃣ Press ENTER here when Chrome is ready');
  console.log('');
  console.log('💡 Your login session will be preserved!');
  console.log('');
  
  // Wait for user input
  process.stdin.setRawMode(true);
  process.stdin.resume();
  
  await new Promise((resolve) => {
    process.stdin.once('data', async () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      
      try {
        console.log('🔗 Attempting to connect to Chrome...');
        
        browser = await puppeteer.connect({
          browserURL: 'http://localhost:9222',
          defaultViewport: null
        });
        
        const pages = await browser.pages();
        
        if (pages.length === 0) {
          throw new Error('No browser pages found');
        }
        
        // Find Facebook page or use the active one
        let facebookPage = null;
        for (const p of pages) {
          try {
            const url = await p.url();
            if (url.includes('facebook.com') || url.includes('messenger.com')) {
              facebookPage = p;
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        page = facebookPage || pages[pages.length - 1];
        
        const currentUrl = await page.url();
        console.log(' Successfully connected to Chrome!');
        console.log(`🌐 Current page: ${currentUrl}`);
        
        if (!currentUrl.includes('facebook.com') && !currentUrl.includes('messenger.com')) {
          console.log('');
          console.log(' You\'re not on Facebook yet. Please:');
          console.log('   1. Navigate to facebook.com/messages in Chrome');
          console.log('   2. Open your conversation');
          console.log('   3. Press Ctrl+C here when ready');
        } else {
          console.log('');
          console.log(' Perfect! You\'re on Facebook/Messenger');
          console.log('🎯 Make sure you can see your conversation messages');
          console.log('⌨️ Press Ctrl+C to start extracting messages');
        }
        
        process.on('SIGINT', performExtraction);
        resolve();
        
      } catch (error) {
        console.log('');
        console.log(' Connection failed!');
        console.log('');
        console.log('🔧 Quick fix:');
        console.log('1. Make sure Chrome is running with the debugging command');
        console.log('2. Check if you see "DevTools listening on ws://..." when Chrome starts');
        console.log('3. Try the command again if not');
        console.log('');
        console.log(`Error: ${error.message}`);
        process.exit(1);
      }
    });
  });
  
  // Wait for Ctrl+C
  await new Promise(() => {});
  
})().catch(async (err) => {
  console.error(' Error occurred:', err);
  if (browser) {
    try {
      await browser.disconnect();
    } catch (e) {}
  }
  process.exit(1);
});
