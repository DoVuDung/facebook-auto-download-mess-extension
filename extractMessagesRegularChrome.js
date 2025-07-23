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
        // Try different container selectors
        containers: [
          '[role="row"]',
          '[data-testid="message_group"]',
          '[aria-label*="message"]',
          'div[dir="auto"]',
          '.x1n2onr6', // Facebook's generated class
        ],
        // Try different date header selectors
        dateHeaders: [
          'div[dir="auto"][aria-hidden="true"]',
          '[data-testid="message_timestamp"]',
          'div[role="separator"]',
          '.x1i10hfl.x1ejq31n',
        ],
        // Try different sender selectors
        senders: [
          'h4', 'h5', 'h3',
          '[data-testid="messenger_sender_name"]',
          'strong',
          '.x1heor9g',
        ],
        // Try different message selectors
        messages: [
          'div[dir="auto"]:not([aria-hidden="true"])',
          '[data-testid="messenger_message"]',
          'span[dir="auto"]',
          '.x193iq5w',
        ]
      };

      // First, try to find containers using multiple strategies
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

        // Try to find date headers
        for (const dateSelector of selectors.dateHeaders) {
          const dateHeader = node.querySelector(dateSelector);
          if (dateHeader && dateHeader.textContent && dateHeader.textContent.trim()) {
            const dateText = dateHeader.textContent.trim();
            // Check if it looks like a date
            if (dateText.match(/\d{1,2}\/\d{1,2}\/\d{4}|\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}|AM|PM/i)) {
              output.push({ type: 'date', content: dateText });
              node.remove();
              foundData = true;
              break;
            }
          }
        }

        if (foundData) continue;

        // Try to find messages
        let senderEl = null;
        let msgEl = null;

        // Find sender
        for (const senderSelector of selectors.senders) {
          senderEl = node.querySelector(senderSelector);
          if (senderEl && senderEl.textContent && senderEl.textContent.trim()) {
            break;
          }
        }

        // Find message
        for (const msgSelector of selectors.messages) {
          msgEl = node.querySelector(msgSelector);
          if (msgEl && msgEl.textContent && msgEl.textContent.trim()) {
            break;
          }
        }

        if (senderEl && msgEl) {
          const sender = senderEl.textContent.trim();
          const message = msgEl.textContent.trim();
          
          // Filter out very short or system-like messages
          if (message && sender && message.length > 1 && !message.match(/^[\s\u200B-\u200D\uFEFF]*$/)) {
            output.push({ type: 'message', sender, content: message });
            foundData = true;
          }
        }

        // If we found any data, remove the node to prevent memory leaks
        if (foundData) {
          node.remove();
        }
      }

      // Also try a fallback approach - look for any text content that might be messages
      if (output.length === 0) {
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const text = div.textContent?.trim();
          if (text && text.length > 10 && text.length < 1000) {
            // This might be a message, add it with unknown sender
            output.push({ type: 'message', sender: 'UNKNOWN', content: text });
            div.remove();
          }
        }
      }

      return output;
    });

    // Process and write the extracted data
    if (data.length > 0) {
      console.log(` Found ${data.length} items in this batch`);
      for (const item of data.reverse()) {
        if (item.type === 'date') {
          fs.appendFileSync(outputFile, `\n${item.content}\n\n`);
          console.log(`📅 Date: ${item.content}`);
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

    // Check if we've reached the end of the chat
    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === lastHeight) {
      console.log('Reached the beginning of the conversation.');
      endReached = true;
    } else {
      lastHeight = currentHeight;
      // Scroll up to load more messages
      await page.evaluate(() => {
        window.scrollBy(0, -1000); // Scroll up more aggressively
      });
      await new Promise(resolve => setTimeout(resolve, 2500)); // Wait for content to load
    }
  }

  console.log(` Chat history extraction completed!`);
  console.log(`📁 Total messages extracted: ${messageCount}`);
  console.log(`Chat saved to: ${outputFile}`);
  
  await browser.close();
  process.exit(0);
}

(async () => {
  // Option 2: Connect to existing Chrome browser
  console.log('🔧 Connecting to your existing Chrome browser...');
  console.log('Instructions:');
  console.log('   1. Open Chrome manually');
  console.log('   2. Start Chrome with debugging: chrome --remote-debugging-port=9222');
  console.log('   3. Navigate to Facebook Messenger in that Chrome');
  console.log('   4. Login and go to your conversation');
  console.log('   5. Then run this script');
  
  try {
    // Try to connect to existing Chrome instance
    browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222',
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    page = pages[0]; // Use the first tab
    
    console.log(' Connected to existing Chrome browser!');
    console.log('🌐 Current URL:', await page.url());
    
  } catch (error) {
    console.log(' Could not connect to existing Chrome.');
    console.log('💡 To use this method:');
    console.log('   1. Close all Chrome windows');
    console.log('   2. Run: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222');
    console.log('   3. Navigate to Facebook Messenger and login');
    console.log('   4. Then run this script again');
    console.log('');
    console.log('Falling back to regular browser launch...');
    
    // Fallback to regular launch
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      ]
    });

    page = await browser.newPage();
    
    console.log('🚀 Opening Facebook Messenger...');
    await page.goto('https://www.facebook.com/messages', { waitUntil: 'networkidle2' });
  }

  console.log('➡️ Please complete the login process and navigate to your conversation...');
  console.log('⏰ Take your time! Press Ctrl+C when you are ready to start extraction...');
  console.log('');
  console.log(' Make sure you can see the conversation messages before pressing Ctrl+C');
  
  // Set up signal handler for Ctrl+C to start extraction
  process.on('SIGINT', performExtraction);
  
  // Wait indefinitely until user presses Ctrl+C
  await new Promise(() => {}); // This will wait forever until Ctrl+C
  
})().catch(error => {
  console.error(' An error occurred:', error);
  if (browser) {
    browser.close();
  }
  process.exit(1);
});
