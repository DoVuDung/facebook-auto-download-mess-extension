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
    let totalMessages = 0;
    
    console.log('Starting SIMPLE text-only Messenger extraction for single conversation...');
    console.log('Will extract: sender and message text content only');
    console.log('Settings:', settings);
    
    // Send progress updates back to popup
    function updateProgress(percent, current) {
      chrome.runtime.sendMessage({
        type: 'progress',
        percent: percent,
        current: current,
        total: totalMessages
      });
    }

    // ROBUST message extraction - focus on actual conversation messages
    function extractMessagesFromDOM() {
      const foundItems = [];
      const processedElements = new Set();
      
      console.log('🔍 Starting ROBUST message extraction...');
      
      // Get conversation partner name for reference
      const conversationPartner = getConversationPartnerName();
      console.log(`🎯 Conversation partner: ${conversationPartner || 'UNKNOWN'}`);
      
      // Find ALL potential message elements with broader approach
      const messageElements = document.querySelectorAll('div[role="row"]');
      console.log(`🎯 Found ${messageElements.length} potential message elements`);
      
      if (messageElements.length === 0) {
        console.log('⚠️ No role="row" elements found, trying alternative selectors...');
        // Try alternative selectors
        const altElements = document.querySelectorAll(
          '[data-testid*="message"], ' +
          '[aria-label*="message"], ' +
          'div[dir="auto"] > div, ' +
          '.message, .msg'
        );
        console.log(`Found ${altElements.length} alternative elements`);
      }
      
      let validMessages = 0;
      let skippedElements = 0;
      
      for (let i = 0; i < messageElements.length; i++) {
        const element = messageElements[i];
        const elementText = element.textContent?.trim() || '';
        
        // Skip completely empty or very short elements
        if (elementText.length < 1) {
          skippedElements++;
          continue;
        }
        
        // Skip obvious UI elements (but be less restrictive)
        if (
          elementText.includes('Search in conversation') ||
          elementText.includes('View profile') ||
          elementText.includes('Conversation settings') ||
          elementText.includes('Message requests') ||
          elementText.includes('Something went wrong') ||
          elementText === 'Active now' ||
          elementText === 'Online' ||
          elementText === 'Offline'
        ) {
          skippedElements++;
          continue;
        }
        
        // Create unique identifier to avoid processing same element twice
        const elementId = `elem_${i}_${elementText.substring(0, 50)}`;
        if (processedElements.has(elementId)) {
          continue;
        }
        
        try {
          const messageData = extractTextContent(element, i, conversationPartner);
          if (messageData && messageData.content && messageData.content.trim()) {
            
            // Basic validation - accept more message types
            if (messageData.type === 'message') {
              // Less strict sender validation - accept any reasonable sender
              const senderUpper = messageData.sender.toUpperCase();
              
              // Accept messages if they have reasonable content
              if (messageData.content.length >= 1 && 
                  !isSystemMessage(messageData.content) &&
                  !messageData.content.match(/^[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+$/)) { // Not just symbols
                
                // Check for duplicates with looser matching
                const isDuplicate = foundItems.some(item => {
                  return item.content === messageData.content && 
                         item.sender === messageData.sender;
                });
                
                if (!isDuplicate) {
                  foundItems.push(messageData);
                  processedElements.add(elementId);
                  validMessages++;
                  
                  if (validMessages % 25 === 0) {
                    console.log(`📝 Valid messages found: ${validMessages}...`);
                  }
                  
                  // Debug: log first few messages to see what we're getting
                  if (validMessages <= 5) {
                    console.log(`Sample message ${validMessages}: ${messageData.sender} - ${messageData.content.substring(0, 100)}`);
                  }
                }
              }
            } else if (messageData.type === 'date') {
              // Always include date headers
              foundItems.push(messageData);
              processedElements.add(elementId);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Error processing element ${i + 1}:`, error);
          skippedElements++;
        }
      }
      
      console.log(`✅ ROBUST extraction complete:`);
      console.log(`   📝 Valid messages: ${validMessages}`);
      console.log(`   ⏭️ Skipped elements: ${skippedElements}`);
      console.log(`   📊 Total found items: ${foundItems.length}`);
      
      // If we found very few messages, log some debug info
      if (validMessages < 5) {
        console.log('⚠️ Very few messages found. Debug info:');
        console.log(`   Total role="row" elements: ${messageElements.length}`);
        if (messageElements.length > 0) {
          console.log(`   First element text: "${messageElements[0]?.textContent?.substring(0, 100)}"`);
          console.log(`   Last element text: "${messageElements[messageElements.length-1]?.textContent?.substring(0, 100)}"`);
        }
      }
      
      return foundItems;
    }
    
    // Helper function to detect obvious system messages (less restrictive)
    function isSystemMessage(content) {
      const systemPatterns = [
        'sent a message',
        'started a call',
        'missed call',
        'reacted to',
        'liked a message',
        'loved a message',
        'left the group',
        'joined the group',
        'This person is unavailable on Messenger',
        'You are now connected on Messenger',
        'Say hi to your new connection'
      ];
      
      const contentLower = content.toLowerCase();
      return systemPatterns.some(pattern => contentLower.includes(pattern.toLowerCase()));
    }
    
    // Helper function to calculate text similarity
    function calculateSimilarity(text1, text2) {
      const words1 = text1.toLowerCase().split(/\s+/);
      const words2 = text2.toLowerCase().split(/\s+/);
      
      const set1 = new Set(words1);
      const set2 = new Set(words2);
      
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      
      return intersection.size / union.size;
    }

    // ROBUST: Extract actual message content with broader acceptance
    function extractTextContent(element, index, conversationPartner) {
      const fullText = element.textContent?.trim() || '';
      
      // Skip completely empty elements
      if (!fullText) {
        return null;
      }
      
      // === DATE HEADER DETECTION ===
      const isDateElement = fullText.match(/\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i);
      
      if (isDateElement && fullText.length < 100) {
        return {
          type: 'date',
          content: fullText,
          index: index
        };
      }
      
      // === ROBUST SENDER IDENTIFICATION ===
      const rect = element.getBoundingClientRect();
      const isRightAligned = rect.right > window.innerWidth * 0.6;
      const isLeftAligned = rect.left < window.innerWidth * 0.4;
      
      let sender = 'UNKNOWN';
      let foundExplicitSender = false;
      
      // Method 1: Look for explicit sender name with broader acceptance
      const senderElements = element.querySelectorAll('span[dir="auto"] strong, h4, h5, span[role="text"], strong');
      for (const senderEl of senderElements) {
        let senderText = senderEl.textContent?.trim();
        if (senderText) {
          // Clean the sender text
          senderText = senderText.replace(/\s*:.*$/g, '');
          senderText = senderText.replace(/\s*\(.*?\)\s*/g, '');
          senderText = senderText.replace(/\s*\[.*?\]\s*/g, '');
          senderText = senderText.trim();
          
          // More flexible validation - just check it's reasonable
          if (senderText && 
              senderText.length >= 1 && 
              senderText.length <= 100 &&
              !senderText.match(/^\d+$/) && // Not just numbers
              !senderText.match(/AM|PM/i) &&
              !senderText.match(/\d{1,2}:\d{2}/) &&
              !senderText.includes('•')) {
            
            sender = senderText.toUpperCase();
            foundExplicitSender = true;
            console.log(`✅ Found sender: "${sender}"`);
            break;
          }
        }
      }
      
      // Method 2: Position-based detection as fallback
      if (!foundExplicitSender) {
        if (isRightAligned) {
          sender = 'YOU';
        } else if (isLeftAligned) {
          sender = conversationPartner ? conversationPartner.toUpperCase() : 'OTHER PERSON';
        } else {
          sender = 'UNKNOWN';
        }
      }
      
      // === ROBUST TEXT CONTENT EXTRACTION ===
      const textElements = element.querySelectorAll('div[dir="auto"], span[dir="auto"], [role="text"]');
      const textContents = [];
      const seenTexts = new Set();
      
      // Also try getting text from the main element if no sub-elements found
      if (textElements.length === 0) {
        const mainText = fullText
          .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/gi, '') // Remove timestamps
          .replace(/\b(Active|Online|Offline)\b/gi, '') // Remove status
          .trim();
        
        if (mainText && mainText.length > 0) {
          textContents.push(mainText);
        }
      } else {
        for (const textEl of textElements) {
          let text = textEl.textContent?.trim();
          if (text && text.length > 0) {
            // Less strict filtering - only remove obvious UI elements
            if (!text.match(/^\d{1,2}:\d{2}/) && 
                !text.includes('•') && 
                text !== sender &&
                text !== sender.toLowerCase() &&
                !text.match(/AM|PM$/i) &&
                !text.match(/\d{1,2}:\d{2}\s*(AM|PM)/i) &&
                text !== 'Enter' &&
                !text.includes('Type a message') &&
                !text.includes('Aa') &&
                text.length >= 1 && 
                text.length < 5000 && 
                !seenTexts.has(text)) {
              
              textContents.push(text);
              seenTexts.add(text);
            }
          }
        }
      }
      
      const mainContent = textContents.join(' ').trim();
      
      // Clean up the content more gently
      let cleanContent = mainContent
        .replace(/\s+/g, ' ')
        .trim();
      
      // LESS STRICT validation - accept more content
      if (!cleanContent || 
          cleanContent.length < 1 ||
          cleanContent.toLowerCase() === sender.toLowerCase()) {
        return null;
      }
      
      console.log(`✅ Message ${index + 1}: ${sender} - ${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}`);
      
      return {
        type: 'message',
        index: index,
        sender: sender,
        content: cleanContent
      };
    }
    
    // Enhanced helper to get conversation partner name with better accuracy
    function getConversationPartnerName() {
      // Priority 1: Look for conversation header/title
      const headerSelectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"]',
        '[aria-label*="Conversation with"] h1',
        'div[role="banner"] h1',
        'header h1 span',
        'div[role="banner"] span[dir="auto"]'
      ];
      
      for (const selector of headerSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          let name = el.textContent.trim();
          
          // Clean up the name - remove common UI text
          name = name.replace(/\s*\(.*?\)\s*/g, ''); // Remove parentheses content
          name = name.replace(/\s*-\s*Messenger.*$/i, ''); // Remove "- Messenger" suffix
          name = name.replace(/\s*•.*$/g, ''); // Remove bullet points and after
          name = name.trim();
          
          // Validate name - must be reasonable length and not UI text
          if (name && 
              name.length > 0 && 
              name.length < 100 &&
              !name.toLowerCase().includes('messenger') && 
              !name.toLowerCase().includes('facebook') && 
              !name.toLowerCase().includes('chat') &&
              !name.toLowerCase().includes('active') &&
              !name.toLowerCase().includes('online') &&
              !name.match(/^\d+$/) &&
              !name.includes('•') &&
              name !== 'Messages') {
            console.log(`Found conversation partner from header: ${name}`);
            return name;
          }
        }
      }
      
      // Priority 2: Look for profile link or avatar with name
      const profileSelectors = [
        '[role="button"][aria-label*="profile"] span',
        'a[href*="/profile/"] span',
        '[data-testid*="profile"] span'
      ];
      
      for (const selector of profileSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const name = el.textContent.trim();
          if (name && name.length > 0 && name.length < 50) {
            console.log(`Found conversation partner from profile: ${name}`);
            return name;
          }
        }
      }
      
      // Priority 3: Analyze message senders to find the other person
      const messageElements = document.querySelectorAll('div[role="row"]');
      const senderCounts = {};
      const currentUserIdentifiers = ['you', 'me', 'myself'];
      
      for (const msgEl of messageElements) {
        // Look for sender name elements
        const senderElements = msgEl.querySelectorAll('span[dir="auto"] strong, h4, h5, [aria-label*="sent by"]');
        
        for (const senderEl of senderElements) {
          let senderText = senderEl.textContent?.trim();
          if (senderText) {
            // Clean sender name
            senderText = senderText.replace(/\s*:.*$/g, ''); // Remove colon and after
            senderText = senderText.replace(/\s*\(.*?\)\s*/g, ''); // Remove parentheses
            senderText = senderText.trim();
            
            // Validate sender name
            if (senderText && 
                senderText.length > 0 && 
                senderText.length < 50 &&
                !senderText.match(/^\d+$/) &&
                !senderText.match(/AM|PM/i) &&
                !senderText.includes('Active') &&
                !senderText.includes('ago') &&
                !senderText.includes('•') &&
                !currentUserIdentifiers.some(id => senderText.toLowerCase().includes(id))) {
              
              senderCounts[senderText] = (senderCounts[senderText] || 0) + 1;
            }
          }
        }
      }
      
      // Find the most frequent sender (excluding current user)
      let bestSender = null;
      let maxCount = 0;
      
      for (const [sender, count] of Object.entries(senderCounts)) {
        if (count > maxCount && count > 2) { // Must appear at least 3 times
          bestSender = sender;
          maxCount = count;
        }
      }
      
      if (bestSender) {
        console.log(`Found conversation partner by message analysis: ${bestSender} (${maxCount} messages)`);
        return bestSender;
      }
      
      console.log('Could not determine conversation partner name');
      return null;
    }
    
    // Enhanced backwards scrolling function to load ALL messages from the very beginning
    async function performAdvancedScroll() {
      console.log('Starting AGGRESSIVE backwards scroll to load ALL messages from conversation beginning...');
      
      let previousMessageCount = 0;
      let currentMessageCount = 0;
      let noChangeCount = 0;
      let maxRetries = 100; // Increased retries
      let scrollAttempts = 0;
      let consecutiveNoChange = 0;
      
      // Find the main message container with multiple fallbacks
      let messageContainer = document.querySelector('[role="log"]') || 
                            document.querySelector('[aria-label*="Message"]') || 
                            document.querySelector('[data-testid*="conversation"]') ||
                            document.querySelector('[aria-label="Messages"]') ||
                            document.querySelector('div[aria-label*="Message list"]');
      
      // If still no container, find the one with most role="row" elements
      if (!messageContainer) {
        const allDivs = document.querySelectorAll('div');
        let maxRows = 0;
        for (const div of allDivs) {
          const roleRows = div.querySelectorAll('[role="row"]');
          if (roleRows.length > maxRows) {
            maxRows = roleRows.length;
            messageContainer = div;
          }
        }
      }
      
      console.log('Found message container:', messageContainer ? 'YES' : 'NO');
      if (messageContainer) {
        console.log('Container tag:', messageContainer.tagName);
        console.log('Container classes:', messageContainer.className);
      }
      
      while (scrollAttempts < maxRetries) {
        // Count current messages before scrolling
        const messageElements = document.querySelectorAll('div[role="row"]');
        currentMessageCount = messageElements.length;
        
        console.log(`🔄 Scroll attempt ${scrollAttempts + 1}/${maxRetries}: ${currentMessageCount} messages found`);
        
        // Check if we got more messages
        if (currentMessageCount > previousMessageCount) {
          consecutiveNoChange = 0;
          previousMessageCount = currentMessageCount;
          console.log(`✅ New messages loaded! Total: ${currentMessageCount}`);
        } else {
          consecutiveNoChange++;
          console.log(`⏸️ No new messages (${consecutiveNoChange}/8)`);
        }
        
        // Stop if no new messages for 8 consecutive attempts (increased threshold)
        if (consecutiveNoChange >= 8) {
          console.log('🛑 Reached conversation beginning - no more messages to load after 8 attempts');
          break;
        }
        
        // AGGRESSIVE MULTI-METHOD SCROLLING
        
        // Method 1: Scroll message container to absolute top
        if (messageContainer) {
          messageContainer.scrollTop = 0;
          if (messageContainer.scrollTo) {
            messageContainer.scrollTo({ top: 0, behavior: 'instant' });
          }
          // Also try scrolling parent containers
          let parent = messageContainer.parentElement;
          while (parent && parent !== document.body) {
            if (parent.scrollTo) {
              parent.scrollTo({ top: 0, behavior: 'instant' });
            }
            parent.scrollTop = 0;
            parent = parent.parentElement;
          }
        }
        
        // Method 2: Scroll main window and document to absolute top
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        
        // Method 3: Focus and use keyboard shortcuts
        document.body.focus();
        
        // Try different keyboard combinations
        const keyEvents = [
          { key: 'Home', ctrlKey: true },
          { key: 'Home', ctrlKey: false },
          { key: 'PageUp', ctrlKey: true },
          { key: 'ArrowUp', ctrlKey: true },
        ];
        
        for (const keyEvent of keyEvents) {
          document.dispatchEvent(new KeyboardEvent('keydown', { 
            ...keyEvent,
            bubbles: true 
          }));
          await sleep(50);
        }
        
        // Method 4: Multiple Page Up presses with longer delays
        for (let i = 0; i < 15; i++) { // Increased from 10 to 15
          document.dispatchEvent(new KeyboardEvent('keydown', { 
            key: 'PageUp', 
            bubbles: true 
          }));
          await sleep(150); // Increased delay
        }
        
        // Method 5: Try to find and click "Load older messages" or similar buttons
        const loadButtons = [
          document.querySelector('[data-testid*="load"]'),
        ];
        
        // Find buttons by aria-label (case insensitive search)
        const allAriaElements = document.querySelectorAll('[aria-label]');
        for (const element of allAriaElements) {
          const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
          if (ariaLabel.includes('load') || ariaLabel.includes('older')) {
            loadButtons.push(element);
          }
        }
        
        // Find buttons by text content using proper JavaScript
        const allButtons = document.querySelectorAll('button, [role="button"]');
        for (const button of allButtons) {
          const buttonText = button.textContent?.toLowerCase() || '';
          if (buttonText.includes('load') || 
              buttonText.includes('see more') || 
              buttonText.includes('view older') ||
              buttonText.includes('show more') ||
              buttonText.includes('older messages')) {
            loadButtons.push(button);
          }
        }
        
        // Remove duplicates and click any found load buttons
        const uniqueLoadButtons = [...new Set(loadButtons)].filter(Boolean);
        for (const button of uniqueLoadButtons) {
          if (button && button.offsetParent !== null) { // Check if visible
            console.log('🔘 Found and clicking load button:', button.textContent || button.getAttribute('aria-label'));
            button.click();
            await sleep(1000);
          }
        }
        
        // Method 6: Scroll by large pixel amounts in different containers
        const scrollableElements = [
          messageContainer,
          document.documentElement,
          document.body,
          ...document.querySelectorAll('[role="main"]'),
          ...document.querySelectorAll('[role="log"]'),
        ].filter(Boolean);
        
        for (const element of scrollableElements) {
          if (element.scrollBy) {
            element.scrollBy(0, -10000); // Scroll up by large amount
          }
          element.scrollTop = Math.max(0, element.scrollTop - 5000);
        }
        
        // Give Facebook MORE time to load older messages
        await sleep(3000); // Increased from 2000 to 3000
        
        scrollAttempts++;
        
        // Update progress more frequently
        const progressPercent = Math.min(80, (scrollAttempts / maxRetries) * 80);
        updateProgress(progressPercent, currentMessageCount);
        
        // Every 10 attempts, try a different approach
        if (scrollAttempts % 10 === 0) {
          console.log(`🔄 Attempt ${scrollAttempts}: Trying alternative scroll methods...`);
          
          // Try focusing different elements
          const focusElements = [
            messageContainer,
            document.querySelector('[role="main"]'),
            document.querySelector('[tabindex="0"]'),
            document.body
          ].filter(Boolean);
          
          for (const el of focusElements) {
            if (el.focus) {
              el.focus();
              await sleep(200);
              
              // Try mouse wheel events
              el.dispatchEvent(new WheelEvent('wheel', {
                deltaY: -1000,
                bubbles: true
              }));
              await sleep(200);
            }
          }
        }
      }
      
      console.log(`🏁 Backwards scrolling completed! Final message count: ${currentMessageCount}`);
      console.log(`📊 Total scroll attempts: ${scrollAttempts}`);
      
      // Final comprehensive scroll to ensure we're at the very beginning
      for (let i = 0; i < 5; i++) {
        if (messageContainer) {
          messageContainer.scrollTop = 0;
        }
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        await sleep(500);
      }
      
      // Wait for content to fully settle
      await sleep(3000);
      
      // Final count
      const finalElements = document.querySelectorAll('div[role="row"]');
      console.log(`🎯 Final message element count: ${finalElements.length}`);
      
      return finalElements.length;
    }
    
    // Simple extraction of text content only from conversation in original order
    async function extractAllMessages() {
      try {
        console.log('Starting comprehensive backwards scroll and extraction...');
        console.log('Will extract: all messages in original Messenger order');
        
        // Show initial progress
        updateProgress(5, 0);
        
        // Comprehensive backwards scroll to load ALL messages from beginning
        console.log('🔄 Phase 1: AGGRESSIVE backwards scrolling to load ALL messages...');
        chrome.runtime.sendMessage({
          type: 'progress',
          percent: 10,
          current: 0,
          total: 0,
          status: 'Scrolling to load all messages...'
        });
        
        const totalScrolledMessages = await performAdvancedScroll();
        
        console.log(`✅ Phase 1 Complete: Loaded ${totalScrolledMessages} message elements`);
        console.log(`🔍 Phase 2: COMPREHENSIVE message extraction and processing...`);
        
        chrome.runtime.sendMessage({
          type: 'progress',
          percent: 85,
          current: totalScrolledMessages,
          total: totalScrolledMessages,
          status: `Processing ${totalScrolledMessages} loaded messages...`
        });
        
        // Extract all messages with simple text extraction
        const allMessages = extractMessagesFromDOM();
        
        if (allMessages.length > 0) {
          messages.push(...allMessages);
          totalMessages = messages.length;
          
          console.log(`Successfully extracted ${totalMessages} total messages from conversation`);
          updateProgress(100, totalMessages);
        } else {
          console.log('No messages found in conversation - check if you are in the correct view');
          chrome.runtime.sendMessage({
            type: 'error',
            error: 'No messages found. Make sure you are viewing a conversation with messages.'
          });
          return;
        }
        
        // Generate simple text output in Messenger's original order with deduplication
        let output = '';
        
        // Sort messages by index to maintain original Messenger order (oldest first)
        const sortedMessages = messages.sort((a, b) => (a.index || 0) - (b.index || 0));
        
        // Remove any remaining duplicates based on content and sender with enhanced detection
        const uniqueMessages = [];
        const seenMessages = new Set();
        const seenExactContent = new Set();
        
        for (const msg of sortedMessages) {
          if (msg.type === 'message') {
            const messageKey = `${msg.sender}:${msg.content}`;
            const contentOnly = msg.content.toLowerCase().trim();
            
            // Skip if exact same message key or very similar content
            if (!seenMessages.has(messageKey) && !seenExactContent.has(contentOnly)) {
              // Check for very similar messages from same sender
              let isSimilarDuplicate = false;
              
              for (const existingContent of seenExactContent) {
                if (contentOnly.length > 10 && existingContent.length > 10) {
                  const similarity = calculateSimilarity(contentOnly, existingContent);
                  if (similarity > 0.85) { // 85% similar threshold
                    isSimilarDuplicate = true;
                    break;
                  }
                }
              }
              
              if (!isSimilarDuplicate) {
                uniqueMessages.push(msg);
                seenMessages.add(messageKey);
                seenExactContent.add(contentOnly);
              } else {
                console.log(`Removed similar duplicate: ${msg.sender} - ${msg.content.substring(0, 30)}...`);
              }
            } else {
              console.log(`Removed exact duplicate: ${msg.sender} - ${msg.content.substring(0, 30)}...`);
            }
          } else {
            // Always include date headers
            uniqueMessages.push(msg);
          }
        }
        
        console.log(`Final output: ${uniqueMessages.length} unique messages after final deduplication`);
        
        // Track current date section
        let currentDateSection = '';
        let messagesInCurrentSection = [];
        
        for (const msg of uniqueMessages) {
          if (msg.type === 'date') {
            // When we encounter a new date, output the previous section if it has messages
            if (currentDateSection && messagesInCurrentSection.length > 0) {
              output += `${currentDateSection}\n\n`;
              for (const message of messagesInCurrentSection) {
                output += `${message.sender}: ${message.content}\n`;
              }
              output += '\n';
            }
            
            // Start new date section
            currentDateSection = msg.content;
            messagesInCurrentSection = [];
            
          } else if (msg.type === 'message') {
            // Add message to current section
            messagesInCurrentSection.push(msg);
          }
        }
        
        // Output the last section if it has messages
        if (currentDateSection && messagesInCurrentSection.length > 0) {
          output += `${currentDateSection}\n\n`;
          for (const message of messagesInCurrentSection) {
            output += `${message.sender}: ${message.content}\n`;
          }
          output += '\n';
        }
        
        // If no date sections found, just output all messages in order
        if (!currentDateSection) {
          for (const msg of uniqueMessages) {
            if (msg.type === 'message') {
              output += `${msg.sender}: ${msg.content}\n`;
            }
          }
        }
        
        // Download the file
        const conversationTitle = getConversationTitle();
        const filename = `messenger_${new Date().toISOString().slice(0, 10)}_ALL_MESSAGES.txt`;

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
    extractAllMessages();
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'progress') {
    updateProgress(message.percent);
    showStatus(`Processing conversation - ${message.current || message.total || 0} messages found`, 'info');
  } else if (message.type === 'complete') {
    const filename = message.filename || 'messenger_chat.txt';
    const participants = message.participants ? message.participants.join(' and ') : 'both participants';
    showStatus(`Complete! ${message.totalMessages} text messages from ${participants} saved to ${filename}`, 'success');
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
