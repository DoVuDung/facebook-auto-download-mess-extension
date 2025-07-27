let isExporting = false;
let currentTab = null;
let messageCount = 0;

// DOM elements - Updated interface
const statusDiv = document.getElementById("status");
const startExportBtn = document.getElementById("startExport");
const stopExportBtn = document.getElementById("stopExport");
const initialControls = document.getElementById("initialControls");
const runningInterface = document.getElementById("runningInterface");
const messageCountSpan = document.getElementById("messageCount");
const scrollStatusDiv = document.getElementById("scrollStatus");

// Settings
const delayMinInput = document.getElementById("delayMin");
const delayMaxInput = document.getElementById("delayMax");

// Show status message
function showStatus(message, type = "info") {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = "block";

  if (type === "success" || type === "error") {
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 3000);
  }
}

// Switch to running interface
function showRunningInterface() {
  initialControls.classList.add("hidden");
  runningInterface.classList.add("active");
}

// Switch back to initial interface
function showInitialInterface() {
  initialControls.classList.remove("hidden");
  runningInterface.classList.remove("active");
}

// Update progress bar (removed - no longer needed)
function updateProgress(percent) {
  // Progress bar removed - no longer needed
}

// Update messages count
function updateMessagesCount(count) {
  messageCount = count;
  if (messageCountSpan) {
    messageCountSpan.textContent = count;
  }
}

// Update scroll status
function updateScrollStatus(status) {
  if (scrollStatusDiv) {
    scrollStatusDiv.textContent = status;
  }
}

// Check if background script is available
async function checkBackgroundAvailable() {
  try {
    const check = await chrome.runtime.sendMessage({ action: 'ping' });
    if (!check?.alive) throw new Error('Dead listener');
    return true;
  } catch (e) {
    console.warn("Background not listening");
    return false;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "progress") {
    updateMessagesCount(message.current || 0);
    updateScrollStatus(message.status || "Processing...");
    
    if (message.status) {
      showStatus(message.status, "info");
    }
  }
  
  if (message.type === "exportComplete") {
    updateScrollStatus("Export completed!");
    showStatus("Export completed successfully!", "success");
    resetUI();
  }
  
  if (message.type === "exportError") {
    updateScrollStatus("Export failed");
    showStatus("Export failed: " + (message.error || "Unknown error"), "error");
    resetUI();
  }
  
  sendResponse({ received: true });
});

// Check if user is on Facebook Messenger
async function checkCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    currentTab = tab;

    if (
      !tab.url.includes("facebook.com") &&
      !tab.url.includes("messenger.com")
    ) {
      showStatus("Please open Facebook Messenger first", "error");
      startExportBtn.disabled = true;
      return false;
    }

    if (!tab.url.includes("/messages") && !tab.url.includes("/t/")) {
      showStatus("Please open a specific conversation", "error");
      startExportBtn.disabled = true;
      return false;
    }

    showStatus("Ready to export!", "success");
    startExportBtn.disabled = false;
    return true;
  } catch (error) {
    showStatus("Error checking page: " + error.message, "error");
    startExportBtn.disabled = true;
    return false;
  }
}

// Reset UI state
function resetUI() {
  isExporting = false;
  messageCount = 0;
  updateMessagesCount(0);
  updateScrollStatus("Ready");
  showInitialInterface();
  startExportBtn.disabled = false;
}

// Start export process
async function startExport() {
  if (!currentTab || isExporting) return;

  // Check if background script is available
  const backgroundAvailable = await checkBackgroundAvailable();
  if (!backgroundAvailable) {
    showStatus("Extension background not responding. Try reloading the extension.", "error");
    return;
  }

  isExporting = true;
  messageCount = 0;
  updateMessagesCount(0);
  updateScrollStatus("Initializing...");
  showRunningInterface();
  showStatus("Starting export...", "info");

  const settings = {
    includeDates: true,
    includeTimestamps: true,
    clearDOM: true,
    delayMin: parseInt(delayMinInput.value) || 1000,
    delayMax: parseInt(delayMaxInput.value) || 5000,
  };

  try {
    // Test server connection first
    console.log("Testing server connection...");
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: () => {
        console.log("Testing server connection from page...");
        fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent("Test connection from popup"))
          .then(res => res.text())
          .then(response => console.log("Server connection test result:", response))
          .catch(err => console.error("Server connection test failed:", err));
      }
    });

    // Inject the export script directly into the current tab
    console.log("Injecting export script...");
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: exportMessagesInPage,
      args: [settings],
    });

    console.log("Export script injected successfully");
    showStatus("Export started. Keep popup open to see progress.", "success");
    updateScrollStatus("Starting extraction...");

  } catch (error) {
    showStatus("Export failed: " + error.message, "error");
    console.error("Export error:", error);
    resetUI();
  }
}

