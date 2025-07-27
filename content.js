// Content script for Facebook Messenger Chat Exporter
// This script runs on Facebook Messenger pages and handles background export

console.log('Messenger Chat Exporter content script loaded');

// Global export state
let isExporting = false;
let exportSettings = null;
let shouldStop = false;

// Export variables from the original injected function
let messageMap = new Map();
let processedElementIds = new Set();
let messageIndex = 0;
let dateOrder = new Map();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received:', message);
  
  if (message.type === 'startExport') {
    startBackgroundExport(message.settings);
    sendResponse({ success: true });
  }
  
  if (message.type === 'stopExport') {
    stopBackgroundExport();
    sendResponse({ success: true });
  }
  
  if (message.type === 'manualScroll') {
    performManualScroll();
    sendResponse({ success: true });
  }
  
  // Legacy support for popup injection
  if (message.type === "stopScrolling") {
    shouldStop = true;
    sendResponse({ success: true });
  }
  
  return false;
});

// Start background export
async function startBackgroundExport(settings) {
  if (isExporting) {
    console.log('Export already running');
    return;
  }
  
  isExporting = true;
  shouldStop = false;
  exportSettings = settings;
  
  // Reset state
  messageMap = new Map();
  processedElementIds = new Set();
  messageIndex = 0;
  dateOrder = new Map();
  window.contentHashSet = new Set();
  window.processedElementIds = new Set();
  
  console.log('=== BACKGROUND EXPORT STARTED ===');
  console.log('Settings:', settings);
  
  try {
    await performBackgroundExport();
  } catch (error) {
    console.error('Export error:', error);
    chrome.runtime.sendMessage({
      type: 'exportError',
      error: error.message
    });
  } finally {
    isExporting = false;
  }
}

// Stop background export
function stopBackgroundExport() {
  shouldStop = true;
  console.log('=== BACKGROUND EXPORT STOP REQUESTED ===');
  
  if (isExporting) {
    chrome.runtime.sendMessage({
      type: 'exportStopped',
      finalCount: messageMap.size
    });
  }
  
  isExporting = false;
}

// Perform manual scroll and extract
async function performManualScroll() {
  if (!isExporting) {
    console.log('Manual scroll requested but export not running');
    return;
  }
  
  console.log('=== MANUAL SCROLL REQUESTED ===');
  
  // Perform one scroll cycle
  await performScrollCycle();
}

// Main background export function (moved from popup.js injection)
async function performBackgroundExport() {
  console.log('=== STARTING BACKGROUND EXPORT ===');
  
  // Function to send one line at a time to local server API with error handling
  function sendLineToLocalServer(text) {
    fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(text))
      .then((res) => res.text())
      .then((response) => {
        console.log("API Response:", response);
      })
      .catch((err) => {
        console.error("Failed to save to API:", err);
      });
  }

  // Safe function to send progress updates with error handling
  function safeUpdateProgress(percent, current, total, status, scrollAttempts = 0) {
    try {
      chrome.runtime.sendMessage({
        type: "progress",
        percent: percent,
        current: current,
        total: total,
        status: status,
        scrollAttempts: scrollAttempts
      });
    } catch (error) {
      console.log("Progress update failed:", error.message);
    }
  }
  
  // Initial extraction
  const initialSave = extractAndSaveMessagesToMap(true);
  let currentMessageCount = initialSave.totalInMap;
  
  safeUpdateProgress(10, currentMessageCount, currentMessageCount, "Starting background export...");
  
  // Start continuous scrolling and extraction
  let scrollAttempts = 0;
  let consecutiveNoChange = 0;
  const maxRetries = 1000; // High limit for background operation
  
  while (scrollAttempts < maxRetries && !shouldStop) {
    scrollAttempts++;
    
    // Update progress
    const progressPercent = Math.min(85, (scrollAttempts / maxRetries) * 80);
    safeUpdateProgress(
      progressPercent,
      currentMessageCount,
      currentMessageCount,
      `Background export running... (${currentMessageCount} messages, ${scrollAttempts} attempts)`,
      scrollAttempts
    );
    
    // Perform scroll and extract
    const result = await performScrollCycle();
    
    if (result.newMessages > 0) {
      currentMessageCount = result.totalInMap;
      consecutiveNoChange = 0;
      console.log(`Found ${result.newMessages} new messages (total: ${currentMessageCount})`);
    } else {
      consecutiveNoChange++;
      console.log(`No new messages found (${consecutiveNoChange} consecutive)`);
    }
    
    // Stop if no progress for too long
    if (consecutiveNoChange >= 20) {
      console.log('=== STOPPING: No new messages found ===');
      break;
    }
    
    // Wait between attempts
    await sleep(1500);
    
    // Check for stop request
    if (shouldStop) {
      console.log('=== STOPPING: User requested ===');
      break;
    }
  }
  
  // Export completed
  safeUpdateProgress(100, currentMessageCount, currentMessageCount, "Export completed!");
  
  chrome.runtime.sendMessage({
    type: 'exportComplete',
    totalMessages: currentMessageCount,
    scrollAttempts: scrollAttempts
  });
  
  console.log(`=== BACKGROUND EXPORT COMPLETED: ${currentMessageCount} messages ===`);
}

