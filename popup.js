let isExporting = false;
let currentTab = null;

// DOM elements
const statusDiv = document.getElementById('status');
const checkStatusBtn = document.getElementById('checkStatus');
const startExportBtn = document.getElementById('startExport');
const stopExportBtn = document.getElementById('stopExport');
const progressDiv = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');

// Settings
const includeDatesCheckbox = document.getElementById('includeDates');
const includeTimestampsCheckbox = document.getElementById('includeTimestamps');
const clearDOMCheckbox = document.getElementById('clearDOM');

// Show status message
function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

// Update progress
function updateProgress(percent) {
  progressBar.style.width = `${percent}%`;
}

// Check if user is on Facebook Messenger
async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    if (!tab.url.includes('facebook.com') && !tab.url.includes('messenger.com')) {
      showStatus('Please open Facebook Messenger first', 'error');
      startExportBtn.disabled = true;
      return false;
    }
    
    if (!tab.url.includes('/messages') && !tab.url.includes('/t/')) {
      showStatus('Please open a specific conversation', 'error');
      startExportBtn.disabled = true;
      return false;
    }
    
    showStatus('Ready to export this conversation!', 'success');
    startExportBtn.disabled = false;
    return true;
    
  } catch (error) {
    showStatus('Error checking page', 'error');
    startExportBtn.disabled = true;
    return false;
  }
}

// Start export process
async function startExport() {
  if (isExporting) return;
  
  isExporting = true;
  startExportBtn.style.display = 'none';
  stopExportBtn.style.display = 'block';
  progressDiv.style.display = 'block';
  
  showStatus('🚀 Starting export...', 'info');
  
  const settings = {
    includeDates: includeDatesCheckbox.checked,
    includeTimestamps: includeTimestampsCheckbox.checked,
    clearDOM: clearDOMCheckbox.checked
  };
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: exportMessages,
      args: [settings]
    });
    
  } catch (error) {
    showStatus('Export failed: ' + error.message, 'error');
    resetUI();
  }
}

// Stop export process
function stopExport() {
  isExporting = false;
  resetUI();
  showStatus('Export stopped', 'info');
}

// Reset UI to initial state
function resetUI() {
  isExporting = false;
  startExportBtn.style.display = 'block';
  stopExportBtn.style.display = 'none';
  progressDiv.style.display = 'none';
  updateProgress(0);
}