// Export function that runs directly in the page
function exportMessagesInPage(settings) {
  console.log("=== EXPORT SCRIPT STARTED ===");
  console.log("Starting message extraction with settings:", settings);
  console.log("Current URL:", window.location.href);
  console.log("Page title:", document.title);
  
  // Test if we can find any messages immediately
  const testMessages = document.querySelectorAll('div[role="row"]').length;
  console.log("Found", testMessages, "div[role=row] elements on page");
  
  let extractionCount = 0;
  let attempt = 0;
  const maxAttempts = 200;
  const processedMessages = new Set();
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
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        allMessageElements.push(...Array.from(elements));
      }
    }
    
    // Remove duplicates (same DOM element from different selectors)  
    const uniqueElements = [...new Set(allMessageElements)];
    console.log(`Total unique message elements found: ${uniqueElements.length} on attempt ${attempt}`);
    
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
      
      // Clean the message text
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
    console.log(`SCROLL DEBUG: Current scroll position: ${beforeScroll}`);
    console.log(`SCROLL DEBUG: Element type:`, scrollableElement === window ? "window" : scrollableElement.tagName);
    
    // Scroll UP to load older messages (Facebook loads older content at the top)
    if (scrollableElement === window) {
      // For window, scroll to very top
      console.log("SCROLL DEBUG: Scrolling window to top");
      window.scrollTo({ top: 0, behavior: 'smooth' });
      console.log("SCROLL DEBUG: Window scroll command sent");
    } else {
      // For containers, scroll to the very beginning
      console.log("SCROLL DEBUG: Scrolling container to top, current scrollTop:", scrollableElement.scrollTop);
      scrollableElement.scrollTop = 0;
      console.log("SCROLL DEBUG: Container scrollTop set to 0, new value:", scrollableElement.scrollTop);
      
      // Also try programmatic scroll for stubborn containers
      setTimeout(() => {
        if (scrollableElement.scrollTo) {
          scrollableElement.scrollTo({ top: 0, behavior: 'instant' });
          console.log("SCROLL DEBUG: Applied scrollTo with behavior instant");
        }
        // Force a second scroll attempt
        scrollableElement.scrollTop = 0;
        console.log("SCROLL DEBUG: Forced second scroll attempt, final scrollTop:", scrollableElement.scrollTop);
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
    console.log("Starting message extraction...");
    console.log("Settings:", settings);
    console.log("Current URL:", window.location.href);
    console.log("Conversation partner:", conversationPartner);
    
    // Initial analysis of the page
    const initialAnalysis = () => {
      const allDivs = document.querySelectorAll('div').length;
      const roleRows = document.querySelectorAll('div[role="row"]').length;
      const messageTestIds = document.querySelectorAll('[data-testid*="message"]').length;
      const roleLogs = document.querySelectorAll('[role="log"]').length;
      
      console.log("Page analysis:");
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
          console.log(`Found container "${selector}": ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`);
          break;
        }
      }
    };
    
    initialAnalysis();
    scrollAndExtract();
  }, 1000);
}

// Stop export process
async function stopExport() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'stopExport'
    });

    if (response && response.success) {
      showStatus("Export stopped", "info");
      isExporting = false;
      resetUI();
    } else {
      throw new Error("Failed to stop export");
    }
  } catch (error) {
    console.log("Could not send stop message:", error.message);
    showStatus("Export stopped", "info");
    isExporting = false;
    resetUI();
  }
}

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup loaded - ready for export");
  
  // Check current page
  await checkCurrentPage();
  
  // Set up event listeners
  startExportBtn.addEventListener("click", startExport);
  stopExportBtn.addEventListener("click", stopExport);
  
  // Check if export is already running
  try {
    const status = await chrome.runtime.sendMessage({ action: 'getExportStatus' });
    if (status && status.isRunning) {
      isExporting = true;
      showRunningInterface();
      showStatus("Export running in background", "info");
      updateScrollStatus("Running in background...");
    }
  } catch (error) {
    console.log("Could not check export status:", error);
  }
});