// Perform one scroll cycle (extracted from original function)
async function performScrollCycle() {
  // Find conversation container
  let conversationDetailContainer = findConversationContainer();
  
  if (!conversationDetailContainer) {
    console.log('No conversation container found');
    return { newMessages: 0, totalInMap: messageMap.size };
  }
  
  // Scroll up
  try {
    conversationDetailContainer.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
    
    // Wait for content to load
    await sleep(1000);
    
    // Extract messages
    const result = extractAndSaveMessagesToMap(false);
    return result;
    
  } catch (error) {
    console.error('Scroll cycle error:', error);
    return { newMessages: 0, totalInMap: messageMap.size };
  }
}

// Find conversation container (simplified from original)
function findConversationContainer() {
  const selectors = [
    '[role="main"] [role="log"]',
    '[role="main"] [aria-label*="Message"]',
    '[data-testid="conversation-viewer"]',
    '[aria-label="Message list"]',
    'main [role="log"]',
    '[role="main"]',
    'main'
  ];
  
  for (const selector of selectors) {
    const container = document.querySelector(selector);
    if (container) {
      const testMessages = container.querySelectorAll('div[role="row"], div[data-testid*="message"]');
      if (testMessages.length > 0) {
        console.log(`Found conversation container with ${testMessages.length} messages`);
        return container;
      }
    }
  }
  
  return null;
}

