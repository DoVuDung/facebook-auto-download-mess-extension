const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  console.log('🚀 Starting Facebook Messenger scraper...');
  
  const browser = await puppeteer.launch({
    headless: false, // to allow manual login
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();
  
  // Set user agent to avoid detection
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
  
  console.log('📨 Opening Facebook Messenger...');
  await page.goto('https://www.facebook.com/messages', { waitUntil: 'networkidle2' });

  console.log('🔐 Please login manually and open the specific Messenger chat.');
  console.log('⏰ You have 60 seconds to login and navigate to your conversation...');
  console.log('💡 Take your time - extend the delay if needed!');
  
  await delay(60000); // wait 60 seconds for manual login and chat open

  const outputFile = path.join(__dirname, 'messages_output.txt');
  fs.writeFileSync(outputFile, ''); // clear old data
  console.log(`Output will be saved to: ${outputFile}`);

  let lastHeight = 0;
  let reachedTop = false;
  let messageCount = 0;
  let iterationCount = 0;

  console.log('Starting message extraction...');
  console.log('This may take a while depending on your chat history...');

  while (!reachedTop) {
    iterationCount++;
    console.log(` Extraction batch #${iterationCount}...`);
    
    const messages = await page.evaluate(() => {
      const data = [];
      const headers = [];

      // Try multiple strategies to find message containers
      const selectors = [
        '[role="main"]',
        '[data-pagelet="MWJewelThreadList"]', 
        'div[aria-label*="Messages"]',
        '[data-testid="mwthreadlist-item"]'
      ];
      
      let container = null;
      for (const selector of selectors) {
        container = document.querySelector(selector);
        if (container) break;
      }
      
      if (!container) {
        console.log(' Could not find message container');
        return { messages: [], headers: [] };
      }

      // Look for messages with multiple selector strategies
      const messageSelectors = [
        'div[dir="auto"]',
        '[data-testid="message"]',
        'span[dir="auto"]',
        'div[aria-describedby]'
      ];
      
      let nodes = [];
      for (const selector of messageSelectors) {
        nodes = container.querySelectorAll(selector);
        if (nodes.length > 0) break;
      }

      nodes.forEach((node) => {
        const text = node.textContent?.trim();
        if (!text || text.length < 2) return;
        
        // Try to find the parent with sender info
        const parent = node.closest('[data-scope]') || 
                     node.closest('[aria-label]') || 
                     node.closest('div[dir="auto"]');
                     
        if (text && parent) {
          const ariaLabel = parent.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.includes('·')) {
            const [sender, time] = ariaLabel.split(' · ');
            data.push(`${sender?.toUpperCase() || 'UNKNOWN'}: ${text}`);
          } else {
            // Fallback - try to find sender in nearby elements
            const senderEl = parent.querySelector('strong, h4, h5') || 
                           parent.previousElementSibling?.querySelector('strong, h4, h5');
            const sender = senderEl?.textContent?.trim() || 'UNKNOWN';
            data.push(`${sender.toUpperCase()}: ${text}`);
          }
        }
      });

      // Get date headers with multiple strategies
      const dateSelectors = [
        'div[aria-label][role="heading"]',
        '[data-testid="message_timestamp"]',
        'div[role="separator"]',
        'div[aria-hidden="true"][dir="auto"]'
      ];
      
      for (const selector of dateSelectors) {
        const dateElements = document.querySelectorAll(selector);
        dateElements.forEach(el => {
          const text = el.textContent?.trim();
          // Check if it looks like a date
          if (text && text.match(/\d{1,2}\/\d{1,2}\/\d{4}|\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}:\d{2}|AM|PM/i)) {
            headers.push(text);
          }
        });
      }

      return { messages: data, headers: [...new Set(headers)] }; // Remove duplicates
    });

    // Write headers first
    if (messages.headers.length) {
      console.log(`📅 Found ${messages.headers.length} date headers`);
      messages.headers.forEach(header => {
        fs.appendFileSync(outputFile, `\n${header}\n\n`);
      });
    }
    
    // Write messages
    if (messages.messages.length) {
      console.log(`💬 Found ${messages.messages.length} messages in this batch`);
      messages.messages.forEach((msg) => {
        fs.appendFileSync(outputFile, `${msg}\n`);
        messageCount++;
      });
      
      if (messageCount % 10 === 0) {
        console.log(`Total messages extracted so far: ${messageCount}`);
      }
    } else {
      console.log('  No messages found in this batch');
    }

    // Clear processed elements from DOM to prevent memory issues
    await page.evaluate(() => {
      // More targeted DOM cleanup
      const containers = document.querySelectorAll('[role="main"] div[dir="auto"]');
      containers.forEach(el => {
        if (el.textContent && el.textContent.trim()) {
          el.remove();
        }
      });
    });

    // Scroll up to load earlier messages
    await page.evaluate(() => {
      window.scrollBy(0, -800); // Scroll up more aggressively
    });

    console.log('⏳ Waiting for new content to load...');
    await delay(3000); // Wait longer for content to load

    const currentHeight = await page.evaluate('document.body.scrollHeight');
    if (currentHeight === lastHeight) {
      console.log('Reached the top of the conversation');
      reachedTop = true;
    } else {
      console.log(`📏 Page height changed: ${lastHeight} → ${currentHeight}`);
    }
    lastHeight = currentHeight;
    
    // Safety check - don't run forever
    if (iterationCount > 100) {
      console.log('  Stopping after 100 iterations to prevent infinite loop');
      reachedTop = true;
    }
  }

  console.log(` Extraction completed!`);
  console.log(`📁 Total messages extracted: ${messageCount}`);
  console.log(`Total batches processed: ${iterationCount}`);
  console.log(`Messages saved to: ${outputFile}`);
  
  await browser.close();
})().catch(error => {
  console.error(' An error occurred:', error);
  process.exit(1);
});
