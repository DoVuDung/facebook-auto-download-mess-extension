// background.js
let exportState = {
  isRunning: false,
  tabId: null,
  settings: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("BG received:",     // Collect elements from all selectors
    for (const selector of messageSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        allMessageElements.push(...Array.from(elements));
      }
    }
    
    // Remove duplicates (same DOM element from different selectors)  
    const uniqueElements = [...new Set(allMessageElements)];
    console.log(`Total unique message elements found: ${uniqueElements.length} on attempt ${attempt}`); // Handle ping requests
  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return false;
  }

  // Handle start export request
  if (message.action === 'startExport') {
    exportState.isRunning = true;
    exportState.tabId = message.tabId;
    exportState.settings = message.settings;
    
    console.log("🚀 Starting background export...");
    startBackgroundExport(message.tabId, message.settings);
    
    sendResponse({ success: true, message: "Export started in background" });
    return false;
  }

  // Handle stop export request  
  if (message.action === 'stopExport') {
    console.log("🛑 Stopping background export...");
    exportState.isRunning = false;
    
    if (exportState.tabId) {
      // Send stop message to content script
      chrome.tabs.sendMessage(exportState.tabId, { type: "stopScrolling" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("Stop message delivery failed:", chrome.runtime.lastError.message);
        }
      });
    }
    
    sendResponse({ success: true, message: "Export stopped" });
    return false;
  }

  // Handle export status request
  if (message.action === 'getExportStatus') {
    sendResponse({ 
      isRunning: exportState.isRunning,
      tabId: exportState.tabId 
    });
    return false;
  }

  try {
    // Always respond (even if empty) to avoid connection errors
    sendResponse({ received: true, timestamp: Date.now() });
  } catch (error) {
    console.log("Error sending response:", error);
  }

  return false;
});

// Function to start export in background
async function startBackgroundExport(tabId, settings) {
  try {
    console.log("🚀 Starting background export for tab:", tabId);
    
    // Clear any existing duplicate tracking before starting
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: () => {
        if (window.contentHashSet) {
          window.contentHashSet.clear();
        }
        if (window.processedElementIds) {
          window.processedElementIds.clear();
        }
        console.log("🧹 Cleared previous export state");
      }
    });

    // Test server connection first
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: () => {
        fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent("Test connection"))
          .then(res => res.text())
          .then(response => console.log("✅ Server connection OK:", response))
          .catch(err => console.error("❌ Server connection failed:", err));
      }
    });

    // Inject and run the export function
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: exportMessagesBackground,
      args: [settings],
    });

    console.log("✅ Export script injected successfully");
    
  } catch (error) {
    console.error("❌ Background export failed:", error);
    exportState.isRunning = false;
    
    // Try to show error in popup if it's open
    try {
      chrome.runtime.sendMessage({
        type: "exportError",
        error: error.message
      });
    } catch (e) {
      console.log("Could not send error to popup (popup may be closed)");
    }
  }
}