// Extract and save messages (comprehensive version from original popup.js)
function extractAndSaveMessagesToMap(isInitialSave = false) {
  let newMessagesFound = 0;
  let skippedDuplicates = 0;
  
  function sendLineToLocalServer(text) {
    fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(text))
      .then((res) => res.text())
      .then((response) => {
        console.log("API Response:", response);
      })
      .catch((err) => {
        console.error("Failed to save to API:", err);
      });
  }
  
  // Get conversation partner name for reference
  const conversationPartner = getConversationPartnerName();
  console.log('conversationPartner: ', conversationPartner);
  
  // Send initial headers
  if (isInitialSave) {
    sendLineToLocalServer(`Facebook Messenger Conversation Export`);
    sendLineToLocalServer(`Exported: ${new Date().toLocaleString()}`);
    sendLineToLocalServer(`${'='.repeat(50)}`);
    sendLineToLocalServer(``);
  }
  
  // STEP 1: Find the RIGHT-SIDE conversation detail container (exclude left sidebar)
  let conversationDetailContainer = null;

  // Method 1: Look for main conversation area with enhanced selectors
  const conversationAreaSelectors = [
    '[role="main"] [role="log"]', // Main conversation log
    '[role="main"] [aria-label*="Message"]', // Main message area
    '[data-testid="conversation-viewer"]', // Conversation viewer
    '[aria-label="Message list"]', // Message list area
    'main [role="log"]', // Main tag with log role
    '[role="complementary"] + * [role="log"]', // Content after sidebar
    '[role="main"]', // Broader main area
    'main', // Even broader main tag
    '[aria-label*="Messages"]', // Any messages area
    '[aria-label*="Conversation"]', // Any conversation area
  ];

  for (const selector of conversationAreaSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      const testMessages = container.querySelectorAll('div[role="row"], div[data-testid*="message"], div[aria-label*="message"]');
      if (testMessages.length > 0) {
        conversationDetailContainer = container;
        console.log(`Found conversation container using selector: ${selector} with ${testMessages.length} message elements`);
        break;
      }
    }
  }

  // Method 2: Find the container with actual message content (not sidebar) - ENHANCED
  if (!conversationDetailContainer) {
    console.log("Method 1 failed, trying Method 2: analyzing containers with message content...");

    // Look for containers that have message-like content with broader criteria
    const potentialContainers = document.querySelectorAll(
      'div[role="log"], div[aria-label*="Message"], main > div, [role="main"] > div, main, [role="main"], div[data-testid*="conversation"], div[aria-label*="conversation"]'
    );

    let bestContainer = null;
    let maxMessages = 0;

    for (const container of potentialContainers) {
      // Try multiple message selectors
      const messageSelectors = [
        'div[role="row"]',
        'div[data-testid*="message"]', 
        'div[aria-label*="message"]',
        '[data-testid*="message-container"]',
        'div[dir="auto"]' // Common in Facebook
      ];
      
      let totalMessages = 0;
      for (const selector of messageSelectors) {
        totalMessages += container.querySelectorAll(selector).length;
      }
      
      const containerRect = container.getBoundingClientRect();

      // Right-side container should be:
      // 1. Have actual messages 
      // 2. Be positioned more to the right (not in left sidebar)
      // 3. Be reasonably wide (not a narrow sidebar)

      if (
        totalMessages > maxMessages && // Look for container with most messages
        containerRect.left > window.innerWidth * 0.1 && // Very permissive left position
        containerRect.width > window.innerWidth * 0.2 // Allow narrower containers
      ) {
        console.log(`Found potential container with ${totalMessages} message elements, width: ${containerRect.width}, left: ${containerRect.left}`);
        maxMessages = totalMessages;
        bestContainer = container;
      }
    }
    
    if (bestContainer) {
      conversationDetailContainer = bestContainer;
      console.log(`Method 2 success: Selected container with ${maxMessages} message elements`);
    }
  }

  // Method 3: Fallback to document-wide search with intelligent filtering
  if (!conversationDetailContainer) {
    console.log("Method 2 failed, trying Method 3: document-wide search...");
    conversationDetailContainer = document;
  }

  if (!conversationDetailContainer) {
    console.log("No conversation container found");
    return { newMessages: 0, totalInMap: messageMap.size };
  }

  // STEP 2: Extract messages using MULTIPLE selectors and save to Map
  const messageSelectors = [
    'div[role="row"]',
    'div[data-testid*="message"]', 
    'div[aria-label*="message"]',
    '[data-testid*="message-container"]',
    'div[dir="auto"]' // Common Facebook pattern
  ];
  
  let allMessageElements = [];
  
  // Collect elements from all selectors
  for (const selector of messageSelectors) {
    const elements = conversationDetailContainer.querySelectorAll(selector);
    console.log(`Found ${elements.length} elements with selector: ${selector}`);
    allMessageElements.push(...Array.from(elements));
  }
  
  // Remove duplicates (same DOM element from different selectors)
  const uniqueElements = [...new Set(allMessageElements)];
  const messageElements = uniqueElements;
  
  console.log(`Total unique message elements to process: ${messageElements.length}`);

  let validMessages = 0;
  let skippedElements = 0;

  for (let i = 0; i < messageElements.length; i++) {
    const element = messageElements[i];
    const elementText = element.textContent?.trim() || "";

    // Skip completely empty elements
    if (elementText.length < 1) {
      skippedElements++;
      continue;
    }

    // Create unique identifier for this DOM element
    const elementId = `elem_${i}_${elementText.substring(0, 50).replace(/\s+/g, '_')}`;
    
    // Skip if we've already processed this element
    if (processedElementIds.has(elementId)) {
      skippedDuplicates++;
      continue;
    }

    // SIMPLIFIED: Skip only obvious UI contamination and sidebar content
    if (isUIContent(elementText)) {
      skippedElements++;
      continue;
    }

    // RELAXED: Check if element is in a reasonable area - be very permissive
    const elementRect = element.getBoundingClientRect();
    const isInReasonableArea =
      elementRect.left > -100 && // Allow elements slightly off-screen
      elementRect.width > 10 && // Allow very narrow elements
      elementRect.height > 5; // Allow very short elements

    if (!isInReasonableArea) {
      skippedElements++;
      continue;
    }

    try {
      const messageData = extractTextContent(
        element,
        messageIndex, // Use global index
        conversationPartner
      );
      
      if (
        messageData &&
        messageData.content &&
        messageData.content.trim()
      ) {
        // Accept messages with much more permissive criteria
        if (messageData.type === "message") {
          // Accept messages if they have ANY reasonable content - be very permissive
          if (
            messageData.content.length >= 1 &&
            messageData.content.length <= 5000 &&
            !isSystemMessage(messageData.content)
          ) {
            // Create unique message key for Map
            const messageKey = `${messageData.sender}_${messageData.content.substring(0, 100)}_${messageIndex}`;
            
            // Check for duplicates
            if (!isDuplicateMessage(messageData)) {
              // Add to Map
              messageData.mapIndex = messageIndex++;
              messageData.elementId = elementId;
              messageData.scrollOrder = messageIndex;
              messageData.extractionTime = Date.now();
              
              messageMap.set(messageKey, messageData);
              processedElementIds.add(elementId);
              validMessages++;
              newMessagesFound++;

              // Send message line immediately to localhost
              const formattedLine = exportSettings.includeTimestamps && messageData.timestamp 
                ? `${messageData.sender} [${messageData.timestamp}]: ${messageData.content}`
                : `${messageData.sender}: ${messageData.content}`;
              sendLineToLocalServer(formattedLine);

              if (validMessages % 10 === 0) {
                console.log(`Valid messages in Map: ${messageMap.size}...`);
              }

              // Debug: log sample messages
              if (messageMap.size <= 10 || (messageMap.size % 100 === 0)) {
                console.log(
                  `Sample message ${messageMap.size}: ${
                    messageData.sender
                  } - ${messageData.content.substring(0, 50)}`
                );
              }
            } else {
              skippedDuplicates++;
            }
          }
        } else if (messageData.type === "date") {
          // Always include date headers with proper ordering
          const dateKey = `date_${messageData.content}_${messageIndex}`;
          messageData.mapIndex = messageIndex++;
          messageData.elementId = elementId;
          
          // Track date progression for proper ordering
          dateOrder.set(messageData.content, messageIndex);
          
          messageMap.set(dateKey, messageData);
          processedElementIds.add(elementId);
          newMessagesFound++;

          // Send date header immediately to localhost
          sendLineToLocalServer(`--- ${messageData.content} ---`);
        }
      }
    } catch (error) {
      console.warn(`Error processing element ${i + 1}:`, error);
      skippedElements++;
    }
  }

  console.log(`Extraction completed: ${newMessagesFound} new messages found (total: ${messageMap.size})`);
  return { 
    newMessages: newMessagesFound, 
    totalInMap: messageMap.size,
    container: conversationDetailContainer 
  };
}

