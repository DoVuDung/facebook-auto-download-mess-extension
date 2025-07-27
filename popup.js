let isExporting = false;
let currentTab = null;
let backgroundExportState = null;

// DOM elements
const statusDiv = document.getElementById("status");
const checkStatusBtn = document.getElementById("checkStatus");
const startExportBtn = document.getElementById("startExport");
const stopExportBtn = document.getElementById("stopExport");
const manualScrollBtn = document.getElementById("manualScroll");
const progressDiv = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const messageCountSpan = document.getElementById("messageCount");
const scrollStatusSpan = document.getElementById("scrollStatus");
const progressInfoDiv = document.getElementById("progressInfo");

// Settings
const includeDatesCheckbox = document.getElementById("includeDates");
const includeTimestampsCheckbox = document.getElementById("includeTimestamps");
const clearDOMCheckbox = document.getElementById("clearDOM");

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

// Update progress
function updateProgress(percent) {
  progressBar.style.width = `${percent}%`;
}

// Update message count display
function updateMessageCount(count, scrollAttempts = 0) {
  if (messageCountSpan) {
    messageCountSpan.textContent = count || 0;
  }
  if (scrollStatusSpan) {
    scrollStatusSpan.textContent = scrollAttempts > 0 ? `${scrollAttempts} scroll attempts` : 'Ready';
  }
}

// Get current export state from background
async function getBackgroundExportState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getExportState' });
    backgroundExportState = response.exportState;
    return backgroundExportState;
  } catch (error) {
    console.log('Error getting background state:', error);
    return null;
  }
}

// Update UI based on background export state
function updateUIFromBackgroundState(state) {
  if (!state) return;
  
  isExporting = state.isRunning;
  
  if (state.isRunning) {
    startExportBtn.style.display = "none";
    stopExportBtn.style.display = "block";
    if (manualScrollBtn) manualScrollBtn.style.display = "block";
    progressDiv.style.display = "block";
    if (progressInfoDiv) progressInfoDiv.style.display = "block";
    
    updateProgress(state.progress || 0);
    updateMessageCount(state.currentMessages, state.scrollAttempts);
    
    const runtime = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
    showStatus(`Background export running (${runtime}s) - you can close this popup`, "info");
  } else {
    resetUI();
    
    if (state.status === 'completed') {
      showStatus(`Export completed! ${state.currentMessages} messages saved`, "success");
    } else if (state.status === 'error') {
      showStatus("Export failed", "error");
    } else if (state.status === 'stopped') {
      showStatus("Export stopped by user", "info");
    }
  }
}

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

    showStatus("Facebook Messenger detected!", "success");
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
  startExportBtn.style.display = "block";
  startExportBtn.disabled = false;
  stopExportBtn.style.display = "none";
  if (manualScrollBtn) manualScrollBtn.style.display = "none";
  progressDiv.style.display = "none";
  if (progressInfoDiv) progressInfoDiv.style.display = "none";
  updateProgress(0);
  updateMessageCount(0, 0);
}

// Start background export process
async function startExport() {
  if (!currentTab) return;

  const settings = {
    includeDates: includeDatesCheckbox.checked,
    includeTimestamps: includeTimestampsCheckbox.checked,
    clearDOM: clearDOMCheckbox.checked,
  };

  try {
    showStatus("Starting export...", "info");
    
    // First try the content script approach
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'startBackgroundExport',
        tabId: currentTab.id,
        settings: settings
      });
      
      if (response && response.exportState && response.exportState.isRunning) {
        updateUIFromBackgroundState(response.exportState);
        showStatus("Background export started - you can close this popup!", "success");
        return;
      }
    } catch (error) {
      console.log("Content script approach failed, falling back to injection:", error);
    }
    
    // Fallback to the proven injection method
    console.log("Using injection method as fallback");
    isExporting = true;
    startExportBtn.style.display = "none";
    stopExportBtn.style.display = "block";
    if (manualScrollBtn) manualScrollBtn.style.display = "block";
    progressDiv.style.display = "block";
    if (progressInfoDiv) progressInfoDiv.style.display = "block";
    
    // Clear any existing duplicate tracking before starting
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: () => {
        // Reset global duplicate tracking
        if (window.contentHashSet) {
          window.contentHashSet.clear();
          console.log("🧹 Cleared duplicate tracking hash set");
        }
        if (window.processedElementIds) {
          window.processedElementIds.clear();
          console.log("🧹 Cleared processed element IDs");
        }
        console.log("🚀 Starting fresh export with clean duplicate tracking");
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: exportMessagesInjected,
      args: [settings],
    });
    
  } catch (error) {
    showStatus("Export failed: " + error.message, "error");
    resetUI();
  }
}

