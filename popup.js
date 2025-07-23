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

    // Simple message extraction for text content only with enhanced filtering and deduplication
    function extractMessagesFromDOM() {
      const foundItems = [];
      const processedElements = new Set(); // Track processed elements to avoid duplicates
      
      console.log('Starting SIMPLE text-only message extraction with enhanced filtering...');
      
      // Find message containers
      const containerSelectors = [
        '[aria-label="Message list"]',
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
      console.log(`Processing ${messageElements.length} message elements for text content...`);
      
      // Process each message element for text content only
      for (let i = 0; i < messageElements.length; i++) {
        const element = messageElements[i];
        
        // Create unique identifier for this element to prevent duplicates
        const elementId = element.outerHTML.substring(0, 200) + '_' + i;
        
        if (processedElements.has(elementId)) {
          continue; // Skip already processed elements
        }
        
        // Skip elements that look like system messages or UI elements
        const elementText = element.textContent?.trim() || '';
        if (elementText.includes('conversation settings') ||
            elementText.includes('group settings') ||
            elementText.includes('Add people') ||
            elementText.includes('Create group') ||
            elementText.includes('Search in conversation') ||
            elementText.includes('Call') ||
            elementText.includes('Video chat') ||
            elementText.length === 0) {
          continue;
        }
        
        try {
          const messageData = extractTextContent(element, i);
          if (messageData && messageData.content) {
            // Enhanced duplicate detection - check multiple criteria
            const isDuplicate = foundItems.some(item => {
              // Exact content match
              if (item.content === messageData.content && item.sender === messageData.sender) {
                return true;
              }
              
              // Similar content match (for slight variations)
              if (item.sender === messageData.sender && 
                  item.content.length > 10 && 
                  messageData.content.length > 10) {
                
                const similarity = calculateSimilarity(item.content, messageData.content);
                if (similarity > 0.9) { // 90% similar
                  return true;
                }
              }
              
              return false;
            });
            
            if (!isDuplicate) {
              foundItems.push(messageData);
              processedElements.add(elementId);
            } else {
              console.log(`Skipped duplicate: ${messageData.sender} - ${messageData.content.substring(0, 30)}...`);
            }
          }
        } catch (error) {
          console.warn(`Error processing message ${i + 1}:`, error);
        }
      }
      
      console.log(`Found ${foundItems.length} unique messages after deduplication`);
      return foundItems;
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

    // SIMPLE: Extract only text content and basic sender info
    function extractTextContent(element, index) {
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
      
      // === IMPROVED SENDER IDENTIFICATION WITH BETTER FILTERING ===
      const rect = element.getBoundingClientRect();
      const isRightAligned = rect.right > window.innerWidth * 0.6;
      const isLeftAligned = rect.left < window.innerWidth * 0.4;
      
      let sender = 'UNKNOWN';
      let foundExplicitSender = false;
      
      // Method 1: Look for explicit sender name in message element with better validation
      const senderElements = element.querySelectorAll('span[dir="auto"] strong, h4, h5, [aria-label*="sent by"], span[data-testid*="message_sender"]');
      for (const senderEl of senderElements) {
        let senderText = senderEl.textContent?.trim();
        if (senderText) {
          // Clean the sender text more thoroughly
          senderText = senderText.replace(/\s*:.*$/g, ''); // Remove colon and after
          senderText = senderText.replace(/\s*\(.*?\)\s*/g, ''); // Remove parentheses
          senderText = senderText.replace(/\s*\[.*?\]\s*/g, ''); // Remove brackets
          senderText = senderText.replace(/\s*\{.*?\}\s*/g, ''); // Remove braces
          senderText = senderText.trim();
          
          // Enhanced validation for sender name
          if (senderText && 
              senderText.length >= 2 && // At least 2 characters
              senderText.length <= 100 && // Not too long
              !senderText.includes('•') && 
              !senderText.includes(':') &&
              !senderText.includes('...') &&
              !senderText.match(/^\d+$/) && // Not just numbers
              !senderText.match(/^[0-9\s]+$/) && // Not just numbers and spaces
              !senderText.match(/AM|PM/i) &&
              !senderText.match(/\d{1,2}:\d{2}/) && // Not a timestamp
              !senderText.includes('Active') &&
              !senderText.includes('ago') &&
              !senderText.includes('min') &&
              !senderText.includes('hour') &&
              !senderText.includes('day') &&
              !senderText.includes('week') &&
              !senderText.includes('Online') &&
              !senderText.includes('Offline') &&
              !senderText.includes('Typing') &&
              !senderText.includes('Seen') &&
              !senderText.includes('Delivered') &&
              !senderText.includes('Sent') &&
              !senderText.toLowerCase().includes('you') &&
              !senderText.toLowerCase().includes('me') &&
              !senderText.toLowerCase().includes('myself') &&
              !senderText.toLowerCase().includes('enter') &&
              !senderText.toLowerCase().includes('press') &&
              !senderText.toLowerCase().includes('type') &&
              !/^[^\w]/.test(senderText) && // Doesn't start with special character
              /[a-zA-Z]/.test(senderText)) { // Contains at least one letter
            
            sender = senderText.toUpperCase();
            foundExplicitSender = true;
            console.log(`Found explicit sender: "${sender}" from element: "${senderEl.textContent}"`);
            break;
          }
        }
      }
      
      // Method 2: Position-based detection if no explicit sender found
      if (!foundExplicitSender || sender === 'UNKNOWN') {
        if (isRightAligned) {
          sender = 'YOU';
        } else if (isLeftAligned) {
          const partnerName = getConversationPartnerName();
          sender = partnerName ? partnerName.toUpperCase() : 'OTHER PERSON';
        }
      }
      
      // === TEXT CONTENT EXTRACTION WITH BETTER FILTERING ===
      const dirAutoElements = element.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      const textContents = [];
      const seenTexts = new Set(); // Track seen text to avoid duplicates within same message
      
      for (const dirEl of dirAutoElements) {
        let text = dirEl.textContent?.trim();
        if (text && text.length > 0) {
          // Enhanced filtering for UI elements, sender names, timestamps, and system messages
          if (!text.match(/^\d{1,2}:\d{2}/) && 
              !text.includes('•') && 
              text !== sender &&
              text !== sender.toLowerCase() &&
              !text.match(/AM|PM$/i) &&
              !text.match(/\d{1,2}:\d{2}\s*(AM|PM)/i) &&
              text !== 'Enter' &&
              text !== 'Press Enter to send' &&
              !text.includes('Enter to send') &&
              !text.includes('Type a message') &&
              !text.includes('Aa') &&
              !text.includes('Active') &&
              !text.includes('ago') &&
              !text.includes('Online') &&
              !text.includes('Offline') &&
              !text.includes('Typing') &&
              !text.includes('min') &&
              !text.includes('hour') &&
              !text.includes('day') &&
              !text.includes('week') &&
              !text.includes('Seen') &&
              !text.includes('Delivered') &&
              !text.includes('Sent') &&
              !text.toLowerCase().includes('react') &&
              !text.toLowerCase().includes('reply') &&
              !text.toLowerCase().includes('forward') &&
              !text.toLowerCase().includes('delete') &&
              !text.toLowerCase().includes('more') &&
              !text.toLowerCase().includes('options') &&
              text.length > 0 &&
              text.length < 5000 && // Reasonable message length
              !seenTexts.has(text)) { // Avoid duplicate text within same message
            
            textContents.push(text);
            seenTexts.add(text);
          }
        }
      }
      
      const mainContent = textContents.join(' ').trim();
      
      // Additional cleanup to remove duplicate phrases and unwanted text
      let cleanContent = mainContent
        .replace(/\bEnter\b/g, '')
        .replace(/\bPress Enter to send\b/g, '')
        .replace(/\bType a message\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Remove duplicate phrases within the same message
      const words = cleanContent.split(' ');
      const uniqueWords = [];
      
      // Remove consecutive duplicate words
      for (let i = 0; i < words.length; i++) {
        if (i === 0 || words[i] !== words[i-1]) {
          uniqueWords.push(words[i]);
        }
      }
      
      cleanContent = uniqueWords.join(' ').trim();
      
      // Final validation - skip if no meaningful content or if it looks like UI text
      if (!cleanContent || 
          cleanContent.length < 1 ||
          cleanContent.match(/^[^a-zA-Z0-9]+$/) || // Only special characters
          cleanContent.toLowerCase() === sender.toLowerCase() ||
          cleanContent.toLowerCase().includes('sent a message') ||
          cleanContent.toLowerCase().includes('started a call') ||
          cleanContent.toLowerCase().includes('missed call') ||
          cleanContent.toLowerCase().includes('shared a') ||
          cleanContent.toLowerCase().includes('reacted to') ||
          cleanContent.toLowerCase().includes('liked a message') ||
          cleanContent.toLowerCase().includes('loved a message')) {
        return null;
      }
      
      console.log(`Message ${index + 1}: ${sender} - ${cleanContent.substring(0, 50)}...`);
      
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
    
    // Enhanced backwards scrolling function to load ALL messages from the beginning
    async function performAdvancedScroll() {
      console.log('Starting backwards scroll to load ALL messages from conversation beginning...');
      
      let previousMessageCount = 0;
      let currentMessageCount = 0;
      let noChangeCount = 0;
      let maxRetries = 50;
      let scrollAttempts = 0;
      
      // Find the main message container
      const messageContainer = document.querySelector('[role="log"]') || 
                              document.querySelector('[aria-label*="Message"]') || 
                              document.querySelector('[data-testid*="conversation"]');
      
      console.log('Found message container:', messageContainer ? 'YES' : 'NO');
      
      while (scrollAttempts < maxRetries) {
        // Count current messages before scrolling
        const messageElements = document.querySelectorAll('div[role="row"]');
        currentMessageCount = messageElements.length;
        
        console.log(`Scroll attempt ${scrollAttempts + 1}: ${currentMessageCount} messages found`);
        
        // Check if we got more messages
        if (currentMessageCount > previousMessageCount) {
          noChangeCount = 0;
          previousMessageCount = currentMessageCount;
          console.log(`New messages loaded! Total: ${currentMessageCount}`);
        } else {
          noChangeCount++;
          console.log(`No new messages (${noChangeCount}/5)`);
        }
        
        // Stop if no new messages for 5 attempts
        if (noChangeCount >= 5) {
          console.log('Reached conversation beginning - no more messages to load');
          break;
        }
        
        // Aggressive backwards scrolling methods
        if (messageContainer) {
          messageContainer.scrollTop = 0;
          if (messageContainer.scrollTo) {
            messageContainer.scrollTo({ top: 0, behavior: 'instant' });
          }
        }
        
        // Scroll main window to top
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        
        // Use keyboard shortcuts to go to beginning
        document.body.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { 
          key: 'Home', 
          ctrlKey: true, 
          bubbles: true 
        }));
        
        // Multiple Page Up presses to load older messages
        for (let i = 0; i < 10; i++) {
          document.dispatchEvent(new KeyboardEvent('keydown', { 
            key: 'PageUp', 
            bubbles: true 
          }));
          await sleep(100);
        }
        
        // Give Facebook time to load older messages
        await sleep(2000);
        
        scrollAttempts++;
        
        // Update progress
        const progressPercent = Math.min(85, (scrollAttempts / maxRetries) * 85);
        updateProgress(progressPercent, currentMessageCount);
      }
      
      console.log(`Backwards scrolling completed! Final message count: ${currentMessageCount}`);
      
      // Final scroll to ensure we're at the very beginning
      if (messageContainer) {
        messageContainer.scrollTop = 0;
      }
      window.scrollTo(0, 0);
      
      // Wait for content to settle
      await sleep(2000);
      
      return currentMessageCount;
    }
    
    // Simple extraction of text content only from conversation in original order
    async function extractAllMessages() {
      try {
        console.log('Starting comprehensive backwards scroll and extraction...');
        console.log('Will extract: all messages in original Messenger order');
        
        // Show initial progress
        updateProgress(10, 0);
        
        // Comprehensive backwards scroll to load ALL messages from beginning
        console.log('Phase 1: Scrolling backwards to load all messages...');
        const totalScrolledMessages = await performAdvancedScroll();
        
        console.log(`Phase 2: Processing ${totalScrolledMessages} loaded messages...`);
        
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