// Helper functions (simplified from original)
function isUIContent(text) {
  const uiPatterns = [
    "Search in conversation", "View profile", "Conversation settings", "Message requests", 
    "Something went wrong", "Active now", "Online", "Offline", "New messages", "Load more",
    "Enter", "SEND", "SENT", "EDITED", "Facebook", "Privacy Policy", "Terms of Service",
    "People", "See all in Messenger", "Create group", "All chats", "Marketplace"
  ];
  return uiPatterns.some(pattern => text.includes(pattern)) || 
         text.match(/^\d+\s+(minutes?|hours?|days?)\s+ago$/i);
}

function isSystemMessage(content) {
  const systemPatterns = [
    "sent a message", "started a call", "missed call", "reacted to", "liked a message",
    "loved a message", "left the group", "joined the group", "This person is unavailable on Messenger",
    "You are now connected on Messenger", "Say hi to your new connection"
  ];
  const contentLower = content.toLowerCase();
  return systemPatterns.some((pattern) => contentLower.includes(pattern.toLowerCase()));
}

// Enhanced helper to get conversation partner name 
function getConversationPartnerName() {
  // Priority 1: Look for conversation header/title
  const headerSelectors = [
    'h1[dir="auto"]',
    '[data-testid="conversation_name"]',
    '[aria-label*="Conversation with"] h1',
    'div[role="banner"] h1',
    "header h1 span",
    'div[role="banner"] span[dir="auto"]',
  ];

  for (const selector of headerSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      let name = el.textContent.trim();
      
      // Clean up the name - remove common UI text
      name = name.replace(/\s*\(.*?\)\s*/g, ""); // Remove parentheses content
      name = name.replace(/\s*-\s*Messenger.*$/i, ""); // Remove "- Messenger" suffix
      name = name.replace(/\s*•.*$/g, ""); // Remove bullet points and after
      name = name.trim();

      // Validate name - must be reasonable length and not UI text
      if (
        name &&
        name.length > 0 &&
        name.length < 100 &&
        !name.toLowerCase().includes("messenger") &&
        !name.toLowerCase().includes("facebook") &&
        !name.toLowerCase().includes("chat") &&
        !name.toLowerCase().includes("active") &&
        !name.toLowerCase().includes("online") &&
        !name.match(/^\d+$/) &&
        !name.includes("•") &&
        name !== "Messages"
      ) {
        return name;
      }
    }
  }
  
  return "OTHER PERSON";
}