// Stop background export process
async function stopExport() {
  if (isExporting) {
    // For injection method, send stop message to injected script
    try {
      chrome.tabs.sendMessage(currentTab.id, { type: "stopScrolling" });
      showStatus("Stopping and preparing export...", "info");
    } catch (error) {
      console.log("Could not send stop message to tab:", error);
    }
  }
  
  // Also try background method
  try {
    showStatus("Stopping export...", "info");
    
    const response = await chrome.runtime.sendMessage({
      type: 'stopBackgroundExport'
    });
    
    if (response) {
      showStatus("Export stop requested", "info");
    }
    
  } catch (error) {
    showStatus("Error stopping export: " + error.message, "error");
  }
}

// Manual scroll trigger
async function triggerManualScroll() {
  if (!backgroundExportState || !backgroundExportState.isRunning) {
    showStatus("No background export running", "error");
    return;
  }
  
  try {
    showStatus("Triggering manual scroll...", "info");
    
    await chrome.runtime.sendMessage({
      type: 'manualScroll'
    });
    
    showStatus("Manual scroll triggered", "success");
    
  } catch (error) {
    showStatus("Error triggering manual scroll: " + error.message, "error");
  }
}

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "progress") {
    updateProgress(message.percent || 0);
    updateMessageCount(message.current, message.scrollAttempts);
    
    if (message.status) {
      showStatus(message.status, "info");
    }
  }
  
  if (message.type === "exportComplete") {
    resetUI();
    showStatus(`Export completed! ${message.totalMessages} messages exported`, "success");
  }
  
  if (message.type === "exportError") {
    resetUI();
    showStatus("Export failed: " + (message.error || "Unknown error"), "error");
  }
  
  if (message.type === "exportStopped") {
    resetUI();
    showStatus(`Export stopped. ${message.finalCount} messages exported`, "info");
  }
  
  sendResponse({ received: true });
});

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  // Check current page
  await checkCurrentPage();
  
  // Get current background export state
  const state = await getBackgroundExportState();
  if (state) {
    updateUIFromBackgroundState(state);
  }
  
  // Set up event listeners
  checkStatusBtn.addEventListener("click", checkCurrentPage);
  startExportBtn.addEventListener("click", startExport);
  stopExportBtn.addEventListener("click", stopExport);
  
  if (manualScrollBtn) {
    manualScrollBtn.addEventListener("click", triggerManualScroll);
  }
  
  // Refresh state every 2 seconds when popup is open
  setInterval(async () => {
    const state = await getBackgroundExportState();
    if (state && state.isRunning) {
      updateUIFromBackgroundState(state);
    }
  }, 2000);
});