// Background export function that runs in page context
function exportMessagesBackground(settings) {
  console.log("Background export started with settings:", settings);
  
  let extractionCount = 0;
  let attempt = 0;
  const maxAttempts = 200;
  const processedMessages = new Set();
  let lastMessageCount = 0;
  let noProgressCount = 0;
  
  // Send progress updates to popup
  function sendProgressUpdate(status, count = extractionCount) {
    try {
      chrome.runtime.sendMessage({
        type: "progress",
        current: count,
        status: status
      });
    } catch (error) {
      console.log("Could not send progress update:", error);
    }
  }
  
  // Send to localhost server
  function sendToServer(text) {
    return fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(text))
      .then(res => res.text())
      .then(response => {
        console.log("Sent to server:", text.substring(0, 50) + "...");
        return response;
      })
      .catch(err => {
        console.error("Server error:", err);
        throw err;
      });
  }

  // Send header
  sendToServer(`Facebook Messenger Export - ${new Date().toLocaleString()}`);
  sendToServer("=" + "=".repeat(50));
  
  // Get conversation partner name
  function getConversationPartner() {
    const headerSelectors = [
      'h1[dir="auto"]',
      '[data-testid="conversation_name"]', 
      '[aria-label*="Conversation with"] h1'
    ];
    
    for (const selector of headerSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }
    return "Unknown";
  }

  const conversationPartner = getConversationPartner();
  console.log("Conversation partner:", conversationPartner);
  
  // Send initial progress update
  sendProgressUpdate("Finding conversation messages...", 0);
  
  function extractCurrentMessages() {
    // Try multiple selectors to find message elements
    const messageSelectors = [
      'div[role="row"]',
      'div[data-testid*="message"]',
      '[data-testid*="message-container"]',
      'div[aria-label*="message"]'
    ];
    
    let allMessageElements = [];
    
    // Collect elements from all selectors
    for (const selector of messageSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log(`� Found ${elements.length} elements with selector: ${selector}`);
        allMessageElements.push(...Array.from(elements));
      }
    }
    
    // Remove duplicates (same DOM element from different selectors)  
    const uniqueElements = [...new Set(allMessageElements)];
    console.log(`🔍 Total unique message elements found: ${uniqueElements.length} on attempt ${attempt}`);
    
    let newMessages = 0;
    
    uniqueElements.forEach((element, index) => {
      const text = element.textContent?.trim();
      if (!text || text.length < 3) return;
      
      // Create unique ID for this message using position and content
      const rect = element.getBoundingClientRect();
      const messageId = text.substring(0, 100) + '_' + Math.round(rect.top) + '_' + Math.round(rect.left);
      
      if (processedMessages.has(messageId)) return;
      
      // Skip obvious UI elements
      if (text.match(/^(Enter|SEND|SENT|EDITED|Delivered|Seen|Read|Active now|Online|Offline)$/i) ||
          text.match(/^\d{1,2}:\d{2}\s*(AM|PM)?$/i) ||
          text.includes("Search in conversation") ||
          text.includes("Message requests")) {
        return;
      }
      
      processedMessages.add(messageId);
      newMessages++;
      
      // Determine sender based on position
      const windowWidth = window.innerWidth;
      const isRightAligned = rect.left > windowWidth * 0.6;
      
      // Try to find explicit sender name first
      let sender = null;
      const senderElements = element.querySelectorAll('h4, h5, strong, [data-testid*="sender"]');
      for (const senderEl of senderElements) {
        const senderText = senderEl.textContent?.trim();
        if (senderText && senderText.length > 0 && senderText.length < 50 && 
            !senderText.match(/^\d{1,2}:\d{2}/) && senderText !== text) {
          sender = senderText.toUpperCase();
          break;
        }
      }
      
      // Fallback to position-based detection
      if (!sender) {
        sender = isRightAligned ? "YOU" : conversationPartner.toUpperCase();
      }
      
      // Clean the message text more thoroughly
      let cleanText = text
        .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/gi, "") // Remove timestamps
        .replace(/\b(Active|Online|Offline|Enter|SEND|SENT|EDITED|Delivered|Seen|Read)\b/gi, "") // Remove UI text
        .replace(/\bYou sent\b/gi, "") // Remove "You sent"
        .replace(/^\s*:\s*/, "") // Remove leading colons
        .replace(/\s+/g, " ")
        .trim();
      
      // Remove sender name from content if it appears at the beginning
      if (sender && cleanText.toLowerCase().startsWith(sender.toLowerCase())) {
        cleanText = cleanText.substring(sender.length).replace(/^\s*:?\s*/, "").trim();
      }
      
      if (cleanText.length > 2 && cleanText.length < 5000) {
        const timestamp = text.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM)?)\b/i);
        const formattedMessage = timestamp ? 
          `${sender} [${timestamp[1]}]: ${cleanText}` : 
          `${sender}: ${cleanText}`;
        
        sendToServer(formattedMessage);
        extractionCount++;
        
        // Log sample messages for debugging
        if (extractionCount <= 10 || extractionCount % 50 === 0) {
          console.log(`Sample message ${extractionCount}: ${formattedMessage.substring(0, 100)}...`);
        }
        
        // Send progress update every 10 messages
        if (extractionCount % 10 === 0) {
          sendProgressUpdate(`Extracted ${extractionCount} messages...`, extractionCount);
        }
      }
    });
    
    console.log(`Extracted ${newMessages} new messages (Total processed: ${processedMessages.size})`);
    sendProgressUpdate(`Found ${newMessages} new messages. Total: ${extractionCount}`, extractionCount);
    return newMessages;
  }
  
  function scrollAndExtract() {
    if (attempt >= maxAttempts) {
      console.log("Reached max attempts, stopping extraction");
      sendProgressUpdate("Export completed - reached maximum attempts", extractionCount);
      sendToServer("--- Export Completed ---");
      
      // Send completion message to popup
      try {
        chrome.runtime.sendMessage({ type: "exportComplete" });
      } catch (error) {
        console.log("Could not send completion message:", error);
      }
      return;
    }
    
    attempt++;
    const newMessages = extractCurrentMessages();
    
    if (newMessages === 0) {
      noProgressCount++;
      if (noProgressCount >= 5) {
        console.log("No new messages found for 5 attempts, stopping");
        sendProgressUpdate("Export completed - no more messages found", extractionCount);
        sendToServer("--- Export Completed ---");
        
        // Send completion message to popup
        try {
          chrome.runtime.sendMessage({ type: "exportComplete" });
        } catch (error) {
          console.log("Could not send completion message:", error);
        }
        return;
      }
    } else {
      noProgressCount = 0;
    }
    
    console.log(`Attempt ${attempt}: Found ${newMessages} new messages, Total: ${extractionCount}`);
    sendProgressUpdate(`Scrolling... Attempt ${attempt} - Total messages: ${extractionCount}`, extractionCount);
    
    // Find the correct scrollable container for Facebook Messenger
    let scrollableElement = null;
    
    // Try multiple selectors for the conversation container
    const containerSelectors = [
      '[role="log"]',  // Most common for FB Messenger
      '[role="main"] [role="log"]',
      '[data-testid="conversation-viewer"]',
      '[aria-label="Message list"]',
      'main [role="log"]',
      '[role="main"]',
      'main'
    ];
    
    for (const selector of containerSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const hasMessages = element.querySelectorAll('div[role="row"]').length > 0;
        if (hasMessages) {
          scrollableElement = element;
          console.log(`Found scrollable container: ${selector}`);
          break;
        }
      }
    }
    
    if (!scrollableElement) {
      console.log("No scrollable container found, using window");
      scrollableElement = window;
    }
    
    // Get current scroll position before scrolling
    const beforeScroll = scrollableElement.scrollTop || window.pageYOffset;
    console.log(`Current scroll position: ${beforeScroll}`);
    
    // Scroll UP to load older messages (Facebook loads older content at the top)
    if (scrollableElement === window) {
      // For window, scroll to very top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      console.log("Scrolled window to top");
    } else {
      // For containers, scroll to the very beginning
      scrollableElement.scrollTop = 0;
      console.log("Scrolled container to top");
      
      // Also try programmatic scroll for stubborn containers
      setTimeout(() => {
        if (scrollableElement.scrollTo) {
          scrollableElement.scrollTo({ top: 0, behavior: 'instant' });
        }
        // Force a second scroll attempt
        scrollableElement.scrollTop = 0;
      }, 200);
    }
    
    // Check if we've reached the absolute top
    setTimeout(() => {
      const afterScroll = scrollableElement.scrollTop || window.pageYOffset;
      console.log(`After scroll position: ${afterScroll}`);
      
      if (afterScroll === beforeScroll && afterScroll === 0 && noProgressCount >= 3) {
        console.log("Reached top of conversation and no new messages, stopping");
        sendProgressUpdate("Export completed - reached top of conversation", extractionCount);
        sendToServer("--- Export Completed ---");
        
        // Send completion message to popup
        try {
          chrome.runtime.sendMessage({ type: "exportComplete" });
        } catch (error) {
          console.log("Could not send completion message:", error);
        }
        return;
      }
    }, 500);
    
    // Wait for content to load, then continue
    const delay = Math.random() * (settings.delayMax - settings.delayMin) + settings.delayMin;
    setTimeout(scrollAndExtract, delay);
  }
  
  // Start extraction after a brief delay
  setTimeout(() => {
    console.log("🚀 Starting message extraction...");
    console.log("🔧 Settings:", settings);
    console.log("📍 Current URL:", window.location.href);
    console.log("👥 Conversation partner:", conversationPartner);
    
    // Initial analysis of the page
    const initialAnalysis = () => {
      const allDivs = document.querySelectorAll('div').length;
      const roleRows = document.querySelectorAll('div[role="row"]').length;
      const messageTestIds = document.querySelectorAll('[data-testid*="message"]').length;
      const roleLogs = document.querySelectorAll('[role="log"]').length;
      
      console.log("📊 Page analysis:");
      console.log(`  - Total divs: ${allDivs}`);
      console.log(`  - Role="row" elements: ${roleRows}`);
      console.log(`  - Message testids: ${messageTestIds}`);
      console.log(`  - Role="log" containers: ${roleLogs}`);
      
      // Check if we can find conversation container
      const containerSelectors = [
        '[role="log"]',
        '[role="main"] [role="log"]', 
        '[data-testid="conversation-viewer"]',
        '[aria-label="Message list"]'
      ];
      
      for (const selector of containerSelectors) {
        const container = document.querySelector(selector);
        if (container) {
          const rect = container.getBoundingClientRect();
          console.log(`✅ Found container "${selector}": ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`);
          break;
        }
      }
    };
    
    initialAnalysis();
    scrollAndExtract();
  }, 1000);
}