// ROBUST: Extract actual message content with broader acceptance
function extractTextContent(element, index, conversationPartner) {
  const fullText = element.textContent?.trim() || "";

  // Skip completely empty elements
  if (!fullText) {
    return null;
  }

  // === DATE HEADER DETECTION ===
  const isDateElement = fullText.match(
    /\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)|Yesterday at \d{1,2}:\d{2}|Today at \d{1,2}:\d{2}/i
  );

  // Enhanced date detection - also check if it's a standalone date without message content
  const isStandaloneDateElement = fullText.match(
    /^(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\w{3}\s+\d{1,2}:\d{2}|\d{1,2}\s+\w{3}\s+AT\s+\d{1,2}:\d{2}).*$/i
  ) && fullText.length < 100;

  if ((isDateElement || isStandaloneDateElement) && fullText.length < 100) {
    // Clean up the date content to remove mixed UI elements
    let cleanDateContent = fullText
      .replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$/gi, '') // Remove trailing day+time
      .replace(/\b(AM|PM)\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$/gi, '$1') // Keep AM/PM but remove trailing day+time
      .replace(/\s+/g, ' ')
      .trim();
    
    return {
      type: "date",
      content: cleanDateContent,
      index: index,
      chronoOrder: index // Will be set by caller
    };
  }

  // === ENHANCED SENDER IDENTIFICATION ===
  const rect = element.getBoundingClientRect();
  const isRightAligned = rect.right > window.innerWidth * 0.55; // More lenient
  const isLeftAligned = rect.left < window.innerWidth * 0.45; // More lenient

  let sender = "UNKNOWN";
  let foundExplicitSender = false;

  // Method 1: Look for explicit sender name with MUCH broader acceptance
  const senderSelectors = [
    'span[dir="auto"] strong', 
    'h4', 
    'h5', 
    'span[role="text"]', 
    'strong',
    '[aria-label*="sent by"]',
    '[data-testid*="message-sender"]',
    'div[dir="auto"] > span',
    'span[dir="auto"]', // Broader span search
    'div[dir="auto"]', // Direct div content
  ];
  
  for (const selector of senderSelectors) {
    const senderElements = element.querySelectorAll(selector);
    for (const senderEl of senderElements) {
      let senderText = senderEl.textContent?.trim();
      if (senderText) {
        // Clean the sender text
        senderText = senderText.replace(/\s*:.*$/g, "");
        senderText = senderText.replace(/\s*\(.*?\)\s*/g, "");
        senderText = senderText.replace(/\s*\[.*?\]\s*/g, "");
        senderText = senderText.trim();

        // More permissive validation - accept anything reasonable
        if (
          senderText &&
          senderText.length >= 1 &&
          senderText.length <= 50 &&
          !senderText.match(/^\d+$/) && // Not just numbers
          !senderText.match(/^\d{1,2}:\d{2}/) && // Not timestamp
          !senderText.match(/AM|PM/i) &&
          !senderText.includes("•") &&
          !senderText.match(/^(Enter|SEND|SENT|EDITED|Delivered|Seen|Read)$/i) &&
          senderText !== fullText // Not the entire message content
        ) {
          sender = senderText.toUpperCase();
          foundExplicitSender = true;
          console.log(`Found explicit sender: "${sender}" using selector: ${selector}`);
          break;
        }
      }
    }
    if (foundExplicitSender) break;
  }

  // Method 2: Enhanced position-based detection as fallback
  if (!foundExplicitSender) {
    if (isRightAligned) {
      sender = "YOU";
    } else if (isLeftAligned) {
      sender = conversationPartner
        ? conversationPartner.toUpperCase()
        : "OTHER PERSON";
    } else {
      // Middle positioned - try to determine from content structure
      sender = "UNKNOWN";
    }
    console.log(`Using position-based sender detection: ${sender} (right: ${isRightAligned}, left: ${isLeftAligned})`);
  }

  // === EXTRACT TIMESTAMP FOR ORDERING ===
  let timestamp = null;
  const timestampPattern = /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/gi;
  const timestampMatch = fullText.match(timestampPattern);
  if (timestampMatch && timestampMatch.length > 0) {
    timestamp = timestampMatch[timestampMatch.length - 1]; // Use the last timestamp found
  }

  // === ENHANCED TEXT CONTENT EXTRACTION ===
  const textSelectors = [
    'div[dir="auto"]', 
    'span[dir="auto"]', 
    '[role="text"]',
    'p',
    'span',
    'div' // Broader search
  ];
  
  const textContents = [];
  const seenTexts = new Set();

  // Primary extraction from targeted elements
  for (const selector of textSelectors) {
    const textElements = element.querySelectorAll(selector);
    for (const textEl of textElements) {
      let text = textEl.textContent?.trim();
      if (text && text.length > 0) {
        // LESS aggressive filtering - only remove obvious UI elements
        if (
          !text.match(/^\d{1,2}:\d{2}/) && // Not timestamp
          !text.includes("•") &&
          text !== sender &&
          text !== sender.toLowerCase() &&
          !text.match(/AM|PM$/i) &&
          text !== "Enter" &&
          text !== "SENT" &&
          text !== "EDITED" &&
          text !== "SEND" &&
          text !== "Delivered" &&
          text !== "Seen" &&
          text !== "Read" &&
          text !== "Active now" &&
          text !== "Online" &&
          text !== "Offline" &&
          !text.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$/i) &&
          text.length >= 1 &&
          text.length < 5000 &&
          !seenTexts.has(text.toLowerCase()) // Case-insensitive duplicate check
        ) {
          textContents.push(text);
          seenTexts.add(text.toLowerCase());
        }
      }
    }
  }

  // Fallback: if no text found from sub-elements, try the main element
  if (textContents.length === 0) {
    const mainText = fullText
      .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/gi, "") // Remove timestamps
      .replace(/\b(Active|Online|Offline)\b/gi, "") // Remove status
      .replace(/\b(SENT|SEND|EDITED|Enter|Delivered|Seen|Read)\b/gi, "") // Remove UI elements
      .trim();

    if (mainText && mainText.length > 0) {
      textContents.push(mainText);
    }
  }

  const mainContent = textContents.join(" ").trim();

  // SIMPLIFIED content cleaning - be less aggressive to preserve actual content
  let cleanContent = mainContent.replace(/\s+/g, " ").trim();
  
  // Stage 1: Remove only obvious UI elements at the end/beginning
  cleanContent = cleanContent
    .replace(/\bEnter\s*$/gi, "") // Remove "Enter" at end
    .replace(/^\s*SENT\b:?\s*/gi, "") // Remove "SENT" at beginning
    .replace(/^\s*EDITED\b:?\s*/gi, "") // Remove "EDITED" at beginning
    .replace(/\bSEND\s*$/gi, "") // Remove "SEND" at end
    .replace(/^\s*You sent\b:?\s*/gi, "") // Remove "You sent" at beginning
    .replace(/\bYou sent\b/gi, "") // Remove "You sent" anywhere
    .replace(/\bDelivered\s*$/gi, "") // Remove "Delivered" at end
    .replace(/\bSeen\s*$/gi, "") // Remove "Seen" at end
    .replace(/\bRead\s*$/gi, "") // Remove "Read" at end
    .replace(/\s+/g, " ")
    .trim();

  // Stage 2: Remove obvious concatenated sender names and fix duplicate patterns
  cleanContent = cleanContent
    .replace(/^(TORBEN|YOU|OTHER PERSON)\s*:?\s*/gi, "")
    // Fix patterns like "Hello You sentHello" -> "Hello"
    .replace(/(.+?)\s+You sent\s*\1/gi, "$1")
    // Fix patterns like "YOU SENT: Text You sent You sentText" -> "Text"
    .replace(/^YOU SENT:\s*(.+?)\s+You sent\s+You sent\s*\1.*$/gi, "$1")
    // Remove repeated text patterns like "Text You sent You sentText"
    .replace(/^(.+?)\s+You sent\s+You sent\s*\1.*$/gi, "$1")
    // Clean up any remaining "You sent" variations
    .replace(/\bYou sent\s+/gi, "")
    .replace(/^([A-Z]+)\s+([a-z])/gi, (match, possibleSender, nextChar) => {
      // If it looks like "SARAHello there", convert to "Hello there" 
      if (possibleSender.length <= 15 && possibleSender !== cleanContent) {
        return nextChar.toUpperCase();
      }
      return match;
    })
    .replace(/\s+/g, " ")
    .trim();

  // Stage 3: Only handle the most obvious mixed UI content
  if (cleanContent.includes("Enter") && cleanContent.length > 10) {
    // If "Enter" appears in the middle, try to extract the meaningful part
    const parts = cleanContent.split(/\bEnter\b/gi);
    let bestPart = "";
    for (const part of parts) {
      const trimmedPart = part.trim();
      if (trimmedPart.length > bestPart.length && 
          trimmedPart.length > 3 && 
          !trimmedPart.match(/^\d{1,2}:\d{2}/i) &&
          !trimmedPart.match(/^(AM|PM)/i)) {
        bestPart = trimmedPart;
      }
    }
    if (bestPart) {
      cleanContent = bestPart;
    }
  }

  // Stage 4: Remove only trailing timestamp patterns
  cleanContent = cleanContent
    .replace(/\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}\s*$/gi, "") // Remove trailing day+time
    .replace(/\s+\d{1,2}:\d{2}\s*(AM|PM)?\s*$/gi, "") // Remove trailing time
    .replace(/^\s*:\s*/, "") // Remove leading colons
    .replace(/\s+/g, " ")
    .trim();

  // SIMPLIFIED validation - reject only obvious non-content
  if (
    !cleanContent ||
    cleanContent.length < 1 ||
    cleanContent.toLowerCase() === sender.toLowerCase() ||
    // Reject only pure UI elements
    cleanContent.match(/^(Enter|SEND|SENT|EDITED|Delivered|Seen|Read|Active now|Online|Offline)$/i) ||
    // Reject obvious timestamp patterns
    cleanContent.match(/^\d{1,2}:\d{2}\s*(AM|PM)?$/i) ||
    // Reject obvious date patterns
    cleanContent.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}:\d{2}$/i) ||
    // Reject very long suspicious content
    cleanContent.length > 5000
  ) {
    console.log(`Rejected content: "${cleanContent.substring(0, 100)}..." (${cleanContent.length} chars)`);
    return null;
  }

  console.log(`Accepted message from ${sender}: "${cleanContent.substring(0, 50)}${cleanContent.length > 50 ? '...' : ''}" (${cleanContent.length} chars)`);

  return {
    type: "message",
    index: index,
    sender: sender,
    content: cleanContent,
    timestamp: timestamp, // Add timestamp for better ordering
    chronoOrder: index // Will be set by caller
  };
}

