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
    
    showStatus('Ready to export messages!', 'success');
    startExportBtn.disabled = false;
    return true;
  } catch (error) {
    showStatus('Error checking page: ' + error.message, 'error');
    startExportBtn.disabled = true;
    return false;
  }
}

// Reset UI state
function resetUI() {
  isExporting = false;
  startExportBtn.style.display = 'block';
  startExportBtn.disabled = false;
  stopExportBtn.style.display = 'none';
  progressDiv.style.display = 'none';
  updateProgress(0);
}

// Start export process
async function startExport() {
  if (!currentTab || isExporting) return;
  
  isExporting = true;
  startExportBtn.style.display = 'none';
  stopExportBtn.style.display = 'block';
  progressDiv.style.display = 'block';
  showStatus('Starting export...', 'info');
  
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

// This function will be injected into the page
function exportMessages(settings) {
  return new Promise((resolve, reject) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const messages = [];
    let batchCount = 0;
    let totalMessages = 0;
    const maxBatches = 1000; // Increased limit for large conversations
    
    console.log('Starting DETAILED Messenger extraction...');
    console.log('Settings:', settings);
    
    // Send progress updates back to popup
    function updateProgress(batch, total) {
      const percent = Math.min((batch / maxBatches) * 100, 100);
      chrome.runtime.sendMessage({
        type: 'progress',
        percent: percent,
        batch: batch,
        total: total
      });
    }

    // Enhanced message extraction with detailed analysis
    function extractMessagesFromDOM() {
      const foundItems = [];
      
      console.log('Starting DETAILED message extraction (one by one)...');
      
      // Find message containers
      const containerSelectors = [
        // '[aria-label="Message list"]',
        '[aria-label="Messages"]', 
        '[role="log"]',
        '[data-testid="conversation-viewer"]'
      ];
      
      let container = null;
      for (const selector of containerSelectors) {
        container = document.querySelector(selector);
        if (container) {
          console.log(`Found container with: ${selector}`);
          break;
        }
      }
      
      if (!container) {
        // Fallback: look for div with many role="row" elements
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const roleRows = div.querySelectorAll('[role="row"]');
          if (roleRows.length > 10) {
            container = div;
            console.log(`Found container with ${roleRows.length} role="row" elements`);
            break;
          }
        }
      }
      
      if (!container) {
        console.error('No message container found!');
        return [];
      }
      
      // Get all potential message elements
      const messageElements = container.querySelectorAll('div[role="row"]');
      console.log(`Processing ${messageElements.length} message elements individually...`);
      
      // Process each message element with detailed analysis
      for (let i = 0; i < messageElements.length; i++) {
        const element = messageElements[i];
        
        try {
          const messageData = analyzeMessageElement(element, i);
          if (messageData) {
            foundItems.push(messageData);
          }
        } catch (error) {
          console.warn(`Error processing message ${i + 1}:`, error);
        }
      }
      
      return foundItems;
    }
    
    // NEW: Detailed analysis of individual message elements
    function analyzeMessageElement(element, index) {
      const fullText = element.textContent?.trim() || '';
      
      // Skip if no meaningful content
      if (!fullText || fullText.length < 2) {
        return null;
      }
      
      console.log(`Analyzing message ${index + 1}: "${fullText.substring(0, 50)}..."`);
      
      // Check if this is a date header
      const isDateElement = fullText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i);
      
      if (isDateElement && fullText.length < 100) {
        console.log(`Found date header: ${fullText}`);
        return {
          type: 'date',
          content: fullText,
          timestamp: new Date().toISOString(),
          index: index
        };
      }
      
      // Analyze message structure
      const dirAutoElements = element.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      console.log(`Found ${dirAutoElements.length} dir="auto" elements`);
      
      if (dirAutoElements.length === 0) {
        return null;
      }
      
      // Determine message sender using multiple strategies
      let sender = 'UNKNOWN';
      let messageContent = '';
      let messageType = 'text';
      
      // Strategy 1: Check element position (right-aligned = you, left-aligned = other)
      const rect = element.getBoundingClientRect();
      const isRightAligned = rect.right > window.innerWidth * 0.6;
      const isLeftAligned = rect.left < window.innerWidth * 0.4;
      
      // Strategy 2: Extract content from dir="auto" elements
      const textContents = [];
      for (const dirEl of dirAutoElements) {
        const text = dirEl.textContent.trim();
        if (text && text.length > 0) {
          textContents.push(text);
        }
      }
      
      // Strategy 3: Combine all text content
      messageContent = textContents.join(' ').trim();
      
      // Strategy 4: Determine sender
      if (isRightAligned) {
        sender = 'YOU';
      } else if (isLeftAligned) {
        // Try to get conversation partner name
        const partnerName = getConversationPartnerName();
        sender = partnerName ? partnerName.toUpperCase() : 'OTHER PERSON';
      }
      
      // Strategy 5: Detect special message types
      if (element.querySelector('img')) {
        messageType = 'image';
        if (!messageContent) messageContent = '[Image]';
      } else if (element.querySelector('video')) {
        messageType = 'video';
        if (!messageContent) messageContent = '[Video]';
      } else if (element.querySelector('a[href]')) {
        messageType = 'link';
        const link = element.querySelector('a[href]');
        if (link) messageContent += ` [${link.href}]`;
      }
      
      // Only return if we have meaningful content
      if (messageContent && messageContent.length > 0) {
        console.log(`Extracted: ${sender} -> ${messageContent.substring(0, 30)}...`);
        
        return {
          type: 'message',
          sender: sender,
          content: messageContent,
          messageType: messageType,
          alignment: isRightAligned ? 'right' : 'left',
          timestamp: new Date().toISOString(),
          index: index,
          position: {
            left: rect.left,
            right: rect.right,
            width: rect.width
          }
        };
      }
      
      return null;
    }
    
    // Helper to get conversation partner name
    function getConversationPartnerName() {
      const selectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"] span',
        'div[role="banner"] h1',
        '[aria-label*="Conversation with"] h1'
      ];
      
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const name = el.textContent.trim();
          // Filter out common UI text
          if (!name.includes('Messenger') && !name.includes('Facebook') && name.length < 50) {
            return name;
          }
        }
      }
      
      return null;
    }
    
    // Enhanced scrolling function
    async function performAdvancedScroll() {
      console.log('Performing advanced scroll to load more messages...');
      
      // Method 1: Scroll to top
      window.scrollTo(0, 0);
      await sleep(500);
      
      // Method 2: Use keyboard shortcut
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true }));
      await sleep(1000);
      
      // Method 3: Scroll message container
      const messageContainer = document.querySelector('[aria-label*="Message"], [role="log"]');
      if (messageContainer) {
        messageContainer.scrollTop = 0;
        await sleep(500);
      }
      
      // Method 4: Page Up multiple times
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
        await sleep(300);
      }
    }
    
    // Main scrolling and extraction loop
    async function scrollAndExtract() {
      try {
        let previousHeight = 0;
        let stuckCount = 0;
        let noNewMessagesCount = 0;
        
        console.log('Starting COMPLETE conversation download...');
        console.log('Will extract messages from BOTH participants with detailed analysis');
        
        // Initial scroll to load content
        await performAdvancedScroll();
        
        while (batchCount < maxBatches && stuckCount < 15 && noNewMessagesCount < 8) {
          batchCount++;
          console.log(`\nBatch ${batchCount}: Analyzing messages individually...`);
          
          // Extract messages with detailed analysis
          const batchItems = extractMessagesFromDOM();
          
          if (batchItems.length > 0) {
            const newMessages = batchItems.filter(item => 
              !messages.find(existing => 
                existing.content === item.content && 
                existing.sender === item.sender
              )
            );
            
            messages.push(...newMessages);
            totalMessages = messages.length;
            
            console.log(`Found ${newMessages.length} new messages (total: ${totalMessages})`);
            updateProgress(batchCount, totalMessages);
            
            if (newMessages.length === 0) {
              noNewMessagesCount++;
            } else {
              noNewMessagesCount = 0;
            }
            
            // Clear DOM if enabled
            if (settings.clearDOM && batchItems.length > 100) {
              console.log('Clearing DOM to prevent memory issues...');
              batchItems.forEach(item => {
                if (item.element && item.element.parentNode) {
                  item.element.remove();
                }
              });
            }
          } else {
            noNewMessagesCount++;
            console.log('No messages found in this batch');
          }
          
          // Check if we should continue scrolling
          const currentHeight = document.body.scrollHeight;
          if (Math.abs(currentHeight - previousHeight) < 100) {
            stuckCount++;
            console.log(`Height stuck (${stuckCount}/15)`);
          } else {
            stuckCount = 0;
          }
          previousHeight = currentHeight;
          
          // Advanced scrolling for next batch
          await performAdvancedScroll();
          await sleep(1000);
        }
        
        // Generate final output
        let output = '';
        let currentDate = '';
        
        // Sort messages by index to maintain order
        const sortedMessages = messages.sort((a, b) => (a.index || 0) - (b.index || 0));
        
        for (const msg of sortedMessages) {
          if (msg.type === 'date' && settings.includeDates) {
            currentDate = msg.content;
            output += `\n${currentDate}\n\n`;
          } else if (msg.type === 'message') {
            const messageText = `${msg.sender}: ${msg.content}`;
            output += messageText + '\n';
          }
        }
        
        // Download the file
        const conversationTitle = getConversationTitle();
        const filename = `messenger_${conversationTitle}_detailed.txt`;
        
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        // Send completion message
        chrome.runtime.sendMessage({
          type: 'complete',
          totalMessages: totalMessages,
          filename: filename,
          participants: ['YOU', getConversationPartnerName() || 'OTHER PERSON']
        });
        
        console.log(`Export completed! ${totalMessages} messages saved to ${filename}`);
        
      } catch (error) {
        console.error('Export failed:', error);
        chrome.runtime.sendMessage({
          type: 'error',
          error: error.message
        });
      }
    }
    
    // Helper to get conversation title for filename
    function getConversationTitle() {
      const selectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"] span',
        'div[role="banner"] h1'
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
    const participants = message.participants ? message.participants.join(' and ') : 'both participants';
    showStatus(`Complete! ${message.totalMessages} messages from ${participants} saved to ${filename}`, 'success');
    resetUI();
  } else if (message.type === 'error') {
    showStatus(`Error: ${message.error}`, 'error');
    resetUI();
  }
});

// Event listeners
checkStatusBtn.addEventListener('click', checkCurrentPage);
startExportBtn.addEventListener('click', startExport);
stopExportBtn.addEventListener('click', stopExport);

// Check page status when popup opens
document.addEventListener('DOMContentLoaded', checkCurrentPage);