// Working injection function (fallback method)
function exportMessagesInjected(settings) {
  return new Promise((resolve, reject) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const messages = [];
    let totalMessages = 0;
    
    // CLEAN INITIALIZATION: Reset all duplicate tracking
    console.log("=== EXPORT SCRIPT STARTED ===");
    console.log("🧹 Initializing clean duplicate tracking...");
    
    // MAP-BASED progressive message collection with chronological ordering
    const messageMap = new Map(); // Use Map to prevent duplicates and maintain order
    const processedElementIds = new Set(); // Track processed DOM elements
    let messageIndex = 0; // Global index for ordering
    const dateOrder = new Map(); // Track date order for proper chronological sorting

    // Reset global duplicate tracking variables
    window.contentHashSet = new Set(); // Fresh hash set for this session
    window.processedElementIds = new Set(); // Fresh element tracking
    
    console.log("✅ Clean state initialized");
    console.log("Settings:", settings);

    // Function to send one line at a time to local server API with error handling
    function sendLineToLocalServer(text) {
      fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(text))
        .then((res) => res.text())
        .then((response) => {
          console.log("API Response:", response);
        })
        .catch((err) => {
          console.error("Failed to save to API:", err);
          // Don't throw error, just log it to avoid stopping the process
        });
    }

    // Safe function to send progress updates with error handling
    function safeUpdateProgress(percent, current, total, status) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: "progress",
            percent: percent,
            current: current,
            total: total,
            status: status,
          });
        }
      } catch (error) {
        console.log("Progress update failed (extension context may be invalidated):", error.message);
        // Continue execution even if progress updates fail
      }
    }

    // Check if extension context is still valid
    function isExtensionContextValid() {
      try {
        return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
      } catch (error) {
        return false;
      }
    }

    // Enhanced helper to get conversation partner name with better accuracy
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

    // Start the extraction process
    async function extractAllMessages() {
      console.log("=== STARTING MESSAGE EXTRACTION ===");
      
      // Initial extraction
      const initialSave = extractAndSaveMessagesToMap(true);
      let currentMessageCount = initialSave.totalInMap;
      
      safeUpdateProgress(10, currentMessageCount, currentMessageCount, "Starting extraction...");
      
      // Simple scrolling approach
      let scrollAttempts = 0;
      let consecutiveNoChange = 0;
      const maxRetries = 50;
      
      while (scrollAttempts < maxRetries && consecutiveNoChange < 10) {
        scrollAttempts++;
        
        // Update progress
        const progressPercent = Math.min(85, (scrollAttempts / maxRetries) * 80);
        safeUpdateProgress(
          progressPercent,
          currentMessageCount,
          currentMessageCount,
          `Extracting messages... (${currentMessageCount} found, ${scrollAttempts} attempts)`
        );
        
        // Find conversation container and scroll
        const container = findConversationContainer();
        if (container) {
          container.scrollTop = 0;
          window.scrollTo({ top: 0, behavior: "instant" });
        }
        
        // Wait for content to load
        await sleep(1500);
        
        // Extract new messages
        const result = extractAndSaveMessagesToMap(false);
        
        if (result.newMessages > 0) {
          currentMessageCount = result.totalInMap;
          consecutiveNoChange = 0;
          console.log(`Found ${result.newMessages} new messages (total: ${currentMessageCount})`);
        } else {
          consecutiveNoChange++;
          console.log(`No new messages found (${consecutiveNoChange} consecutive)`);
        }
      }
      
      // Export completed
      safeUpdateProgress(100, currentMessageCount, currentMessageCount, "Export completed!");
      
      try {
        chrome.runtime.sendMessage({
          type: 'exportComplete',
          totalMessages: currentMessageCount
        });
      } catch (error) {
        console.log("Could not send completion message:", error);
      }
      
      console.log(`=== EXTRACTION COMPLETED: ${currentMessageCount} messages ===`);
      resolve({ totalMessages: currentMessageCount });
    }

    // Find conversation container (simplified)
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

    // Extract and save messages to Map
    function extractAndSaveMessagesToMap(isInitialSave = false) {
      let newMessagesFound = 0;
      
      // Get conversation partner name for reference
      const conversationPartner = getConversationPartnerName();
      console.log('conversationPartner: ', conversationPartner);
      
      // Send header information to localhost (only on first save)
      if (isInitialSave) {
        sendLineToLocalServer(`Facebook Messenger Conversation Export`);
        sendLineToLocalServer(`Exported: ${new Date().toLocaleString()}`);
        sendLineToLocalServer(`${'='.repeat(50)}`);
        sendLineToLocalServer(``); // Empty line
      }

      // Find conversation container
      const container = findConversationContainer();
      if (!container) {
        console.log("No conversation container found");
        return { newMessages: 0, totalInMap: messageMap.size };
      }

      // Get message elements using multiple selectors
      const messageSelectors = [
        'div[role="row"]',
        'div[data-testid*="message"]', 
        'div[aria-label*="message"]',
        '[data-testid*="message-container"]',
        'div[dir="auto"]'
      ];
      
      let allMessageElements = [];
      for (const selector of messageSelectors) {
        const elements = container.querySelectorAll(selector);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        allMessageElements.push(...Array.from(elements));
      }
      
      // Remove duplicates
      const uniqueElements = [...new Set(allMessageElements)];
      console.log(`Processing ${uniqueElements.length} unique message elements`);

      for (let i = 0; i < uniqueElements.length; i++) {
        const element = uniqueElements[i];
        const elementText = element.textContent?.trim() || "";

        // Skip empty elements
        if (elementText.length < 1) continue;

        // Create unique identifier
        const elementId = `elem_${i}_${elementText.substring(0, 50).replace(/\s+/g, '_')}`;
        
        // Skip if already processed
        if (processedElementIds.has(elementId)) continue;

        // Skip UI content
        if (isUIContent(elementText)) continue;

        try {
          const messageData = extractTextContent(element, messageIndex, conversationPartner);
          
          if (messageData && messageData.content && messageData.content.trim()) {
            if (messageData.type === "message") {
              if (messageData.content.length >= 1 && messageData.content.length <= 5000) {
                const messageKey = `${messageData.sender}_${messageData.content.substring(0, 100)}_${messageIndex}`;
                
                // Check for duplicates
                if (!isDuplicateMessage(messageData)) {
                  messageData.mapIndex = messageIndex++;
                  messageData.elementId = elementId;
                  messageMap.set(messageKey, messageData);
                  processedElementIds.add(elementId);
                  newMessagesFound++;

                  // Send message to server immediately
                  const formattedLine = settings.includeTimestamps && messageData.timestamp 
                    ? `${messageData.sender} [${messageData.timestamp}]: ${messageData.content}`
                    : `${messageData.sender}: ${messageData.content}`;
                  sendLineToLocalServer(formattedLine);

                  if (newMessagesFound % 10 === 0) {
                    console.log(`Valid messages: ${messageMap.size}...`);
                  }
                }
              }
            } else if (messageData.type === "date") {
              const dateKey = `date_${messageData.content}_${messageIndex}`;
              messageData.mapIndex = messageIndex++;
              messageData.elementId = elementId;
              messageMap.set(dateKey, messageData);
              processedElementIds.add(elementId);
              newMessagesFound++;

              // Send date header to server
              sendLineToLocalServer(`--- ${messageData.content} ---`);
            }
          }
        } catch (error) {
          console.warn(`Error processing element ${i + 1}:`, error);
        }
      }

      console.log(`Extraction round completed: ${newMessagesFound} new messages found (total: ${messageMap.size})`);
      return { 
        newMessages: newMessagesFound, 
        totalInMap: messageMap.size
      };
    }

    // Helper functions
    function isUIContent(text) {
      const uiPatterns = [
        "Search in conversation", "View profile", "Conversation settings", "Message requests", 
        "Something went wrong", "Active now", "Online", "Offline", "New messages", "Load more",
        "Enter", "SEND", "SENT", "EDITED", "Facebook", "Privacy Policy", "Terms of Service"
      ];
      return uiPatterns.some(pattern => text.includes(pattern)) || 
             text.match(/^\d+\s+(minutes?|hours?|days?)\s+ago$/i);
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

    function extractTextContent(element, index, conversationPartner) {
      const fullText = element.textContent?.trim() || "";
      if (!fullText) return null;

      // Check for date headers
      const isDateElement = fullText.match(
        /\w{3}\s+\d{1,2},?\s+\d{4}.*\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i
      );

      if (isDateElement && fullText.length < 100) {
        return {
          type: "date",
          content: fullText.trim(),
          index: index
        };
      }

      // Determine sender
      const rect = element.getBoundingClientRect();
      const isRightAligned = rect.right > window.innerWidth * 0.55;
      let sender = isRightAligned ? "YOU" : (conversationPartner || "OTHER PERSON").toUpperCase();

      // Try to find explicit sender
      const senderElements = element.querySelectorAll('span[dir="auto"] strong, h4, h5');
      for (const senderEl of senderElements) {
        const senderText = senderEl.textContent?.trim();
        if (senderText && senderText.length > 0 && senderText.length < 50) {
          sender = senderText.toUpperCase();
          break;
        }
      }

      // Extract content
      let content = fullText
        .replace(/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/gi, "")
        .replace(/\b(SENT|SEND|EDITED|Enter|Delivered|Seen|Read)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      if (content.length < 1 || content.length > 5000) return null;

      // Extract timestamp
      const timestampMatch = fullText.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
      const timestamp = timestampMatch ? timestampMatch[0] : null;

      return {
        type: "message",
        sender: sender,
        content: content,
        timestamp: timestamp,
        index: index
      };
    }

    // Start the extraction
    extractAllMessages().catch(error => {
      console.error("Export error:", error);
      try {
        chrome.runtime.sendMessage({
          type: 'exportError',
          error: error.message
        });
      } catch (e) {
        console.log("Could not send error message:", e);
      }
      reject(error);
    });
  });
}