function isDuplicateMessage(messageData) {
  for (const [key, existingMsg] of messageMap.entries()) {
    if (existingMsg.content === messageData.content && 
        existingMsg.sender === messageData.sender) {
      return true;
    }
  }
  return false;
}

async function autoScrollToTop(limit = 10) {
  let lastHeight = 0;
  let sameCount = 0;

  while (sameCount < limit) {
    window.scrollTo(0, 0);
    await sleep(1000);

    const currentHeight = document.body.scrollHeight;
    if (currentHeight === lastHeight) {
      sameCount++;
    } else {
      sameCount = 0;
      lastHeight = currentHeight;
    }
  }

  console.log("Reached top of conversation.");
}


// Add visual indicator when extension is active
function addExportIndicator() {
  // Remove existing indicator
  const existing = document.getElementById('messenger-exporter-indicator');
  if (existing) existing.remove();
  
  // Create new indicator
  const indicator = document.createElement('div');
  indicator.id = 'messenger-exporter-indicator';
  indicator.innerHTML = 'Chat Exporter Ready';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #1877f2;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  `;
  
  document.body.appendChild(indicator);
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    if (indicator && indicator.parentNode) {
      indicator.style.opacity = '0';
      indicator.style.transition = 'opacity 0.5s';
      setTimeout(() => indicator.remove(), 500);
    }
  }, 3000);
}