// This function will be injected into the page
function exportMessages(settings) {
  return new Promise((resolve, reject) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const messages = [];
    let batchCount = 0;
    let totalMessages = 0;
    const maxBatches = 300; // Safety limit - can extract more messages
    
    console.log('Starting Messenger extraction with requirements:');
    console.log('1. Scroll backwards through chat');
    console.log('2. Extract each message to plain text');
    console.log('3. Include sender name at start of each line');
    console.log('4. Include date headers like "Jul 11, 2025, 5:35 PM"');
    console.log('5. Clear DOM to prevent memory leaks');
    
    // Send progress updates back to popup
    function updateProgress(batch, total) {
      const percent = Math.min((batch / maxBatches) * 100, 100);
      chrome.runtime.sendMessage({
        type: 'progress',
        batch: batch,
        total: total,
        percent: percent
      });
    }
    
    // Enhanced message extraction with better selectors
    function extractMessagesFromDOM() {
      const foundItems = [];
      
      console.log('Starting message extraction...');
      console.log('Current URL:', window.location.href);
      console.log('Page title:', document.title);
      
      // First scroll to very top to ensure we get everything
      window.scrollTo(0, 0);
      
      // SUPER AGGRESSIVE: Let's find ANY possible container
      console.log('PHASE 1: Checking all possible containers...');
      const allPossibleContainers = [];
      
      // Standard selectors
      const standardSelectors = [
        '[aria-label="Message list"]',
        '[aria-label="Messages"]', 
        '[role="log"]',
        '[data-testid="conversation-viewer"]',
        '[data-testid="message-container"]',
        'div[style*="overflow"]',
        '[data-pagelet="MessengerDotCom"]',
        '[data-pagelet*="messenger"]',
        '[data-pagelet*="chat"]'
      ];
      
      for (const selector of standardSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          allPossibleContainers.push({element: el, source: `Standard: ${selector}`});
          console.log(`Found container via: ${selector}`);
        }
      }
      
      // Aggressive fallback: any div with many child divs
      const allDivs = document.querySelectorAll('div');
      console.log(`PHASE 2: Checking ${allDivs.length} divs for message patterns...`);
      
      for (const div of allDivs) {
        const childDivs = div.querySelectorAll('div[dir="auto"], [role="row"]');
        if (childDivs.length > 10) {
          allPossibleContainers.push({element: div, source: `Fallback: div with ${childDivs.length} children`});
          console.log(`Found potential container: div with ${childDivs.length} message-like children`);
        }
      }
      
      const messageContainers = allPossibleContainers.map(c => c.element).filter(Boolean);
      
      console.log(`Found ${messageContainers.length} potential message containers`);
      console.log('Container details:', allPossibleContainers.map(c => c.source));
      
      if (messageContainers.length === 0) {
        console.error('COMPLETE FAILURE: No message container found!');
        console.error('Debug info:');
        console.error('- Total divs on page:', document.querySelectorAll('div').length);
        console.error('- Divs with dir="auto":', document.querySelectorAll('div[dir="auto"]').length);
        console.error('- Elements with role="row":', document.querySelectorAll('[role="row"]').length);
        console.error('- Elements with aria-label containing "message":', document.querySelectorAll('[aria-label*="message" i]').length);
        console.error('PLEASE COPY THIS DEBUG INFO TO HELP FIX THE ISSUE!');
        chrome.runtime.sendMessage({
          type: 'error',
          error: 'No message container found. Please copy the console debug info and share it.'
        });
        return [];
      }
      
      const container = messageContainers[0];
      console.log('Using container:', container.getAttribute('aria-label') || container.className || 'unnamed container');
      
      // UPDATED: More comprehensive message element detection
      const messageSelectors = [
        'div[role="row"]',
        'div[data-testid*="message"]',
        'div[aria-describedby]',
        'div[dir="auto"]',
        '[data-testid="message_bubble"]',
        '[data-testid="message-container"]',
        // Look for elements that contain text and have sender info
        'div:has(strong):has(span)',
        'div:has(h4):has(div[dir="auto"])',
        'div:has(h5):has(div[dir="auto"])'
      ];
      
      let messageElements = [];
      for (const selector of messageSelectors) {
        try {
          const elements = container.querySelectorAll(selector);
          if (elements.length > messageElements.length) {
            messageElements = Array.from(elements);
            console.log(`Using selector "${selector}" found ${elements.length} elements`);
            break;
          }
        } catch (e) {
          console.warn(`Selector failed: ${selector}`, e);
        }
      }
      
      // Fallback: if no specific selectors work, get all divs and filter
      if (messageElements.length === 0) {
        console.log('Fallback: searching all divs for message patterns...');
        messageElements = Array.from(container.querySelectorAll('div')).filter(div => {
          const text = div.textContent?.trim();
          const hasStrongElement = div.querySelector('strong, h3, h4, h5');
          const hasTextContent = text && text.length > 10 && text.length < 1000;
          return hasStrongElement && hasTextContent;
        });
      }
      
      console.log(`Processing ${messageElements.length} potential message elements`);
      
      for (const element of messageElements) {
        try {
          // UPDATED: Better date detection
          const dateSelectors = [
            'div[aria-label][tabindex]',
            'div[role="heading"]', 
            'div[aria-hidden="true"]',
            'span[aria-hidden="true"]',
            'div[data-testid*="timestamp"]',
            'div[data-testid*="date"]'
          ];
          
          for (const selector of dateSelectors) {
            const dateElement = element.querySelector(selector);
            if (dateElement) {
              const dateText = dateElement.textContent.trim();
              // Enhanced date pattern matching
              if (dateText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/i)) {
                foundItems.push({
                  type: 'date',
                  content: dateText,
                  element: element
                });
                continue;
              }
            }
          }
          
          // UPDATED: More comprehensive sender and message detection
          const senderSelectors = [
            'h4 strong', 'h5 strong', 'h3 strong', 'h2 strong',
            'strong[dir="auto"]', 'strong',
            'span[dir="auto"] strong',
            'div[dir="auto"] strong',
            '[data-testid*="sender"]',
            '[data-testid*="name"]'
          ];
          
          const messageSelectors = [
            'div[dir="auto"]:not([aria-hidden])',
            'span[dir="auto"]',
            '[data-testid="message_text"]',
            '[data-testid*="message"]',
            'div[data-testid*="text"]',
            // Look for any element with substantial text content
            'div:not(:has(strong)):not(:has(h1,h2,h3,h4,h5))'
          ];
          
          let senderEl = null;
          let msgEl = null;
          
          // Find sender with more flexible approach
          for (const selector of senderSelectors) {
            senderEl = element.querySelector(selector);
            if (senderEl && senderEl.textContent.trim() && senderEl.textContent.trim().length < 50) {
              break;
            }
          }
          
          // Find message with more flexible approach  
          for (const selector of messageSelectors) {
            const candidates = element.querySelectorAll(selector);
            for (const candidate of candidates) {
              const text = candidate.textContent.trim();
              // Good message: has text, not too short, not too long, not same as sender
              if (text && text.length > 1 && text.length < 2000 && 
                  (!senderEl || text !== senderEl.textContent.trim())) {
                msgEl = candidate;
                break;
              }
            }
            if (msgEl) break;
          }
          
          if (senderEl && msgEl) {
            const senderName = senderEl.textContent.trim();
            const messageContent = msgEl.textContent.trim();
            
            // Validate we have good content
            if (senderName && messageContent && 
                messageContent.length > 1 && 
                senderName.length < 100 && 
                messageContent !== senderName) {
              foundItems.push({
                type: 'message',
                sender: senderName,
                content: messageContent,
                element: element
              });
              console.log(`Found message: ${senderName}: ${messageContent.substring(0, 50)}...`);
            }
          }
          
        } catch (error) {
          console.warn('Error processing element:', error);
        }
      }
      
      console.log(`Extraction results: ${foundItems.filter(i => i.type === 'message').length} messages, ${foundItems.filter(i => i.type === 'date').length} dates`);
      
      // REQUIREMENT 6: Clear DOM to prevent memory leaks
      if (settings.clearDOM && foundItems.length > 0) {
        foundItems.forEach(item => {
          if (item.element && item.element.parentNode) {
            item.element.remove();
          }
        });
        console.log(`Cleared ${foundItems.length} DOM elements to prevent memory leaks`);
      }
      
      return foundItems;
    }    // REQUIREMENT 1: Main scrolling and extraction loop
    async function scrollAndExtract() {
      try {
        let previousHeight = 0;
        let stuckCount = 0;
        
        while (batchCount < maxBatches && stuckCount < 5) {
          batchCount++;
          console.log(` Batch ${batchCount}: Scrolling backwards and extracting...`);
          
          // Extract messages from current view
          const batchItems = extractMessagesFromDOM();
          
          if (batchItems.length > 0) {
            // Add to beginning to maintain chronological order (oldest first)
            messages.unshift(...batchItems.reverse());
            const messageCount = batchItems.filter(item => item.type === 'message').length;
            totalMessages += messageCount;
            console.log(` Extracted ${messageCount} messages, ${batchItems.filter(item => item.type === 'date').length} date headers`);
            stuckCount = 0; // Reset stuck counter
          }
          
          updateProgress(batchCount, totalMessages);
          
          // REQUIREMENT 1: Scroll backwards (up) to load more messages
          const currentHeight = document.documentElement.scrollHeight;
          
          // Scroll to top aggressively
          window.scrollTo(0, 0);
          await sleep(1500); // Wait for Facebook to load more content
          
          // Try additional scrolling methods if needed
          const messageContainer = document.querySelector('[aria-label="Message list"]');
          if (messageContainer) {
            messageContainer.scrollTop = 0;
            await sleep(500);
          }
          
          // Check if we're making progress
          const newHeight = document.documentElement.scrollHeight;
          if (newHeight === previousHeight) {
            stuckCount++;
            console.log(` Height unchanged (${stuckCount}/5), trying different scroll approach...`);
            
            // Try keyboard navigation as fallback
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true }));
            await sleep(1000);
          } else {
            previousHeight = newHeight;
          }
          
          await sleep(800); // Brief pause between batches
        }
        
        console.log(`Extraction complete! Total: ${totalMessages} messages, ${batchCount} batches`);
        
        // REQUIREMENT 2 & 3: Format output as plain text with sender names
        const output = [];
        
        for (const item of messages) {
          if (item.type === 'date') {
            // REQUIREMENT 4: Include date headers
            output.push(`\n${item.content}\n`);
          } else if (item.type === 'message') {
            // REQUIREMENT 3: Sender name at start of each line
            output.push(`${item.sender}: ${item.content}`);
          }
        }
        
        // REQUIREMENT 2: Write to plain txt file
        const finalText = output.join('\n');
        const conversationTitle = getConversationTitle();
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_');
        
        const blob = new Blob([finalText], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `messenger_${conversationTitle}_${timestamp}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`Saved to: messenger_${conversationTitle}_${timestamp}.txt`);
        
        // Send completion message
        chrome.runtime.sendMessage({
          type: 'complete',
          totalMessages: totalMessages,
          totalBatches: batchCount,
          filename: `messenger_${conversationTitle}_${timestamp}.txt`
        });
        
        resolve();
        
      } catch (error) {
        console.error(' Export error:', error);
        chrome.runtime.sendMessage({
          type: 'error',
          error: error.message
        });
        reject(error);
      }
    }
    
    // Helper function to get conversation title
    function getConversationTitle() {
      const selectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"] span',
        'div[role="banner"] h1',
        'span[dir="auto"]'
      ];
      
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          return el.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
        }
      }
      
      return 'unknown_conversation';
    }
    
    // Start the extraction process
    scrollAndExtract();
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'progress') {
    updateProgress(message.percent);
    showStatus(`Batch ${message.batch} - ${message.total} messages found`, 'info');
  } else if (message.type === 'complete') {
    const filename = message.filename || 'messenger_chat.txt';
    showStatus(` Export complete! ${message.totalMessages} messages saved to ${filename}`, 'success');
    resetUI();
  } else if (message.type === 'error') {
    showStatus(` Error: ${message.error}`, 'error');
    resetUI();
  }
});

// Event listeners
checkStatusBtn.addEventListener('click', checkCurrentPage);
startExportBtn.addEventListener('click', startExport);
stopExportBtn.addEventListener('click', stopExport);

// Check page status when popup opens
document.addEventListener('DOMContentLoaded', checkCurrentPage);
