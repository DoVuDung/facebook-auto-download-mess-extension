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
    const maxBatches = 1000; // Increased limit for large conversations
    
    console.log('Starting Messenger extraction with requirements:');
    console.log('1. Scroll backwards through chat');
    console.log('2. Extract each message to plain text');
    console.log('3. Include sender name at start of each line');
    console.log('4. Include date headers like "Jul 11, 2025, 5:35 PM"');
    console.log('5. Clear DOM to prevent memory leaks');
    console.log('6. Handle large conversations with many messages');
    
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
      
      console.log('Starting DETAILED message extraction (one by one)...');
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
      
      // PRIORITY: Look for div with role="row" elements (this is what Facebook is using now!)
      for (const div of allDivs) {
        const roleRows = div.querySelectorAll('[role="row"]');
        if (roleRows.length > 10) {
          allPossibleContainers.push({element: div, source: `PRIMARY: div with ${roleRows.length} role="row" elements`});
          console.log(`Found PRIORITY container: div with ${roleRows.length} role="row" elements`);
        }
      }
      
      // Secondary: Look for divs with dir="auto" children
      for (const div of allDivs) {
        const childDivs = div.querySelectorAll('div[dir="auto"]');
        if (childDivs.length > 5 && !allPossibleContainers.find(c => c.element === div)) {
          allPossibleContainers.push({element: div, source: `Secondary: div with ${childDivs.length} dir="auto" children`});
          console.log(`Found secondary container: div with ${childDivs.length} dir="auto" children`);
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
      
      // UPDATED: Focus on role="row" elements since that's what Facebook is using now
      const messageSelectors = [
        'div[role="row"]',  // PRIORITY: This is what your debug found (36 elements)
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
      
      console.log(`Processing ${messageElements.length} potential message elements individually...`);
      
      // Process each message element individually for detailed extraction
      for (let i = 0; i < messageElements.length; i++) {
        const element = messageElements[i];
        console.log(`\n--- Processing message ${i + 1}/${messageElements.length} ---`);
        
        try {
          const messageDetails = extractSingleMessageDetails(element, i);
          if (messageDetails) {
            foundItems.push(...messageDetails);
          }
        } catch (error) {
          console.warn(`Error processing message ${i + 1}:`, error);
        }
      }
        try {
          // ENHANCED: Better date detection for Facebook's current layout
          const dateSelectors = [
            'div[aria-label][tabindex]',
            'div[role="heading"]', 
            'div[aria-hidden="true"]',
            'span[aria-hidden="true"]',
            'div[data-testid*="timestamp"]',
            'div[data-testid*="date"]'
          ];
          
          // Check if this entire element might be a date header
          const elementText = element.textContent.trim();
          const isDateElement = elementText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|TODAY AT|YESTERDAY AT|\d{1,2}:\d{2}\s*(AM|PM)/i);
          
          if (isDateElement && elementText.length < 100) {
            // This whole element is likely a date header
            foundItems.push({
              type: 'date',
              content: elementText,
              element: element
            });
            console.log(`Found date header: ${elementText}`);
            continue;
          }
          
          // Also check for date elements within this element
          for (const selector of dateSelectors) {
            try {
              const dateElement = element.querySelector(selector);
              if (dateElement) {
                const dateText = dateElement.textContent.trim();
                // Enhanced date pattern matching
                if (dateText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|TODAY AT|YESTERDAY AT|\d{1,2}:\d{2}\s*(AM|PM)/i)) {
                  foundItems.push({
                    type: 'date',
                    content: dateText,
                    element: element
                  });
                  console.log(`Found date via selector: ${dateText}`);
                  continue;
                }
              }
            } catch (e) {
              // Skip invalid selectors
              continue;
            }
          }
          
          // UPDATED: Enhanced sender detection for role="row" elements
          const senderSelectors = [
            'h4 strong', 'h5 strong', 'h3 strong', 'h2 strong',
            'strong[dir="auto"]', 'strong',
            'span[dir="auto"] strong',
            'div[dir="auto"] strong',
            '[data-testid*="sender"]',
            '[data-testid*="name"]',
            // New: Look for any strong element in role="row"
            'strong'
          ];
          
          const messageTextSelectors = [
            'div[dir="auto"]:not([aria-hidden]):not(:has(strong))', // Text without sender
            'span[dir="auto"]',
            '[data-testid="message_text"]',
            '[data-testid*="message"]',
            'div[data-testid*="text"]',
            // New: Look for text content in role="row" that's not the sender
            'div:not(:has(strong)):not(:has(h1,h2,h3,h4,h5))',
            // Look for any element with Vietnamese text patterns
            'div:not([aria-hidden])',
            'span:not([aria-hidden])'
          ];
          
          // FIXED: Facebook doesn't use <strong> elements anymore!
          let senderEl = null;
          let msgEl = null;
          
          // ENHANCED: For role="row" elements, better handling for both participants
          if (element.getAttribute('role') === 'row') {
            const allText = element.textContent.trim();
            
            // Check if this is YOUR message or OTHER PERSON's message
            const isYourMessage = element.querySelector('[data-scope="you"], [aria-label*="You sent"], [data-testid*="outgoing"]');
            const isOtherMessage = element.querySelector('[data-scope="other"], [aria-label*="sent"], [data-testid*="incoming"]');
            
            // Enhanced detection for Facebook's current structure
            const dirAutoElements = element.querySelectorAll('[dir="auto"]');
            
            if (dirAutoElements.length > 0) {
              // Strategy 1: Look for clear sender identification
              let potentialSender = null;
              let potentialMessage = null;
              
              // Check if first dir="auto" looks like a name (short, capitalized)
              const firstText = dirAutoElements[0].textContent.trim();
              if (firstText && firstText.length < 50 && firstText.match(/^[A-Z]/)) {
                potentialSender = dirAutoElements[0];
                
                // Look for message in subsequent elements
                for (let i = 1; i < dirAutoElements.length; i++) {
                  const text = dirAutoElements[i].textContent.trim();
                  if (text && text.length > 2 && text !== firstText) {
                    potentialMessage = dirAutoElements[i];
                    break;
                  }
                }
              }
              
              // Strategy 2: If no clear sender found, try alternative approaches
              if (!potentialSender || !potentialMessage) {
                // Look for any element that might contain the full message
                for (const dirEl of dirAutoElements) {
                  const text = dirEl.textContent.trim();
                  
                  // If this looks like a complete message (has some length)
                  if (text && text.length > 5) {
                    // Try to extract sender and message from the text
                    const colonIndex = text.indexOf(':');
                    const spaceIndex = text.indexOf(' ');
                    
                    if (colonIndex > 0 && colonIndex < 30) {
                      // Format: "Name: message"
                      potentialSender = { textContent: text.substring(0, colonIndex).trim() };
                      potentialMessage = { textContent: text.substring(colonIndex + 1).trim() };
                      break;
                    } else if (spaceIndex > 0 && spaceIndex < 20) {
                      // Try to detect if first word is a name
                      const firstWord = text.substring(0, spaceIndex);
                      if (firstWord.match(/^[A-Z][a-z]+$/)) {
                        potentialSender = { textContent: firstWord };
                        potentialMessage = { textContent: text.substring(spaceIndex + 1).trim() };
                        break;
                      }
                    }
                    
                    // If still no clear structure, use "You" or "Other" based on context
                    if (!potentialSender) {
                      if (isYourMessage || element.getAttribute('aria-label')?.includes('You sent')) {
                        potentialSender = { textContent: 'You' };
                      } else {
                        // Try to get conversation partner's name from page title or header
                        const partnerName = getConversationPartnerName();
                        potentialSender = { textContent: partnerName || 'Other' };
                      }
                      potentialMessage = { textContent: text };
                      break;
                    }
                  }
                }
              }
              
              senderEl = potentialSender;
              msgEl = potentialMessage;
            }
            
            // Strategy 3: Final fallback - use visual/structural cues
            if (!senderEl && allText.length > 5) {
              // Check element position or styling to determine if it's your message or theirs
              const elementStyle = window.getComputedStyle(element);
              const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : null;
              
              // Look for alignment cues (your messages often align right, theirs left)
              const textAlign = elementStyle.textAlign || parentStyle?.textAlign;
              const marginLeft = parseInt(elementStyle.marginLeft) || 0;
              const marginRight = parseInt(elementStyle.marginRight) || 0;
              
              if (textAlign === 'right' || marginLeft > marginRight + 50) {
                senderEl = { textContent: 'You' };
              } else {
                const partnerName = getConversationPartnerName();
                senderEl = { textContent: partnerName || 'Other' };
              }
              
              msgEl = { textContent: allText };
            }
          } else {
            // Original logic for non-role="row" elements (keep as backup)
            // Find sender with more flexible approach
            for (const selector of senderSelectors) {
              senderEl = element.querySelector(selector);
              if (senderEl && senderEl.textContent.trim() && senderEl.textContent.trim().length < 50) {
                break;
              }
            }
            
            // Find message with more flexible approach  
            for (const selector of messageTextSelectors) {
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
            } else {
              console.log(`Skipped invalid message: sender="${senderName}" content="${messageContent ? messageContent.substring(0, 30) : 'none'}"`);
            }
          } else {
            // DEBUG: Log what we couldn't parse
            const elementText = element.textContent.trim();
            if (elementText.length > 5) {
              console.log(`Could not parse element: "${elementText.substring(0, 50)}..." (sender=${!!senderEl}, msg=${!!msgEl})`);
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
    }

    // NEW: Extract detailed information from a single message element
    function extractSingleMessageDetails(element, index) {
      const messageDetails = [];
      
      console.log(`Analyzing element ${index + 1} for detailed message extraction...`);
      
      // Get all text content for analysis
      const fullText = element.textContent?.trim() || '';
      const innerHTML = element.innerHTML || '';
      
      console.log(`Element ${index + 1} text preview:`, fullText.substring(0, 100));
      
      // Check if this is a date header first
      const isDateElement = fullText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|TODAY AT|YESTERDAY AT|\d{1,2}:\d{2}\s*(AM|PM)/i);
      
      if (isDateElement && fullText.length < 100) {
        console.log(`Found date header: ${fullText}`);
        messageDetails.push({
          type: 'date',
          content: fullText,
          element: element,
          index: index
        });
        return messageDetails;
      }
      
      // Enhanced sender detection - try multiple strategies
      let sender = null;
      let messageContent = null;
      let timestamp = null;
      let messageType = 'text';
      
      // Strategy 1: Look for role="row" structure with dir="auto" elements
      const dirAutoElements = element.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      console.log(`Found ${dirAutoElements.length} dir="auto" elements in message ${index + 1}`);
      
      if (dirAutoElements.length > 0) {
        // Try to identify sender from visual cues and structure
        const elementRect = element.getBoundingClientRect();
        const elementStyle = window.getComputedStyle(element);
        
        // Check message alignment for sender detection
        const isRightAligned = elementStyle.textAlign === 'right' || 
                              elementStyle.justifyContent === 'flex-end' ||
                              elementRect.right > window.innerWidth * 0.6;
        
        const isLeftAligned = elementStyle.textAlign === 'left' || 
                             elementStyle.justifyContent === 'flex-start' ||
                             elementRect.left < window.innerWidth * 0.4;
        
        // Try to extract sender name from first dir="auto" element
        const firstDirAuto = dirAutoElements[0];
        const firstText = firstDirAuto.textContent.trim();
        
        // Enhanced message content extraction
        let allMessageTexts = [];
        
        for (let i = 0; i < dirAutoElements.length; i++) {
          const dirEl = dirAutoElements[i];
          const text = dirEl.textContent.trim();
          
          if (text && text.length > 0) {
            // Check if this might be sender name (short, capitalized, no punctuation)
            const mightBeSender = text.length < 50 && 
                                 text.match(/^[A-Z][a-zA-Z\s]*$/) && 
                                 !text.includes('.') && 
                                 !text.includes('!') && 
                                 !text.includes('?') &&
                                 i === 0; // Usually first element
            
            if (mightBeSender && !sender) {
              sender = text;
              console.log(`Identified sender from structure: ${sender}`);
            } else if (!mightBeSender || i > 0) {
              allMessageTexts.push(text);
            }
          }
        }
        
        // If no clear sender found, use position-based detection
        if (!sender) {
          if (isRightAligned) {
            sender = 'YOU';
          } else if (isLeftAligned) {
            // Try to get partner name from page
            const partnerName = getConversationPartnerName();
            sender = partnerName || 'OTHER PERSON';
          } else {
            sender = 'UNKNOWN';
          }
        }
        
        // Combine all message texts
        messageContent = allMessageTexts.join(' ').trim();
        
        // Enhanced content detection for different message types
        if (!messageContent && fullText) {
          // If sender was detected, remove it from full text
          if (sender && sender !== 'YOU' && sender !== 'OTHER PERSON' && sender !== 'UNKNOWN') {
            messageContent = fullText.replace(sender, '').trim();
            // Remove leading colon or other separators
            messageContent = messageContent.replace(/^[:]\s*/, '');
          } else {
            messageContent = fullText;
          }
        }
        
        // Detect special message types
        if (element.querySelector('img')) {
          messageType = 'image';
          if (!messageContent) messageContent = '[Image sent]';
        } else if (element.querySelector('video')) {
          messageType = 'video';
          if (!messageContent) messageContent = '[Video sent]';
        } else if (element.querySelector('audio')) {
          messageType = 'audio';
          if (!messageContent) messageContent = '[Audio message]';
        } else if (element.querySelector('a[href]')) {
          messageType = 'link';
          const linkUrl = element.querySelector('a[href]')?.href;
          if (linkUrl) messageContent += ` [Link: ${linkUrl}]`;
        }
        
        // Try to extract timestamp
        const timeElements = element.querySelectorAll('[aria-label*="time"], [data-testid*="time"], span[title]');
        for (const timeEl of timeElements) {
          const timeText = timeEl.textContent || timeEl.getAttribute('title') || timeEl.getAttribute('aria-label');
          if (timeText && timeText.match(/\d{1,2}:\d{2}|\d{1,2}:\d{2}:\d{2}|AM|PM/i)) {
            timestamp = timeText;
            break;
          }
        }
        
        // Only add if we have meaningful content
        if (messageContent && messageContent.length > 0 && sender) {
          console.log(`Extracted message ${index + 1}: ${sender} -> ${messageContent.substring(0, 50)}...`);
          
          messageDetails.push({
            type: 'message',
            sender: sender.toUpperCase(),
            content: messageContent,
            timestamp: timestamp,
            messageType: messageType,
            element: element,
            index: index,
            alignment: isRightAligned ? 'right' : isLeftAligned ? 'left' : 'center',
            elementRect: {
              left: elementRect.left,
              right: elementRect.right,
              width: elementRect.width
            }
          });
        } else {
          console.log(`Skipped element ${index + 1}: insufficient content or sender info`);
        }
      }
      
      return messageDetails;
    }
    
    // Helper function to get conversation partner's name
    function getConversationPartnerName() {
      const selectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"] span',
        'div[role="banner"] h1',
        'span[dir="auto"]',
        '[aria-label*="Conversation with"] h1',
        '[aria-label*="Chat with"] h1'
      ];
      
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const name = el.textContent.trim();
          // Filter out obvious non-names
          if (!name.includes('Messenger') && !name.includes('Facebook') && name.length < 50) {
            return name;
          }
        }
      }
      
      // Try to extract from page title
      const title = document.title;
      if (title && !title.includes('Messenger') && !title.includes('Facebook')) {
        return title.split(' • ')[0] || title.split(' - ')[0] || 'Other';
      }
      
      return 'Other';
    }

    // Enhanced scrolling function for better message loading
    async function performAdvancedScroll() {
      console.log('Starting enhanced scroll sequence...');
      
      // Method 1: Scroll to absolute top
      window.scrollTo(0, 0);
      await sleep(1000);
      
      // Method 2: Use End key to go to bottom, then Home to go to top
      document.body.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true }));
      await sleep(500);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true }));
      await sleep(1000);
      
      // Method 3: Try scrolling the message container directly
      const messageContainer = document.querySelector('[aria-label*="Message"], [role="log"], [data-testid*="conversation"]');
      if (messageContainer) {
        messageContainer.scrollTop = 0;
        await sleep(500);
        messageContainer.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(1000);
      }
      
      // Method 4: Try scrolling main content area
      const mainContent = document.querySelector('main, [role="main"], #mount_0_0');
      if (mainContent) {
        mainContent.scrollTop = 0;
        await sleep(500);
      }
      
      // Method 5: Use Page Up repeatedly to load more content
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
        await sleep(300);
      }
      
      console.log('Enhanced scroll sequence completed');
    }
    // REQUIREMENT 1: Enhanced main scrolling and extraction loop
    async function scrollAndExtract() {
      try {
        let previousHeight = 0;
        let stuckCount = 0;
        let noNewMessagesCount = 0;
        let lastMessageCount = 0;
        
        console.log('Starting COMPLETE conversation download...');
        console.log('Will extract messages from BOTH you and the other person');
        console.log('Will auto-scroll through ENTIRE conversation history');
        
        // Initial aggressive scroll to load more content
        await performAdvancedScroll();
        
        while (batchCount < maxBatches && stuckCount < 15 && noNewMessagesCount < 8) {
          batchCount++;
          console.log(`Batch ${batchCount}: Scrolling and extracting messages from BOTH participants...`);
          
          // Extract messages from current view
          const batchItems = extractMessagesFromDOM();
          
          if (batchItems.length > 0) {
            // Add to beginning to maintain chronological order (oldest first)
            messages.unshift(...batchItems.reverse());
            const messageCount = batchItems.filter(item => item.type === 'message').length;
            totalMessages += messageCount;
            
            console.log(`Extracted ${messageCount} messages, ${batchItems.filter(item => item.type === 'date').length} date headers`);
            console.log(`Total so far: ${totalMessages} messages from both participants`);
            
            // Reset counters if we found new messages
            if (totalMessages > lastMessageCount) {
              stuckCount = 0;
              noNewMessagesCount = 0;
              lastMessageCount = totalMessages;
            } else {
              noNewMessagesCount++;
            }
            
          } else {
            stuckCount++;
            noNewMessagesCount++;
            console.log(`No new messages found in batch ${batchCount} (stuck: ${stuckCount}/15, no messages: ${noNewMessagesCount}/8)`);
          }
          
          updateProgress(batchCount, totalMessages);
          
          // ENHANCED: More aggressive scrolling for complete message history
          const currentHeight = document.documentElement.scrollHeight;
          
          // Primary scroll method: Go to very top
          window.scrollTo(0, 0);
          await sleep(1500);
          
          // Secondary: Try container-specific scrolling
          const messageContainer = document.querySelector('[aria-label*="Message"], [role="log"], [data-testid*="conversation"]');
          if (messageContainer) {
            messageContainer.scrollTop = 0;
            await sleep(800);
            
            // Force scroll up in container
            messageContainer.scrollBy(0, -1000);
            await sleep(500);
          }
          
          // Tertiary: Keyboard navigation
          if (stuckCount > 3) {
            console.log('Using keyboard navigation to load more history...');
            document.body.focus();
            
            // Try different keyboard combinations
            for (let i = 0; i < 3; i++) {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true }));
              await sleep(400);
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }));
              await sleep(400);
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
              await sleep(300);
            }
          }
          
          // Quaternary: Try clicking load more if available
          if (stuckCount > 6) {
            console.log('Looking for "Load more" or "See older messages" buttons...');
            const loadMoreSelectors = [
              '[aria-label*="load" i]',
              '[aria-label*="older" i]',
              '[aria-label*="previous" i]',
              'button:contains("Load")',
              'button:contains("More")',
              'button:contains("Older")',
              '[data-testid*="load"]',
              '[data-testid*="more"]'
            ];
            
            for (const selector of loadMoreSelectors) {
              try {
                const button = document.querySelector(selector);
                if (button && button.offsetParent !== null) { // Check if visible
                  console.log(`Found and clicking: ${selector}`);
                  button.click();
                  await sleep(2000);
                  break;
                }
              } catch (e) {
                // Skip invalid selectors
                continue;
              }
            }
          }
          
          // Check if we're making progress with height changes
          const newHeight = document.documentElement.scrollHeight;
          if (newHeight === previousHeight) {
            stuckCount++;
            console.log(`Height unchanged: ${newHeight}px (${stuckCount}/15)`);
            
            // Try more aggressive methods when stuck
            if (stuckCount > 8) {
              console.log('Trying ULTRA aggressive scroll methods...');
              
              // Method: Rapid scroll bursts
              for (let i = 0; i < 10; i++) {
                window.scrollTo(0, 0);
                await sleep(100);
                window.scrollTo(0, -1000);
                await sleep(100);
              }
              
              // Method: Focus and scroll main areas
              const focusElements = document.querySelectorAll('main, [role="main"], [data-testid*="conversation"], [aria-label*="message" i]');
              for (const el of focusElements) {
                try {
                  el.focus();
                  el.scrollTop = 0;
                  await sleep(300);
                } catch (e) {
                  // Skip elements that can't be focused
                  continue;
                }
              }
            }
            
          } else {
            previousHeight = newHeight;
            stuckCount = Math.max(0, stuckCount - 1); // Slowly reduce stuck count when making progress
            console.log(`Height changed! ${previousHeight} → ${newHeight}px (loading more content)`);
          }
          
          // Longer pause between batches for large conversations
          await sleep(batchCount > 50 ? 2000 : 1200);
        }
        
        console.log(`COMPLETE extraction finished!`);
        console.log(`Final stats: ${totalMessages} messages from BOTH participants`);
        console.log(`Processed ${batchCount} batches`);
        
        if (stuckCount >= 15) {
          console.log('Stopped due to no scroll progress - likely reached conversation start');
        }
        if (noNewMessagesCount >= 8) {
          console.log('Stopped due to no new messages - likely extracted all available');
        }
        
        // ENHANCED: Format output with clear participant identification
        const output = [];
        let lastDate = null;
        const conversationPartner = getConversationPartnerName();
        
        console.log(`Formatting ${messages.length} items for download...`);
        console.log(`Participants: You and ${conversationPartner}`);
        
        for (const item of messages) {
          if (item.type === 'date') {
            // REQUIREMENT 4: Include date headers with clean formatting
            const dateText = item.content.trim();
            
            // Clean up date format to match desired output
            let cleanDate = dateText;
            
            // Remove redundant time info like "TODAY AT 6:28 PM6:28 PM: 6:28 PM"
            cleanDate = cleanDate.replace(/TODAY AT \d{1,2}:\d{2} [AP]M\d{1,2}:\d{2} [AP]M: \d{1,2}:\d{2} [AP]M/, 'TODAY');
            cleanDate = cleanDate.replace(/YESTERDAY AT \d{1,2}:\d{2} [AP]M[A-Z]{3} \d{2}:\d{2}: [A-Z]{3} \d{2}:\d{2}/, 'YESTERDAY');
            
            // Convert to cleaner format
            if (cleanDate.includes('TODAY')) {
              const today = new Date();
              cleanDate = `${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
            } else if (cleanDate.includes('YESTERDAY')) {
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              cleanDate = `${yesterday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${yesterday.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
            }
            
            // Only add date header if it's different from the last one
            if (cleanDate !== lastDate) {
              output.push(`\n${cleanDate}\n`);
              lastDate = cleanDate;
            }
          } else if (item.type === 'message') {
            // ENHANCED: Better sender name formatting with participant identification
            let senderName = item.sender.trim();
            
            // Normalize sender names
            if (senderName.toLowerCase() === 'you' || senderName === '') {
              senderName = 'YOU';
            } else if (senderName.toLowerCase() === 'other' || senderName.toLowerCase() === 'unknown') {
              senderName = conversationPartner.toUpperCase();
            } else {
              senderName = senderName.toUpperCase();
            }
            
            output.push(`${senderName}: ${item.content}`);
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
        
        console.log(`Saved complete conversation to: messenger_${conversationTitle}_${timestamp}.txt`);
        console.log(`Final export contains ${totalMessages} messages from both participants`);
        
        // Send completion message with enhanced details
        chrome.runtime.sendMessage({
          type: 'complete',
          totalMessages: totalMessages,
          totalBatches: batchCount,
          filename: `messenger_${conversationTitle}_${timestamp}.txt`,
          participants: ['You', conversationPartner]
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
    const participants = message.participants ? message.participants.join(' and ') : 'both participants';
    showStatus(`Complete conversation exported! ${message.totalMessages} messages from ${participants} saved to ${filename}`, 'success');
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