// Show indicator when content script loads
if (window.location.href.includes('/messages') || window.location.href.includes('/t/')) {
  addExportIndicator();
}

// Listen for URL changes (Facebook is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('/messages') || url.includes('/t/')) {
      setTimeout(addExportIndicator, 1000); // Delay to ensure page is loaded
    }
  }
}).observe(document, { subtree: true, childList: true });

// Utility functions
window.messengerExporter = {
  // Check if we're on a valid Messenger page
  isValidPage() {
    return window.location.href.includes('/messages') || window.location.href.includes('/t/');
  },
  
  // Get conversation name/title
  getConversationTitle() {
    const selectors = [
      'h1[dir="auto"]',
      '[data-testid="conversation_name"]',
      'div[role="banner"] h1',
      'span[dir="auto"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    
    return 'unknown_conversation';
  },
  
  // Show export status to user
  showStatus(message, type = 'info') {
    // Remove existing status
    const existing = document.getElementById('messenger-exporter-status');
    if (existing) existing.remove();
    
    // Create status element
    const status = document.createElement('div');
    status.id = 'messenger-exporter-status';
    status.textContent = message;
    
    const colors = {
      info: '#1877f2',
      success: '#00a400',
      error: '#e41e3f',
      warning: '#ff8c00'
    };
    
    status.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${colors[type] || colors.info};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      max-width: 300px;
      text-align: center;
    `;
    
    document.body.appendChild(status);
    
    // Auto-remove after delay
    setTimeout(() => {
      if (status && status.parentNode) {
        status.style.opacity = '0';
        status.style.transition = 'opacity 0.5s';
        setTimeout(() => status.remove(), 500);
      }
    }, type === 'error' ? 5000 : 3000);
  }
};

console.log('Messenger Chat Exporter ready');
