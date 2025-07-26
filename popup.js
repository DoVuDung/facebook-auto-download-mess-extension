let isExporting = false;
let currentTab = null;

// DOM elements
const statusDiv = document.getElementById("status");
const checkStatusBtn = document.getElementById("checkStatus");
const startExportBtn = document.getElementById("startExport");
const stopExportBtn = document.getElementById("stopExport");
const progressDiv = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");

// Settings
const includeDatesCheckbox = document.getElementById("includeDates");
const includeTimestampsCheckbox = document.getElementById("includeTimestamps");
const enableStreamingCheckbox = document.getElementById("enableStreaming");
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

    showStatus("Ready to export messages!", "success");
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
  progressDiv.style.display = "none";
  updateProgress(0);
}

// Start export process
async function startExport() {
  if (!currentTab || isExporting) return;

  isExporting = true;
  startExportBtn.style.display = "none";
  stopExportBtn.style.display = "block";
  progressDiv.style.display = "block";
  showStatus("Starting export...", "info");

  const settings = {
    includeDates: includeDatesCheckbox.checked,
    includeTimestamps: includeTimestampsCheckbox.checked,
    enableStreaming: enableStreamingCheckbox.checked,
    clearDOM: clearDOMCheckbox.checked,
  };

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      function: exportMessages,
      args: [settings],
    });
  } catch (error) {
    showStatus("Export failed: " + error.message, "error");
    resetUI();
  }
}

// Stop export process
function stopExport() {
  if (isExporting) {
    // Send stop message to content script
    chrome.tabs.sendMessage(currentTab.id, { type: "stopScrolling" });
    showStatus("Stopping and preparing export...", "info");
  } else {
    isExporting = false;
    resetUI();
    showStatus("Export stopped", "info");
  }
}

    // This function will be injected into the page
function exportMessages(settings) {
  return new Promise((resolve, reject) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const messages = [];
    let totalMessages = 0;
    
    // MAP-BASED progressive message collection with chronological ordering
    const messageMap = new Map(); // Use Map to prevent duplicates and maintain order
    const processedElementIds = new Set(); // Track processed DOM elements
    let messageIndex = 0; // Global index for ordering
    const dateOrder = new Map(); // Track date order for proper chronological sorting

    console.log("Settings:", settings);

    // Function to dismiss Facebook privacy popups and overlays
    function dismissFacebookPopups() {
      
      // Common selectors for Facebook privacy/encryption popups
      const popupSelectors = [
        // End-to-end encryption popup
        '[aria-label*="End-to-end encryption"]',
        '[aria-label*="encryption"]',
        '[aria-label*="privacy"]',
        '[role="dialog"][aria-label*="encryption"]',
        '[role="dialog"][aria-label*="privacy"]',
        
        // Generic dismiss buttons in dialogs
        '[role="dialog"] [aria-label*="Close"]',
        '[role="dialog"] [aria-label*="Dismiss"]',
        '[role="dialog"] [aria-label*="OK"]',
        '[role="dialog"] [aria-label*="Got it"]',
        '[role="dialog"] [aria-label*="Continue"]',
        '[role="dialog"] button[aria-label*="Close"]',
        
        // Overlay dismiss buttons
        '[data-testid="modal-close-button"]',
        '[aria-label="Close"][role="button"]',
        'button[aria-label="Close"]',
        
        // Privacy banner dismiss
        '[aria-label*="Accept"]',
        '[aria-label*="Continue to"]',
        
        // Generic modal close buttons
        '[role="dialog"] svg[aria-label*="Close"]',
        '[role="dialog"] [data-testid*="close"]'
      ];
      
      let dismissedCount = 0;
      
      for (const selector of popupSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          // Check if element is visible and clickable
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            try {
              console.log(`🔐 Dismissing popup element: ${selector}`);
              element.click();
              dismissedCount++;
            } catch (error) {
              console.log(`⚠️ Could not click popup element: ${error.message}`);
            }
          }
        });
      }
      
      // Also try pressing Escape key to dismiss any modal
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          keyCode: 27,
          bubbles: true
        }));
        console.log("🔐 Sent Escape key to dismiss any remaining modals");
      } catch (error) {
        console.log(`⚠️ Could not send Escape key: ${error.message}`);
      }
      
      if (dismissedCount > 0) {
        console.log(`✅ Dismissed ${dismissedCount} popup elements`);
      } else {
        console.log("✅ No privacy popups found to dismiss");
      }
      
      return dismissedCount;
    }

    // Send progress updates back to popup
    function updateProgress(percent, current) {
      chrome.runtime.sendMessage({
        type: "progress",
        percent: percent,
        current: current,
        total: totalMessages,
      });
    }

    // STREAMING SAVE SYSTEM: Progressive file saving during extraction
    let streamingBuffer = [];
    let lastStreamSave = 0;
    const STREAM_BUFFER_SIZE = 100; // Save every 100 messages
    const STREAM_TIME_INTERVAL = 30000; // Save every 30 seconds
    let streamingEnabled = settings.enableStreaming; // Use setting
    let streamingSaveCount = 0;

    function generateStreamingOutput(messages) {
      let output = "";
      const sortedMessages = messages.sort((a, b) => {
        const aOrder = a.chronoOrder || a.mapIndex || a.index || 0;
        const bOrder = b.chronoOrder || b.mapIndex || b.index || 0;
        return aOrder - bOrder;
      });

      for (const msg of sortedMessages) {
        if (msg.type === "date" && settings.includeDates) {
          output += `\n=== ${msg.content} ===\n\n`;
        } else if (msg.type === "message") {
          const timestamp = settings.includeTimestamps && msg.timestamp ? ` [${msg.timestamp}]` : '';
          output += `${msg.sender}${timestamp}: ${msg.content}\n`;
        }
      }
      return output;
    }

    function saveStreamingData() {
      if (!streamingEnabled || streamingBuffer.length === 0) return;

      try {
        const output = generateStreamingOutput(streamingBuffer);
        
        if (output.trim()) {
          // Create filename with timestamp and part number
          const now = new Date();
          const timestamp = now.toISOString().slice(0, 19).replace(/[:]/g, '-');
          const filename = `messenger_export_${timestamp}_part${++streamingSaveCount}.txt`;
          
          // Create blob and download
          const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          
          // Use Chrome downloads API for background downloading
          chrome.runtime.sendMessage({
            type: "streamingSave",
            url: url,
            filename: filename,
            messageCount: streamingBuffer.length,
            totalSaved: streamingSaveCount * STREAM_BUFFER_SIZE
          });

          console.log(`📦 STREAMING SAVE: Saved ${streamingBuffer.length} messages to ${filename}`);
          
          // Clear buffer after saving
          streamingBuffer = [];
          lastStreamSave = Date.now();
        }
      } catch (error) {
        console.error("❌ Streaming save error:", error);
      }
    }

    function addToStreamingBuffer(messageData) {
      if (!streamingEnabled) return;
      
      streamingBuffer.push(messageData);
      
      // Save based on buffer size or time interval
      const shouldSaveBySize = streamingBuffer.length >= STREAM_BUFFER_SIZE;
      const shouldSaveByTime = (Date.now() - lastStreamSave) >= STREAM_TIME_INTERVAL;
      
      if (shouldSaveBySize || shouldSaveByTime) {
        saveStreamingData();
      }
    }

    // PROGRESSIVE MAP-BASED: Extract and save messages to Map continuously
    function extractAndSaveMessagesToMap(isInitialSave = false) {
      const saveStartTime = Date.now();
      let newMessagesFound = 0;
      let skippedDuplicates = 0;


      // Get conversation partner name for reference
      const conversationPartner = getConversationPartnerName();
      console.log('conversationPartner: ', conversationPartner);
      

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
            console.log(`✅ Found conversation container using selector: ${selector} with ${testMessages.length} message elements`);
            break;
          }
        }
      }

      // Method 2: Find the container with actual message content (not sidebar) - ENHANCED
      if (!conversationDetailContainer) {
        console.log("🔍 Method 1 failed, trying Method 2: analyzing containers with message content...");

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
            console.log(`📝 Found potential container with ${totalMessages} message elements, width: ${containerRect.width}, left: ${containerRect.left}`);
            maxMessages = totalMessages;
            bestContainer = container;
          }
        }
        
        if (bestContainer) {
          conversationDetailContainer = bestContainer;
          console.log(`✅ Method 2 success: Selected container with ${maxMessages} message elements`);
        }
      }

      // Method 3: Fallback to document-wide search with intelligent filtering
      if (!conversationDetailContainer) {
        console.log("🔍 Method 2 failed, trying Method 3: document-wide search...");

        // Find all potential message containers across the document
        const allContainers = document.querySelectorAll("div, main, section");
        let bestContainer = null;
        let maxMessages = 0;

        for (const container of allContainers) {
          // Try multiple message selectors to find any message content
          const messageSelectors = [
            'div[role="row"]',
            'div[data-testid*="message"]', 
            'div[aria-label*="message"]',
            '[data-testid*="message-container"]',
            'div[dir="auto"]' // Very common in Facebook
          ];
          
          let totalMessages = 0;
          for (const selector of messageSelectors) {
            const elements = container.querySelectorAll(selector);
            // Count elements that actually contain text content
            for (const el of elements) {
              if (el.textContent && el.textContent.trim().length > 3) {
                totalMessages++;
              }
            }
          }
          
          const rect = container.getBoundingClientRect();

          // Must be:
          // - On the right side of the screen (not left sidebar)
          // - Have significant width (not a narrow list)
          // - Have actual messages
          if (
            totalMessages > maxMessages &&
            totalMessages > 5 && // Must have at least some messages
            rect.left > window.innerWidth * 0.05 && // Very permissive
            rect.width > 150 // Very permissive width
          ) {
            console.log(`📝 Found potential container with ${totalMessages} text elements, width: ${rect.width}, left: ${rect.left}`);
            maxMessages = totalMessages;
            bestContainer = container;
          }
        }

        if (bestContainer) {
          console.log(`✅ Method 3 success: Selected best container with ${maxMessages} message elements`);
          conversationDetailContainer = bestContainer;
        }
      }

      if (!conversationDetailContainer) {
        console.log("⚠️ No specific conversation container found, falling back to document-wide extraction...");
        // Try to find any message elements across the document
        const allMessageSelectors = [
          'div[role="row"]',
          'div[data-testid*="message"]', 
          'div[aria-label*="message"]',
          '[data-testid*="message-container"]',
          'div[dir="auto"]'
        ];
        
        let totalFoundElements = 0;
        for (const selector of allMessageSelectors) {
          totalFoundElements += document.querySelectorAll(selector).length;
        }
        
        if (totalFoundElements > 0) {
          console.log(`📝 Found ${totalFoundElements} total message-like elements across document, will filter during processing...`);
          // Use document as the container and let the filtering happen during message processing
          conversationDetailContainer = document;
        } else {
          console.log("❌ No message elements found anywhere in document");
          return { newMessages: 0, totalInMap: messageMap.size };
        }
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
        console.log(`📝 Found ${elements.length} elements with selector: ${selector}`);
        allMessageElements.push(...Array.from(elements));
      }
      
      // Remove duplicates (same DOM element from different selectors)
      const uniqueElements = [...new Set(allMessageElements)];
      const messageElements = uniqueElements;
      
      console.log(`📝 Total unique message elements to process: ${messageElements.length}`);

      // Additional validation: ensure we're not in the sidebar
      const containerRect = conversationDetailContainer.getBoundingClientRect();
      

      if (containerRect.left < window.innerWidth * 0.1) {
        // More permissive - reduced from 0.2
       

        // Try to find a container more to the right
        const rightContainers = Array.from(
          document.querySelectorAll('div[role="log"], div')
        )
          .filter((container) => {
            const rect = container.getBoundingClientRect();
            return (
              rect.left > window.innerWidth * 0.2 && // Reduced from 0.3
              container.querySelectorAll('div[role="row"]').length > 0
            );
          })
          .sort(
            (a, b) =>
              b.querySelectorAll('div[role="row"]').length -
              a.querySelectorAll('div[role="row"]').length
          );

        if (rightContainers.length > 0) {
          conversationDetailContainer = rightContainers[0];
          const newMessages =
            conversationDetailContainer.querySelectorAll('div[role="row"]');
          
        }
      }

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
        if (
          elementText.includes("Search in conversation") ||
          elementText.includes("View profile") ||
          elementText.includes("Conversation settings") ||
          elementText.includes("Message requests") ||
          elementText.includes("Something went wrong") ||
          elementText === "Active now" ||
          elementText === "Online" ||
          elementText === "Offline" ||
          elementText.includes("New messages") ||
          elementText.includes("Load more") ||
          elementText.startsWith("Facebook") ||
          elementText.includes("Privacy Policy") ||
          elementText.includes("Terms of Service") ||
          // Sidebar-specific content
          elementText.includes("People") ||
          elementText.includes("See all in Messenger") ||
          elementText.includes("Create group") ||
          elementText.includes("All chats") ||
          elementText.includes("Marketplace") ||
          // Only the most obvious UI contamination patterns
          elementText === "Enter" ||
          elementText === "SEND" ||
          elementText === "SENT" ||
          elementText === "EDITED" ||
          elementText.match(/^\d+\s+(minutes?|hours?|days?)\s+ago$/i) // "2 hours ago" format
        ) {
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
                
                // OPTIMIZED duplicate check for massive conversations (10k+ messages)
                let isDuplicate = false;
                const currentContentLower = messageData.content.toLowerCase().trim();
                
                // For massive conversations, use hash-based quick lookup instead of full iteration
                if (messageMap.size > 1000) {
                  // Create content hash for faster duplicate detection
                  const contentHash = `${messageData.sender}_${currentContentLower.substring(0, 100)}`;
                  
                  // Check if we've seen this exact content hash before
                  if (!window.contentHashSet) window.contentHashSet = new Set();
                  
                  if (window.contentHashSet.has(contentHash)) {
                    isDuplicate = true;
                    console.log(`🔄 Hash-based duplicate detected: "${messageData.content.substring(0, 50)}..."`);
                  } else {
                    // Add to hash set for future lookups
                    window.contentHashSet.add(contentHash);
                    
                    // For very large conversations, only check exact matches (skip similarity check)
                    if (messageMap.size > 5000) {
                      // Skip similarity check for performance
                    } else {
                      // Check similarity only against recent messages (last 100) for performance
                      const recentMessages = Array.from(messageMap.values()).slice(-100);
                      for (const existingMsg of recentMessages) {
                        if (existingMsg.sender === messageData.sender) {
                          const existingContentLower = existingMsg.content.toLowerCase().trim();
                          const similarity = calculateContentSimilarity(currentContentLower, existingContentLower);
                          if (similarity > 0.9) {
                            console.log(`🔄 Found similar content (${(similarity * 100).toFixed(1)}% match), skipping: "${messageData.content.substring(0, 50)}..."`);
                            isDuplicate = true;
                            break;
                          }
                        }
                      }
                    }
                  }
                } else {
                  // Original logic for smaller conversations
                  for (const [key, existingMsg] of messageMap.entries()) {
                    // Exact content and sender match
                    if (existingMsg.content === messageData.content && 
                        existingMsg.sender === messageData.sender) {
                      isDuplicate = true;
                      break;
                    }
                    
                    // Check for very similar content (90% similarity) from same sender
                    if (existingMsg.sender === messageData.sender) {
                      const existingContentLower = existingMsg.content.toLowerCase().trim();
                      const similarity = calculateContentSimilarity(currentContentLower, existingContentLower);
                      if (similarity > 0.9) {
                        console.log(`🔄 Found similar content (${(similarity * 100).toFixed(1)}% match), skipping: "${messageData.content.substring(0, 50)}..."`);
                        isDuplicate = true;
                        break;
                      }
                    }
                  }
                }

                if (!isDuplicate) {
                  // Add to Map with REVERSE chronological ordering for proper Facebook timeline
                  messageData.mapIndex = messageIndex++;
                  messageData.elementId = elementId;
                  // Since we scroll UP (newest to oldest), we need to reverse index for proper chronological order
                  messageData.scrollOrder = messageIndex; // Order in which we found them while scrolling
                  messageData.extractionTime = Date.now(); // Capture when we found this message (for internal tracking only)
                  // Keep the original Facebook timestamp for display (messageData.timestamp is already set by extractTextContent)
                  messageMap.set(messageKey, messageData);
                  processedElementIds.add(elementId);
                  validMessages++;
                  newMessagesFound++;

                  // STREAMING SAVE: Add to buffer for progressive saving
                  addToStreamingBuffer(messageData);

                  // MEMORY OPTIMIZATION: For massive conversations, periodically clean up hash set
                  if (messageMap.size > 0 && messageMap.size % 1000 === 0 && window.contentHashSet) {
                    console.log(`🧹 Memory cleanup: Hash set size before: ${window.contentHashSet.size}`);
                    // Keep only recent hashes to prevent memory bloat
                    if (window.contentHashSet.size > 2000) {
                      window.contentHashSet.clear();
                      console.log(`🧹 Cleared hash set to prevent memory issues`);
                    }
                  }

                  if (validMessages % 25 === 0) {
                    console.log(`📝 Valid messages in Map: ${messageMap.size}...`);
                  }

                  // Debug: log sample messages for different conversation sizes
                  if (messageMap.size <= 10 || (messageMap.size % 500 === 0 && messageMap.size <= 5000)) {
                    console.log(
                      `Sample message ${messageMap.size}: ${
                        messageData.sender
                      } - ${messageData.content.substring(0, 100)}`
                    );
                  }
                } else {
                  skippedDuplicates++;
                }
              } else {
                console.log(`❌ Rejected message content: "${messageData.content.substring(0, 100)}..." (length: ${messageData.content.length})`);
              }
            } else if (messageData.type === "date") {
              // Always include date headers with proper ordering
              const dateKey = `date_${messageData.content}_${messageIndex}`;
              messageData.mapIndex = messageIndex++;
              messageData.elementId = elementId;
              messageData.scrollOrder = messageIndex; // Order in which we found them while scrolling
              messageData.extractionTime = Date.now(); // Capture when we found this message (for internal tracking only)
              // Keep the original Facebook timestamp for display (messageData.timestamp is already set by extractTextContent)
              
              // Track date progression for proper ordering
              dateOrder.set(messageData.content, messageIndex);
              
              messageMap.set(dateKey, messageData);
              processedElementIds.add(elementId);
              newMessagesFound++;

              // STREAMING SAVE: Add date headers to buffer too
              addToStreamingBuffer(messageData);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Error processing element ${i + 1}:`, error);
          skippedElements++;
        }
      }

      const saveTime = Date.now() - saveStartTime;
      
      

      return { 
        newMessages: newMessagesFound, 
        totalInMap: messageMap.size,
        container: conversationDetailContainer 
      };
    }

    // ENHANCED: Calculate content similarity for better duplicate detection
    function calculateContentSimilarity(text1, text2) {
      if (text1 === text2) return 1.0;
      if (!text1 || !text2) return 0.0;
      
      // Normalize texts
      const normalize = (text) => text.toLowerCase().trim().replace(/\s+/g, ' ');
      const norm1 = normalize(text1);
      const norm2 = normalize(text2);
      
      if (norm1 === norm2) return 1.0;
      
      // Character-based similarity using Jaccard index
      const getCharBigrams = (text) => {
        const bigrams = new Set();
        for (let i = 0; i < text.length - 1; i++) {
          bigrams.add(text.substring(i, i + 2));
        }
        return bigrams;
      };
      
      const bigrams1 = getCharBigrams(norm1);
      const bigrams2 = getCharBigrams(norm2);
      
      const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
      const union = new Set([...bigrams1, ...bigrams2]);
      
      return union.size === 0 ? 0 : intersection.size / union.size;
    }

    // Helper function to detect obvious system messages (less restrictive)
    function isSystemMessage(content) {
      const systemPatterns = [
        "sent a message",
        "started a call",
        "missed call",
        "reacted to",
        "liked a message",
        "loved a message",
        "left the group",
        "joined the group",
        "This person is unavailable on Messenger",
        "You are now connected on Messenger",
        "Say hi to your new connection",
      ];

      const contentLower = content.toLowerCase();
      return systemPatterns.some((pattern) =>
        contentLower.includes(pattern.toLowerCase())
      );
    }

    // Helper function to calculate text similarity
    function calculateSimilarity(text1, text2) {
      const words1 = text1.toLowerCase().split(/\s+/);
      const words2 = text2.toLowerCase().split(/\s+/);

      const set1 = new Set(words1);
      const set2 = new Set(words2);

      const intersection = new Set([...set1].filter((x) => set2.has(x)));
      const union = new Set([...set1, ...set2]);

      return intersection.size / union.size;
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
              console.log(`✅ Found explicit sender: "${sender}" using selector: ${selector}`);
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
        console.log(`📍 Using position-based sender detection: ${sender} (right: ${isRightAligned}, left: ${isLeftAligned})`);
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
        .replace(/\bDelivered\s*$/gi, "") // Remove "Delivered" at end
        .replace(/\bSeen\s*$/gi, "") // Remove "Seen" at end
        .replace(/\bRead\s*$/gi, "") // Remove "Read" at end
        .replace(/\s+/g, " ")
        .trim();

      // Stage 2: Remove obvious concatenated sender names only at the beginning
      cleanContent = cleanContent
        .replace(/^(TORBEN|YOU|OTHER PERSON)\s*:?\s*/gi, "")
        .replace(/^([A-Z]+)\s+([a-z])/gi, (match, possibleSender, nextChar) => {
          // If it looks like "SARAHello there", convert to "Hello there" 
          if (possibleSender.length <= 15 && possibleSender !== cleanContent) {
            return nextChar.toUpperCase();
          }
          return match;
        })
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
        console.log(`❌ Rejected content: "${cleanContent.substring(0, 100)}..." (${cleanContent.length} chars)`);
        return null;
      }

      console.log(`✅ Accepted message from ${sender}: "${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}" (${cleanContent.length} chars)`);

      return {
        type: "message",
        index: index,
        sender: sender,
        content: cleanContent,
        timestamp: timestamp, // Add timestamp for better ordering
        chronoOrder: index // Will be set by caller
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

      // Priority 2: Look for profile link or avatar with name
      const profileSelectors = [
        '[role="button"][aria-label*="profile"] span',
        'a[href*="/profile/"] span',
        '[data-testid*="profile"] span',
      ];

      for (const selector of profileSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const name = el.textContent.trim();
          if (name && name.length > 0 && name.length < 50) {
            return name;
          }
        }
      }

      // Priority 3: Analyze message senders to find the other person
      const messageElements = document.querySelectorAll('div[role="row"]');
      const senderCounts = {};
      const currentUserIdentifiers = ["you", "me", "myself"];

      for (const msgEl of messageElements) {
        // Look for sender name elements
        const senderElements = msgEl.querySelectorAll(
          'span[dir="auto"] strong, h4, h5, [aria-label*="sent by"]'
        );

        for (const senderEl of senderElements) {
          let senderText = senderEl.textContent?.trim();
          if (senderText) {
            // Clean sender name
            senderText = senderText.replace(/\s*:.*$/g, ""); // Remove colon and after
            senderText = senderText.replace(/\s*\(.*?\)\s*/g, ""); // Remove parentheses
            senderText = senderText.trim();

            // Validate sender name
            if (
              senderText &&
              senderText.length > 0 &&
              senderText.length < 50 &&
              !senderText.match(/^\d+$/) &&
              !senderText.match(/AM|PM/i) &&
              !senderText.includes("Active") &&
              !senderText.includes("ago") &&
              !senderText.includes("•") &&
              !currentUserIdentifiers.some((id) =>
                senderText.toLowerCase().includes(id)
              )
            ) {
              senderCounts[senderText] = (senderCounts[senderText] || 0) + 1;
            }
          }
        }
      }

      // Find the most frequent sender (excluding current user)
      let bestSender = null;
      let maxCount = 0;

      for (const [sender, count] of Object.entries(senderCounts)) {
        if (count > maxCount && count > 2) {
          // Must appear at least 3 times
          bestSender = sender;
          maxCount = count;
        }
      }

      if (bestSender) {
        console.log(
          `Found conversation partner by message analysis: ${bestSender} (${maxCount} messages)`
        );
        return bestSender;
      }

      console.log("Could not determine conversation partner name");
      return null;
    }

    // DYNAMIC CONTENT-AWARE scrolling with MAP-BASED progressive collection
    async function performAdvancedScroll() {

      let previousMessageCount = 0;
      let currentMessageCount = 0;
      let consecutiveNoChange = 0;
      let scrollAttempts = 0;
      let userRequestedStop = false;
      
      // Reset scroll tracking variables
      window.lastScrollTop = undefined;
      window.consecutiveAtTop = 0;
      // Reset hash set for massive conversation optimization
      window.contentHashSet = new Set();
      
      console.log("🔄 Starting advanced scroll with enhanced top detection and massive conversation optimizations...");
      
      // STEP 1: SAVE INITIAL VIEW TO MAP BEFORE SCROLLING
      const initialSave = extractAndSaveMessagesToMap(true);
      currentMessageCount = initialSave.totalInMap;
      previousMessageCount = currentMessageCount;
      
      
      if (!initialSave.container) {
        return { finalCount: currentMessageCount, userRequestedStop };
      }
      
      const conversationDetailContainer = initialSave.container;

      // DYNAMIC parameters based on content - FULLY ADAPTIVE with UNLIMITED attempts
      let maxRetries = 50; // Initial baseline, will scale DYNAMICALLY based on performance
      let waitTime = 1500; // Start fast, will adapt based on loading performance
      let patienceLevel = 3; // Start impatient, increase as needed
      let aggressionLevel = 1; // Scale 1-5: how aggressive scrolling methods should be
      
      // PERFORMANCE TRACKING for dynamic adaptation
      let messageLoadingRate = 0;
      let averageLoadTime = 1500;
      let loadingHistory = [];
      let hasFoundLoadButtons = false;
      let isLongConversation = false;
      let slowLoadingDetected = false;
      let noProgressStreak = 0;
      let lastSuccessfulMethod = null;
      let contentDensity = 0; // messages per scroll attempt
      let adaptiveScrollIntensity = 1; // multiplier for scroll amounts
      
      // DYNAMIC ATTEMPT CALCULATION - scales based on actual performance
      let messagesPerAttempt = 0;
      let performanceScore = 1.0; // 1.0 = normal, >1.0 = efficient, <1.0 = inefficient
      let dynamicMaxRetries = maxRetries;
      let lastProgressAttempt = 0;
      let efficientMethodsUsed = new Set();
      let inefficientMethods = new Set();

      // Skip container finding since we already have it from initial save

      const containerRect = conversationDetailContainer.getBoundingClientRect();
      

      // Initial count from Map (not DOM count)
      
      // DYNAMIC ASSESSMENT: Real-time analysis to determine optimal strategy with PERFORMANCE OPTIMIZATION
      const initialContentAnalysis = () => {
        const messageElements = conversationDetailContainer.querySelectorAll('div[role="row"]');
        const containerHeight = conversationDetailContainer.getBoundingClientRect().height;
        const avgMessageHeight = containerHeight / Math.max(messageElements.length, 1);
        
        contentDensity = messageMap.size / Math.max(scrollAttempts, 1);
        
        // PERFORMANCE-BASED AGGRESSION: Start higher aggression for better performance
        if (currentMessageCount > 5000) {
          isLongConversation = true;
          aggressionLevel = 5; // Maximum aggression for massive conversations
        } else if (currentMessageCount > 2000) {
          isLongConversation = true;
          aggressionLevel = 5; // Maximum aggression for very large conversations
        } else if (currentMessageCount > 1000) {
          isLongConversation = true;
          aggressionLevel = 4; // High aggression for large conversations
        } else if (currentMessageCount > 500) {
          isLongConversation = true;
          aggressionLevel = 4; // High aggression for moderate conversations
        } else if (currentMessageCount > 200) {
          isLongConversation = true;
          aggressionLevel = 4; // High aggression for long conversations
        } else if (currentMessageCount > 100) {
          isLongConversation = true;
          aggressionLevel = 3; // Medium aggression for medium conversations
        } else if (currentMessageCount > 30) {
          aggressionLevel = 4; // Higher aggression for medium conversations
        } else {
          aggressionLevel = 5; // Maximum aggression for short conversations
        }
        
        // DYNAMIC ATTEMPT CALCULATION - NO FIXED LIMITS, scales with conversation and performance
        const calculateDynamicAttempts = () => {
          // Calculate messages per attempt so far
          messagesPerAttempt = scrollAttempts > 0 ? currentMessageCount / scrollAttempts : 1;
          
          // Calculate performance score based on efficiency
          if (messagesPerAttempt > 10) {
            performanceScore = 1.5; // Very efficient
          } else if (messagesPerAttempt > 5) {
            performanceScore = 1.2; // Good efficiency
          } else if (messagesPerAttempt > 2) {
            performanceScore = 1.0; // Normal efficiency
          } else if (messagesPerAttempt > 0.5) {
            performanceScore = 0.8; // Low efficiency
          } else {
            performanceScore = 0.6; // Very low efficiency
          }
          
          // DYNAMIC MAX RETRIES - scales with conversation size and performance (ENHANCED FOR 10K+)
          if (currentMessageCount > 10000) {
            // MASSIVE conversations (10k+) - UNLIMITED scaling for complete extraction
            dynamicMaxRetries = Math.floor(Math.max(500, Math.min(5000, 
              currentMessageCount * 0.3 * performanceScore // Doubled scaling factor
            )));
          } else if (currentMessageCount > 5000) {
            // Very large conversations (5k+) - much more generous scaling
            dynamicMaxRetries = Math.floor(Math.max(400, Math.min(2000, 
              currentMessageCount * 0.2 * performanceScore // Doubled scaling factor
            )));
          } else if (currentMessageCount > 2000) {
            // Large conversations (2k+) - enhanced scaling
            dynamicMaxRetries = Math.floor(Math.max(250, Math.min(800, 
              currentMessageCount * 0.15 * performanceScore // Nearly doubled
            )));
          } else if (currentMessageCount > 1000) {
            // Medium conversations (1k+) - improved scaling
            dynamicMaxRetries = Math.floor(Math.max(150, Math.min(400, 
              currentMessageCount * 0.12 * performanceScore // Doubled
            )));
          } else if (currentMessageCount > 500) {
            // Small conversations - enhanced limits
            dynamicMaxRetries = Math.floor(Math.max(80, Math.min(200, 
              currentMessageCount * 0.08 * performanceScore // Increased
            )));
          } else {
            // Very small conversations - improved attempts
            dynamicMaxRetries = Math.floor(Math.max(30, Math.min(100, 
              currentMessageCount * 0.15 + 15 // Increased base
            )));
          }
          
          console.log(`🎯 Dynamic attempts: ${dynamicMaxRetries} (performance: ${performanceScore.toFixed(2)}, msg/attempt: ${messagesPerAttempt.toFixed(1)})`);
        };
        
        calculateDynamicAttempts();
        
        // PERFORMANCE-OPTIMIZED wait times (ENHANCED FOR 10K+)
        if (currentMessageCount > 10000) {
          waitTime = performanceScore > 1.2 ? 1000 : 1800; // Faster for massive conversations
        } else if (currentMessageCount > 5000) {
          waitTime = performanceScore > 1.2 ? 1200 : 1800; // Faster if efficient
        } else if (currentMessageCount > 2000) {
          waitTime = performanceScore > 1.2 ? 1000 : 1500;
        } else if (currentMessageCount > 1000) {
          waitTime = performanceScore > 1.2 ? 800 : 1200;
        } else if (currentMessageCount < 30) {
          waitTime = 500; // Always fast for small conversations
        } else if (currentMessageCount < 100) {
          waitTime = 600;
        } else {
          waitTime = Math.max(600, 1800 - (aggressionLevel * 200)); // Scale with aggression
        }
        
        // PERFORMANCE-BASED patience levels (MAXIMIZED FOR 10K+)
        if (currentMessageCount > 10000) {
          patienceLevel = Math.floor(25 * performanceScore); // Maximum patience for massive conversations
        } else if (currentMessageCount > 5000) {
          patienceLevel = Math.floor(20 * performanceScore); // Scale patience with performance
        } else if (currentMessageCount > 2000) {
          patienceLevel = Math.floor(15 * performanceScore);
        } else if (currentMessageCount > 1000) {
          patienceLevel = Math.floor(12 * performanceScore);
        } else if (currentMessageCount < 30) {
          patienceLevel = 3;
        } else if (currentMessageCount < 100) {
          patienceLevel = 4;
        } else if (currentMessageCount < 200) {
          patienceLevel = 6;
        } else {
          patienceLevel = 8;
        }
        
        adaptiveScrollIntensity = aggressionLevel;
      };
      
      initialContentAnalysis();

      // Listen for stop requests from popup
      const messageListener = (message, sender, sendResponse) => {
        if (message.type === "stopScrolling") {
          userRequestedStop = true;
          chrome.runtime.sendMessage({
            type: "progress",
            percent: 90,
            current: currentMessageCount,
            total: currentMessageCount,
            status: "User stopped - preparing export...",
          });
        }
      };
      
      chrome.runtime.onMessage.addListener(messageListener);
      
      // DEBUG: Start scrolling immediately to test
      
      // Simple scroll test first
      if (currentMessageCount > 0 && scrollAttempts === 0) {
      }

      // SCROLL CAPABILITY TRACKING - Only count attempts when scrolling is actually possible
      let scrollCapabilityAttempts = 0; // Only count when we can actually scroll
      let totalScrollAttempts = 0; // Track all attempts for diagnostics
      let lastScrollPosition = -1;
      let canStillScroll = true;
      let noScrollChangeCount = 0;

      while (canStillScroll && !userRequestedStop) {
        const startTime = Date.now();
        totalScrollAttempts++;
        
        // SPECIAL OVERRIDE SYSTEM: For conversations showing signs of being truly massive (10K+)
        const hasMassiveConversationIndicators = () => {
          // If we already have 1000+ messages and still finding more efficiently, likely much larger
          const isFindingMessagesEfficiently = messagesPerAttempt > 1.0;
          const hasRecentProgress = (scrollCapabilityAttempts - lastProgressAttempt) < 10;
          const showsMassiveSigns = currentMessageCount >= 1000 && isFindingMessagesEfficiently && hasRecentProgress;
          
          // Additional signs: very tall scroll container, lots of DOM elements
          const containerScrollHeight = conversationDetailContainer ? conversationDetailContainer.scrollHeight : 0;
          const isVeryTallContainer = containerScrollHeight > 50000; // Very long scroll area
          
          return showsMassiveSigns || isVeryTallContainer;
        };
        
        // MASSIVE CONVERSATION OVERRIDE: Apply ultra-patient settings if conversation shows massive signs
        if (hasMassiveConversationIndicators() && currentMessageCount >= 1000) {
          // Override all limits for truly massive conversations
          dynamicMaxRetries = Math.max(dynamicMaxRetries, 1000); // Guarantee at least 1000 attempts
          waitTime = Math.min(waitTime, 1200); // Keep scrolling fast
          
          // Super patient stopping conditions for massive conversations
          if (currentMessageCount >= 1000) {
            dynamicPatience = Math.max(dynamicPatience, 100); // Ultra patience for 1K+ showing massive signs
          }
          
          console.log(`🔥 MASSIVE CONVERSATION DETECTED: Override engaged for 10K+ message extraction (attempts: ${dynamicMaxRetries}, patience: ${dynamicPatience})`);
        }
        
        // CHECK SCROLL CAPABILITY BEFORE COUNTING ATTEMPT - ENHANCED VERSION
        const checkScrollCapability = () => {
          const currentScrollTop = conversationDetailContainer ? conversationDetailContainer.scrollTop : window.pageYOffset;
          const scrollHeight = conversationDetailContainer ? conversationDetailContainer.scrollHeight : document.documentElement.scrollHeight;
          const clientHeight = conversationDetailContainer ? conversationDetailContainer.clientHeight : window.innerHeight;
          
          // Can we scroll further up?
          const canScrollUp = currentScrollTop > 5; // More lenient threshold
          
          // Did scroll position change from last attempt?
          const scrollPositionChanged = lastScrollPosition !== currentScrollTop;
          
          // ENHANCED: Check if new content is being loaded (height changes)
          const previousScrollHeight = window.lastScrollHeight || scrollHeight;
          const contentHeightChanged = Math.abs(scrollHeight - previousScrollHeight) > 10;
          window.lastScrollHeight = scrollHeight;
          
          if (scrollPositionChanged || contentHeightChanged) {
            lastScrollPosition = currentScrollTop;
            noScrollChangeCount = 0;
            if (contentHeightChanged) {
              console.log(`📏 Content height changed: ${previousScrollHeight} → ${scrollHeight} (${contentHeightChanged ? 'new content loaded' : 'no change'})`);
            }
            return true; // Scrolling is working or new content is loading
          } else {
            noScrollChangeCount++;
            
            // ENHANCED: More patient detection - require multiple failures (OPTIMIZED FOR 10K+)
            // If we can't scroll up and position hasn't changed for several attempts
            if (!canScrollUp && noScrollChangeCount >= 15) { // Increased from 8 to 15 for massive conversations
              console.log(`🛑 SCROLL CAPABILITY: Can't scroll further (position: ${currentScrollTop}, noChange: ${noScrollChangeCount})`);
              
              // FINAL CHECK: Try multiple aggressive scrolls to be absolutely sure
              if (conversationDetailContainer) {
                const originalTop = conversationDetailContainer.scrollTop;
                
                // Try multiple scroll methods as final verification
                for (let finalAttempt = 0; finalAttempt < 3; finalAttempt++) {
                  conversationDetailContainer.scrollTop = 0;
                  conversationDetailContainer.scrollTo({top: 0, behavior: "instant"});
                  
                  // Also try parent containers
                  let parent = conversationDetailContainer.parentElement;
                  let level = 0;
                  while (parent && level < 5) { // Increased from 3 to 5 levels
                    parent.scrollTop = 0;
                    if (parent.scrollTo) parent.scrollTo({top: 0, behavior: "instant"});
                    parent = parent.parentElement;
                    level++;
                  }
                  
                  // Check if any of these changed the position
                  const newTop = conversationDetailContainer.scrollTop;
                  if (newTop !== originalTop) {
                    console.log(`🔄 Final scroll check ${finalAttempt + 1} found movement: ${originalTop} → ${newTop}, continuing...`);
                    lastScrollPosition = newTop;
                    noScrollChangeCount = 0;
                    return true;
                  }
                }
              }
              return false; // No more scrolling possible after thorough check
            }
            
            // If position hasn't changed for many attempts, likely can't scroll (INCREASED FOR 10K+)
            if (noScrollChangeCount >= 20) { // Increased from 12 to 20 for massive conversations
              console.log(`🛑 SCROLL CAPABILITY: No scroll change for ${noScrollChangeCount} attempts`);
              return false;
            }
            
            return true; // Still might be able to scroll
          }
        };
        
        // Only increment scroll attempts if we can actually scroll
        if (checkScrollCapability()) {
          scrollCapabilityAttempts++;
          scrollAttempts = scrollCapabilityAttempts; // Keep original variable for compatibility
        } else {
          // ENHANCED: Before giving up completely, try more aggressive attempts for 10K+ messages
          if (totalScrollAttempts < 50) { // Increased from 20 to 50 for massive conversations
            console.log(`⚠️ SCROLL CAPABILITY: Might be temporary, trying ${50 - totalScrollAttempts} more attempts...`);
            // Don't count this as a capability attempt, but continue trying
          } else {
            // Can't scroll anymore - exit immediately
            console.log(`✅ SMART STOP: No more scrolling possible after ${scrollCapabilityAttempts} effective attempts (${totalScrollAttempts} total)`);
            canStillScroll = false;
            break;
          }
        }
        
        // PERFORMANCE-BASED REAL-TIME ADAPTATION: Adjust strategy based on recent performance
        const adaptStrategy = () => {
          const recentHistory = loadingHistory.slice(-5); // Last 5 attempts
          const recentSuccess = recentHistory.filter(h => h.newMessages > 0).length;
          const avgRecentLoadTime = recentHistory.reduce((sum, h) => sum + h.loadTime, 0) / Math.max(recentHistory.length, 1);
          
          // Track successful methods for performance optimization
          if (recentSuccess > 0) {
            const successfulMethods = recentHistory
              .filter(h => h.newMessages > 0)
              .map(h => h.method)
              .filter(Boolean);
            successfulMethods.forEach(method => efficientMethodsUsed.add(method));
          }
          
          // Track inefficient methods
          if (recentSuccess === 0 && recentHistory.length >= 3) {
            const inefficientMethodsList = recentHistory
              .filter(h => h.newMessages === 0)
              .map(h => h.method)
              .filter(Boolean);
            inefficientMethodsList.forEach(method => inefficientMethods.add(method));
          }
          
          // DYNAMIC RETRY RECALCULATION - continuously adjust based on performance
          if (scrollCapabilityAttempts > 0 && scrollCapabilityAttempts % 10 === 0) {
            messagesPerAttempt = currentMessageCount / scrollCapabilityAttempts;
            
            // Recalculate performance score
            if (messagesPerAttempt > 8) {
              performanceScore = 1.5;
            } else if (messagesPerAttempt > 4) {
              performanceScore = 1.2;
            } else if (messagesPerAttempt > 1) {
              performanceScore = 1.0;
            } else if (messagesPerAttempt > 0.3) {
              performanceScore = 0.8;
            } else {
              performanceScore = 0.6;
            }
            
            console.log(`� PERFORMANCE UPDATE: ${messagesPerAttempt.toFixed(1)} msg/attempt, score: ${performanceScore.toFixed(2)}`);
          }
          
          // Detect slow loading and adapt
          if (avgRecentLoadTime > waitTime * 1.5) {
            slowLoadingDetected = true;
            waitTime = Math.min(waitTime * 1.1, 3000); // More conservative increase
          }
          
          // Increase aggression if no recent success but we're still efficient overall
          if (recentSuccess === 0 && recentHistory.length >= 3 && performanceScore > 0.8) {
            aggressionLevel = Math.min(aggressionLevel + 1, 5);
            adaptiveScrollIntensity = aggressionLevel;
          }
          
          // Decrease aggression if consistently successful
          if (recentSuccess >= 4 && aggressionLevel > 1) {
            aggressionLevel = Math.max(aggressionLevel - 1, 1);
            adaptiveScrollIntensity = aggressionLevel;
            waitTime = Math.max(waitTime * 0.95, 500); // More conservative reduction
          }
          
          // Dynamic patience adjustment based on performance
          if (consecutiveNoChange > patienceLevel / 2 && performanceScore < 1.0) {
            patienceLevel = Math.min(patienceLevel + 2, Math.floor(20 * performanceScore));
          }
        };
        
        if (scrollCapabilityAttempts > 0 && scrollCapabilityAttempts % 3 === 0) {
          adaptStrategy();
        }
        
        // Update progress with scroll capability information
        const scrollProgressPercent = Math.min(85, Math.max(10, (scrollCapabilityAttempts / 20) * 80)); // Dynamic based on actual scroll attempts
        const efficiencyInfo = scrollCapabilityAttempts > 3 ? ` (${messagesPerAttempt.toFixed(1)} msg/scroll)` : '';
        const scrollInfo = totalScrollAttempts !== scrollCapabilityAttempts ? ` [${scrollCapabilityAttempts}/${totalScrollAttempts} effective]` : '';
        
        chrome.runtime.sendMessage({
          type: "progress",
          percent: scrollProgressPercent,
          current: currentMessageCount,
          total: currentMessageCount,
          status: `Loading messages... (${currentMessageCount} found messages, scroll attempt ${scrollCapabilityAttempts}${scrollInfo}${efficiencyInfo})`,
        });

        // === PERFORMANCE-OPTIMIZED MULTI-METHOD SCROLLING - Prioritize efficient methods ===

        // SMART METHOD SELECTION: Use efficient methods more frequently
        const shouldUseMethod = (methodName, baseCondition) => {
          if (efficientMethodsUsed.has(methodName)) {
            return baseCondition; // Always use if proven efficient
          }
          if (inefficientMethods.has(methodName) && scrollAttempts > 10) {
            return false; // Skip if proven inefficient (after initial attempts)
          }
          return baseCondition; // Use normal logic
        };

        // Method 1: Dynamic container scrolling with adaptive intensity (ALWAYS USED - most reliable)
        if (conversationDetailContainer) {
          const scrollMethods = aggressionLevel;
          
          // Basic scroll to top - always do this
          conversationDetailContainer.scrollTop = 0;
          if (conversationDetailContainer.scrollTo) {
            conversationDetailContainer.scrollTo({
              top: 0,
              behavior: "instant",
            });
          }

          // Adaptive scrolling behaviors based on aggression level
          if (shouldUseMethod('smoothScroll', aggressionLevel >= 2) && conversationDetailContainer.scrollTo) {
            conversationDetailContainer.scrollTo({ top: 0, behavior: "auto" });
            await sleep(30 * aggressionLevel); // Reduced sleep time for performance
            conversationDetailContainer.scrollTo({
              top: 0,
              behavior: "smooth",
            });
            await sleep(50 * aggressionLevel); // Reduced sleep time
          }

          // Parent container scrolling - scale with aggression
          if (shouldUseMethod('parentScroll', aggressionLevel >= 3)) {
            let parent = conversationDetailContainer.parentElement;
            let parentLevel = 0;
            const maxParentLevels = Math.min(aggressionLevel * 2, 8); // Reduced max levels
            
            while (parent && parent !== document.body && parentLevel < maxParentLevels) {
              const parentRect = parent.getBoundingClientRect();
              if (parentRect.left > window.innerWidth * 0.1) {
                if (parent.scrollTo) {
                  parent.scrollTo({ top: 0, behavior: "instant" });
                  await sleep(5 * aggressionLevel); // Much faster
                }
                parent.scrollTop = 0;
              }
              parent = parent.parentElement;
              parentLevel++;
            }
          }
        }

        // Method 2: Dynamic window scrolling - scale with aggression (PERFORMANCE OPTIMIZED)
        if (shouldUseMethod('windowScroll', aggressionLevel >= 2)) {
          window.scrollTo({ top: 0, behavior: "instant" });
          await sleep(15 * aggressionLevel); // Reduced from 25
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }

        // Method 3: Dynamic focus and keyboard navigation (SELECTIVE USAGE)
        if (shouldUseMethod('focusKeyboard', aggressionLevel >= 3) && conversationDetailContainer) {
          if (conversationDetailContainer.focus) {
            conversationDetailContainer.focus();
          }

          const focusableElements =
            conversationDetailContainer.querySelectorAll(
              'input, textarea, [tabindex], [contenteditable], button, [role="textbox"]'
            );

          const elementsToFocus = Math.min(focusableElements.length, Math.max(1, aggressionLevel - 2)); // Reduced elements
          for (let i = 0; i < elementsToFocus; i++) {
            const element = focusableElements[i];
            if (element && element.focus) {
              element.focus();
              await sleep(15 * aggressionLevel); // Reduced from 25
              break; // Only focus first element for performance
            }
          }
        }

        // Method 4: Adaptive keyboard events - scale with aggression (OPTIMIZED)
        if (shouldUseMethod('keyboardEvents', aggressionLevel >= 2)) {
          const keyEvents = [
            { key: "Home", ctrlKey: true },
            { key: "PageUp", ctrlKey: true },
          ];
          
          if (aggressionLevel >= 4) {
            keyEvents.push(
              { key: "PageUp", ctrlKey: false }
              // Removed ArrowUp for performance
            );
          }

          const targetElement = conversationDetailContainer || document.body;
          for (const keyEvent of keyEvents) {
            targetElement.dispatchEvent(
              new KeyboardEvent("keydown", {
                ...keyEvent,
                bubbles: true,
                cancelable: true,
              })
            );
            await sleep(15 * aggressionLevel); // Reduced from 25

            targetElement.dispatchEvent(
              new KeyboardEvent("keyup", {
                ...keyEvent,
                bubbles: true,
                cancelable: true,
              })
            );
            await sleep(10 * aggressionLevel); // Reduced from 15
          }
        }

        // Method 5: Dynamic Page Up simulation - intensity based on aggression (PERFORMANCE OPTIMIZED)
        if (shouldUseMethod('pageUpSim', aggressionLevel >= 3)) {
          const pageUpCount = Math.min(aggressionLevel * 2, 12); // Reduced from aggressionLevel * 3, 20
          const targetElement = conversationDetailContainer || document.body;
          
          for (let i = 0; i < pageUpCount; i++) {
            targetElement.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "PageUp",
                bubbles: true,
                cancelable: true,
              })
            );
            await sleep(20 * aggressionLevel); // Reduced from 25

            if (aggressionLevel >= 4 && i % 2 === 0) { // Reduced frequency
              targetElement.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "PageUp",
                  ctrlKey: true,
                  bubbles: true,
                  cancelable: true,
                })
              );
              await sleep(20 * aggressionLevel); // Reduced from 25
            }
          }
        }

        // Method 6: ADAPTIVE load button detection - more thorough for higher aggression
        const loadButtonSelectors = [
          '[data-testid*="load"]',
          'button[aria-label*="load"]',
          'button[aria-label*="older"]',
          'button[aria-label*="previous"]',
          'button[aria-label*="more"]',
          'button[aria-label*="earlier"]',
          '[role="button"][aria-label*="load"]',
          '[aria-label*="Load older messages"]',
          '[aria-label*="See older messages"]',
          '[aria-label*="Load earlier messages"]',
          '[aria-label*="Show older"]',
          'span[role="button"]',
          'div[role="button"]',
          "button",
          '[role="button"]',
        ];

        let foundLoadButton = false;
        const selectorsToTry = aggressionLevel >= 4 ? loadButtonSelectors : loadButtonSelectors.slice(0, 8);

        for (const selector of selectorsToTry) {
          const buttons = conversationDetailContainer
            ? conversationDetailContainer.querySelectorAll(selector)
            : document.querySelectorAll(selector);

          const buttonsToCheck = aggressionLevel >= 3 ? buttons : Array.from(buttons).slice(0, 5);

          for (const button of buttonsToCheck) {
            if (button && button.offsetParent !== null) {
              const buttonText =
                button.textContent || button.getAttribute("aria-label") || "";

              if (
                buttonText.toLowerCase().includes("load") ||
                buttonText.toLowerCase().includes("older") ||
                buttonText.toLowerCase().includes("more") ||
                buttonText.toLowerCase().includes("previous") ||
                buttonText.toLowerCase().includes("earlier") ||
                buttonText.toLowerCase().includes("show")
              ) {
                foundLoadButton = true;
                hasFoundLoadButtons = true;
                lastSuccessfulMethod = "loadButton";

                // Adaptive clicking based on aggression level
                button.click();
                await sleep(50 * aggressionLevel);

                if (aggressionLevel >= 3) {
                  button.dispatchEvent(
                    new MouseEvent("mousedown", { bubbles: true })
                  );
                  button.dispatchEvent(
                    new MouseEvent("mouseup", { bubbles: true })
                  );
                  button.dispatchEvent(
                    new MouseEvent("click", { bubbles: true })
                  );
                  await sleep(75 * aggressionLevel);
                }

                if (aggressionLevel >= 4) {
                  button.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "Enter",
                      bubbles: true,
                    })
                  );
                  await sleep(50 * aggressionLevel);
                }
                
                if (foundLoadButton) break;
              }
            }
          }
          if (foundLoadButton) break;
        }

        if (foundLoadButton) {
          consecutiveNoChange = Math.max(0, consecutiveNoChange - Math.ceil(aggressionLevel / 2));
          patienceLevel = Math.min(patienceLevel + 1, 15); // Extend patience when buttons found
        }

        // Method 7: Dynamic mouse wheel events - scale with aggression
        if (aggressionLevel >= 2) {
          const wheelCount = Math.min(aggressionLevel * 3, 15);
          const wheelDelta = -3000 * adaptiveScrollIntensity;
          
          for (let i = 0; i < wheelCount; i++) {
            const wheelEvent = new WheelEvent("wheel", {
              deltaY: wheelDelta,
              deltaMode: 0,
              bubbles: true,
              cancelable: true,
            });

            if (conversationDetailContainer) {
              conversationDetailContainer.dispatchEvent(wheelEvent);
            }
            document.dispatchEvent(wheelEvent);
            await sleep(50 * aggressionLevel);
          }
        }

        // Method 8: Dynamic large scroll amounts - scale with aggression
        if (aggressionLevel >= 3 && conversationDetailContainer) {
          const scrollAmount = 10000 * adaptiveScrollIntensity;
          
          if (conversationDetailContainer.scrollBy) {
            conversationDetailContainer.scrollBy(0, -scrollAmount);
          }
          conversationDetailContainer.scrollTop = Math.max(
            0,
            conversationDetailContainer.scrollTop - scrollAmount
          );
        }

        if (aggressionLevel >= 4) {
          window.scrollBy(0, -15000 * adaptiveScrollIntensity);
        }

        // Method 9: Adaptive scrollable elements - more thorough for higher aggression
        if (aggressionLevel >= 4) {
          const allScrollableElements = document.querySelectorAll(
            '[role="log"], [role="main"], main, div[style*="overflow"], div[style*="scroll"]'
          );
          
          const elementsToScroll = Math.min(allScrollableElements.length, aggressionLevel * 2);
          
          for (let i = 0; i < elementsToScroll; i++) {
            const element = allScrollableElements[i];
            const rect = element.getBoundingClientRect();
            
            if (rect.left > window.innerWidth * 0.2) {
              element.scrollTop = 0;
              if (element.scrollTo) {
                element.scrollTo({ top: 0, behavior: "instant" });
              }
              if (element.scrollBy) {
                element.scrollBy(0, -5000 * adaptiveScrollIntensity);
              }
            }
          }
        }

        // Method 10: Adaptive touch events - only for maximum aggression
        if (aggressionLevel >= 5 && conversationDetailContainer) {
          try {
            if (window.Touch && window.TouchEvent) {
              const touch = new Touch({
                identifier: 0,
                target: conversationDetailContainer,
                clientX: containerRect.left + containerRect.width / 2,
                clientY: containerRect.top + 100,
                radiusX: 2.5,
                radiusY: 2.5,
                rotationAngle: 0,
                force: 0.5,
              });

              const touchStart = new TouchEvent("touchstart", {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch],
              });

              const touchMove = new TouchEvent("touchmove", {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch],
              });

              const touchEnd = new TouchEvent("touchend", {
                bubbles: true,
                cancelable: true,
                touches: [],
                targetTouches: [],
                changedTouches: [touch],
              });

              conversationDetailContainer.dispatchEvent(touchStart);
              await sleep(25 * aggressionLevel);
              conversationDetailContainer.dispatchEvent(touchMove);
              await sleep(25 * aggressionLevel);
              conversationDetailContainer.dispatchEvent(touchEnd);
            }
          } catch (touchError) {
          }
        }

        // ADAPTIVE wait time based on current strategy and performance
        await sleep(waitTime);

        // ADDITIONAL: Extra wait for potential lazy loading after initial scroll methods (ENHANCED FOR 10K+)
        if (aggressionLevel >= 3 && currentMessageCount > 500) {
          // Additional patience for large conversations that might have lazy loading (MORE PATIENT FOR 10K+)
          const extraLazyWait = Math.min(
            currentMessageCount > 10000 ? 2500 : // 2.5 seconds for ultra-massive
            currentMessageCount > 5000 ? 2000 :  // 2 seconds for massive
            currentMessageCount > 2000 ? 1500 : 
            currentMessageCount > 1000 ? 1200 : 800,
            3000 // Cap at 3 seconds
          );
          
          console.log(`⏳ Extra lazy loading wait: ${extraLazyWait}ms for potential delayed messages...`);
          await sleep(extraLazyWait);
        }

        // PROGRESSIVE MAP-BASED extraction: Save current view to Map
        const progressiveSave = extractAndSaveMessagesToMap(false);
        const newMessageCount = progressiveSave.totalInMap;
        const newMessages = newMessageCount - currentMessageCount;
        const loadTime = Date.now() - startTime;

        // ENHANCED: Lazy Loading Detection and Management
        const currentScrollTop = conversationDetailContainer ? conversationDetailContainer.scrollTop : window.pageYOffset;
        const isAtTop = currentScrollTop <= 10; // Within 10px of top
        
        // LAZY LOADING DETECTION: Look for Facebook's loading indicators
        const lazyLoadingSelectors = [
          '[aria-label*="Loading"]',
          '[aria-label*="loading"]', 
          '.loading',
          '[data-testid*="loading"]',
          '[data-testid*="spinner"]',
          '.spinner',
          'svg[aria-label*="Loading"]',
          '[role="progressbar"]',
          '.ReactSpinner', // Common Facebook loading component
          '[data-visualcompletion="loading-state"]'
        ];
        
        const lazyLoadingIndicators = lazyLoadingSelectors
          .map(selector => document.querySelectorAll(selector))
          .reduce((acc, nodeList) => acc + nodeList.length, 0);
        
        const isLazyLoading = lazyLoadingIndicators > 0;
        
        // ENHANCED: Wait for lazy loading with dynamic timeout (OPTIMIZED FOR 10K+)
        let lazyLoadWaitTime = 0;
        if (isLazyLoading) {
          // Calculate dynamic wait time based on conversation size (MORE PATIENT FOR MASSIVE CONVERSATIONS)
          if (currentMessageCount > 10000) {
            lazyLoadWaitTime = 6000; // 6 seconds for ultra-massive conversations
          } else if (currentMessageCount > 5000) {
            lazyLoadWaitTime = 5000; // 5 seconds for massive conversations
          } else if (currentMessageCount > 2000) {
            lazyLoadWaitTime = 4000; // 4 seconds for large conversations
          } else if (currentMessageCount > 1000) {
            lazyLoadWaitTime = 3000; // 3 seconds for medium conversations
          } else {
            lazyLoadWaitTime = 2500; // 2.5 seconds for smaller conversations
          }
          
          console.log(`⏳ Facebook lazy loading detected, waiting ${lazyLoadWaitTime}ms for messages to load...`);
          
          // Update progress to show lazy loading wait
          chrome.runtime.sendMessage({
            type: "progress",
            percent: Math.min(80, (scrollAttempts / maxRetries) * 80),
            current: currentMessageCount,
            total: currentMessageCount,
            status: `Waiting for Facebook to load more messages... (${currentMessageCount} found)`,
          });
          
          await sleep(lazyLoadWaitTime);
          
          // After waiting, extract again to catch newly loaded messages
          const lazyLoadSave = extractAndSaveMessagesToMap(false);
          const newLazyMessages = lazyLoadSave.totalInMap - newMessageCount;
          
          if (newLazyMessages > 0) {
            console.log(`✅ Lazy loading found ${newLazyMessages} additional messages after wait`);
            // Update our counts with the lazy loaded messages
            currentMessageCount = lazyLoadSave.totalInMap;
            // Reset consecutive no change counter since we found new messages
            consecutiveNoChange = 0;
          }
        }
        
        // Track scroll position consistency and detect when scrolling stops working
        if (!window.lastScrollTop) window.lastScrollTop = currentScrollTop;
        const scrollPositionChanged = Math.abs(currentScrollTop - window.lastScrollTop) > 5;
        
        // Track consecutive times we've been at the top with same scroll position
        if (!window.consecutiveAtTop) window.consecutiveAtTop = 0;
        if (isAtTop && !scrollPositionChanged && !isLazyLoading) {
          window.consecutiveAtTop++;
        } else {
          window.consecutiveAtTop = 0;
        }
        
        // Detect if scrolling is no longer effective (but account for lazy loading)
        const scrollingNotWorking = window.consecutiveAtTop >= 5 && !isLazyLoading; // Increased threshold and ignore during lazy loading
        
        window.lastScrollTop = currentScrollTop;
        
        console.log(`📍 Scroll: ${currentScrollTop}, atTop: ${isAtTop}, changed: ${scrollPositionChanged}, consecutive: ${window.consecutiveAtTop}, lazyLoading: ${isLazyLoading}`);

        // Track loading performance for adaptation with method tracking
        loadingHistory.push({
          attempt: scrollAttempts,
          newMessages: newMessages,
          loadTime: loadTime,
          aggressionLevel: aggressionLevel,
          method: lastSuccessfulMethod || 'mixed',
          efficiency: messagesPerAttempt,
          performanceScore: performanceScore
        });

        // Keep only recent history for adaptation
        if (loadingHistory.length > 10) {
          loadingHistory = loadingHistory.slice(-10);
        }

        // Enhanced loading detection - check for Facebook's own loading states
        const generalLoadingIndicators = document.querySelectorAll(
          '[aria-label*="Loading"], [aria-label*="loading"], .loading, [data-testid*="loading"]'
        );
        const isStillLoadingGeneral = generalLoadingIndicators.length > 0;

        if (isStillLoadingGeneral || isLazyLoading) {
          console.log("⏳ Page still loading or lazy loading active, extending patience...");
          consecutiveNoChange = Math.max(0, consecutiveNoChange - 1);
        }

        if (newMessageCount > currentMessageCount) {
          consecutiveNoChange = 0;
          currentMessageCount = newMessageCount;
          noProgressStreak = 0;
          lastProgressAttempt = scrollCapabilityAttempts; // Track when we last made progress using capability attempts
          
          // Calculate message loading rate for adaptation
          messageLoadingRate = newMessages / (loadTime / 1000); // messages per second
          lastSuccessfulMethod = 'extractAndSave'; // Mark extraction as successful method
          
          // ENHANCED: Provide user feedback for massive conversations with better estimates (OPTIMIZED FOR 10K+)
          if (currentMessageCount > 10000) {
            // For ultra-massive conversations, provide completion estimates
            const projectedFinalCount = Math.min(currentMessageCount * 1.2, 50000); // Conservative projection
            const progressPercent = Math.min(75, (currentMessageCount / projectedFinalCount) * 75);
            const streamingInfo = streamingSaveCount > 0 ? ` (${streamingSaveCount} files saved)` : '';
            chrome.runtime.sendMessage({
              type: "progress",
              percent: progressPercent,
              current: currentMessageCount,
              total: projectedFinalCount,
              status: `Ultra-massive conversation! Found ${currentMessageCount} messages${streamingInfo} (estimated final: ${Math.floor(projectedFinalCount)})...`,
            });
          } else if (currentMessageCount > 5000) {
            // For massive conversations, provide time estimates
            const messagesPerAttemptCurrent = currentMessageCount / scrollCapabilityAttempts;
            const streamingInfo = streamingSaveCount > 0 ? ` (${streamingSaveCount} files saved)` : '';
            
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollCapabilityAttempts / 100) * 80), // No fixed max, so use 100 as reference
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading massive conversation... (${currentMessageCount} messages${streamingInfo}, ${scrollCapabilityAttempts} scroll attempts, ${messagesPerAttemptCurrent.toFixed(1)} msg/scroll)`,
            });
          } else if (currentMessageCount > 2000) {
            const streamingInfo = streamingSaveCount > 0 ? ` (${streamingSaveCount} files saved)` : '';
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollCapabilityAttempts / 50) * 80), // Use 50 as reference for large convos
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading large conversation... (${currentMessageCount} messages${streamingInfo}, ${scrollCapabilityAttempts} scroll attempts)`,
            });
          } else if (currentMessageCount > 100 && scrollCapabilityAttempts > 5) {
            const streamingInfo = streamingSaveCount > 0 ? ` (${streamingSaveCount} files saved)` : '';
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollCapabilityAttempts / 20) * 80), // Use 20 as reference for medium convos
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading conversation... (${currentMessageCount} messages${streamingInfo}, ${scrollCapabilityAttempts} scroll attempts)`,
            });
          } else {
            const streamingInfo = streamingSaveCount > 0 ? ` (${streamingSaveCount} files saved)` : '';
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(70, (scrollCapabilityAttempts / 30) * 70), // Use 30 as reference for smaller convos
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading conversation... (${currentMessageCount} messages${streamingInfo})`,
            });
          }
          
          // Optimize for successful methods
          if (lastSuccessfulMethod) {
            efficientMethodsUsed.add(lastSuccessfulMethod);
          }
        } else {
          consecutiveNoChange++;
          noProgressStreak++;
          
          // ENHANCED: If no progress for several attempts, try extra aggressive scrolling
          if (consecutiveNoChange >= 3 && consecutiveNoChange % 3 === 0 && scrollCapabilityAttempts > 5) {
            console.log(`🔍 No progress for ${consecutiveNoChange} attempts, trying extra aggressive scroll...`);
            
            // Extra aggressive scroll methods
            if (conversationDetailContainer) {
              // Multiple rapid scrolls to top
              for (let i = 0; i < 8; i++) { // Increased from 5 to 8
                conversationDetailContainer.scrollTop = 0;
                conversationDetailContainer.scrollTo({top: 0, behavior: "instant"});
                await sleep(50); // Reduced sleep time for more attempts
              }
              
              // Try scrolling parent containers more aggressively
              let parent = conversationDetailContainer.parentElement;
              let parentLevel = 0;
              while (parent && parent !== document.body && parentLevel < 8) { // Increased from 5 to 8
                parent.scrollTop = 0;
                if (parent.scrollTo) {
                  parent.scrollTo({top: 0, behavior: "instant"});
                }
                // Try additional scroll methods on parents
                if (parent.scrollBy) {
                  parent.scrollBy(0, -10000);
                }
                parent = parent.parentElement;
                parentLevel++;
              }
            }
            
            // Force window scroll with multiple methods
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            window.scrollBy(0, -10000);
            
            // Additional aggressive methods for massive conversations
            if (currentMessageCount > 500) {
              // Try keyboard events
              const targetElement = conversationDetailContainer || document.body;
              for (let i = 0; i < 5; i++) {
                targetElement.dispatchEvent(new KeyboardEvent("keydown", {
                  key: "Home", ctrlKey: true, bubbles: true
                }));
                targetElement.dispatchEvent(new KeyboardEvent("keydown", {
                  key: "PageUp", ctrlKey: true, bubbles: true
                }));
                await sleep(100);
              }
            }
            
            // Wait a bit more for potential lazy loading
            await sleep(1500); // Increased wait time
            
            // Try to extract again after aggressive scroll
            const aggressiveSave = extractAndSaveMessagesToMap(false);
            const aggressiveNewCount = aggressiveSave.totalInMap;
            
            if (aggressiveNewCount > currentMessageCount) {
              console.log(`✅ Aggressive scroll found ${aggressiveNewCount - currentMessageCount} additional messages!`);
              currentMessageCount = aggressiveNewCount;
              consecutiveNoChange = 0; // Reset since we found messages
              noProgressStreak = 0;
            }
          }
        }

        // Update progress with scroll capability information (already done above in main loop)
        // No need for additional progress update here since it's handled in the scroll capability check

        // ENHANCED stopping condition with SMART early detection and lazy loading awareness
        const shouldStop = () => {
          // User requested stop
          if (userRequestedStop) {
            console.log("🛑 User requested stop");
            return true;
          }
          
          // NEVER stop while lazy loading is active
          if (isLazyLoading) {
            console.log("⏳ Lazy loading active - continuing to wait for messages");
            return false;
          }
          
          // NEW: If we can't scroll anymore (detected in scroll capability check), stop immediately
          if (!canStillScroll) {
            console.log("🛑 SCROLL CAPABILITY: No more scrolling possible - stopping");
            return true;
          }
          
          // SPECIAL OVERRIDE: For potentially massive conversations, be extra persistent
          if (currentMessageCount >= 300 && currentMessageCount < 10000) {
            // This suggests a large conversation, be extra patient
            if (scrollCapabilityAttempts < 200) { // Much higher threshold for large conversations
              console.log(`🚀 LARGE CONVERSATION DETECTED (${currentMessageCount} messages) - continuing with high persistence (${scrollCapabilityAttempts}/200 attempts)`);
              return false; // Keep going!
            }
          }
          
          // PRIORITY: If we can't scroll up anymore (stuck at top), but give extra time for lazy loading
          if (scrollingNotWorking && currentMessageCount > 0) {
            // For very long conversations, be extra patient with lazy loading
            if (currentMessageCount > 5000 && window.consecutiveAtTop < 10) { // Increased from 8
              console.log("🏔️ Massive conversation - allowing more time for lazy loading");
              return false;
            }
            if (currentMessageCount > 2000 && window.consecutiveAtTop < 8) { // Increased from 6
              console.log("🏔️ Large conversation - allowing more time for lazy loading");
              return false;
            }
            if (currentMessageCount > 500 && window.consecutiveAtTop < 6) { // New threshold for medium-large conversations
              console.log("🏔️ Medium-large conversation - allowing more time for lazy loading");
              return false;
            }
            console.log("🔝 Can't scroll up anymore and no lazy loading, reached top of conversation");
            return true;
          }
          
          // ENHANCED: If we're at the top AND no new messages AND scroll not working AND no lazy loading, definitely done
          if (isAtTop && consecutiveNoChange >= 3 && scrollCapabilityAttempts >= 3 && !scrollPositionChanged && !isLazyLoading) {
            console.log("🔝 At top with no progress, no scroll changes, and no lazy loading - conversation complete");
            return true;
          }
          
          // ENHANCED: Smart early detection for massive conversations (more patient with lazy loading)
          if (consecutiveNoChange >= 12 && currentMessageCount > 0 && !isLazyLoading) { // Increased from 8 to 12
            // MASSIVE conversations (5k+ messages) - be very patient but still efficient
            if (currentMessageCount > 5000 && scrollCapabilityAttempts >= 150 && consecutiveNoChange >= 25) { // Increased patience significantly
              console.log("🏔️ Massive conversation (5k+) - stopping after extensive scroll attempts");
              return true;
            }
            // VERY LARGE conversations (2k+ messages) - be patient
            if (currentMessageCount > 2000 && scrollCapabilityAttempts >= 100 && consecutiveNoChange >= 20) { // Increased patience
              console.log("🏔️ Very large conversation (2k+) - stopping after many scroll attempts");
              return true;
            }
            // LARGE conversations (1k+ messages) - moderate patience
            if (currentMessageCount > 1000 && scrollCapabilityAttempts >= 60 && consecutiveNoChange >= 15) { // Increased patience
              console.log("🏔️ Large conversation (1k+) - stopping after reasonable scroll attempts");
              return true;
            }
            // For small conversations (under 50 messages), be more aggressive about stopping
            if (currentMessageCount < 50 && scrollCapabilityAttempts >= 10) { // Increased from 8 to 10
              console.log("📝 Small conversation - stopping after sufficient scroll attempts");
              return true;
            }
            // For medium conversations (50-200 messages), stop after more attempts
            if (currentMessageCount < 200 && scrollCapabilityAttempts >= 20 && consecutiveNoChange >= 12) { // Increased patience
              console.log("📝 Medium conversation - stopping after extended scroll attempts");
              return true;
            }
            // For conversations 200-1000 messages
            if (currentMessageCount >= 200 && currentMessageCount < 1000 && scrollCapabilityAttempts >= 40 && consecutiveNoChange >= 12) {
              console.log("📝 Large-medium conversation - stopping after extended scroll attempts");
              return true;
            }
          }
          
          // ENHANCED: If scroll position isn't changing AND no new messages AND no lazy loading, we're stuck
          if (!scrollPositionChanged && consecutiveNoChange >= 10 && scrollCapabilityAttempts >= 10 && !isLazyLoading) { // Increased thresholds even more
            console.log("🔒 Scroll position stuck, no new messages, and no lazy loading - likely complete");
            return true;
          }
          
          // ENHANCED: Dynamic patience for massive conversations (accounting for lazy loading delays) - ULTRA PATIENT FOR 10K+
          let dynamicPatience = Math.min(patienceLevel + 8, 25); // Increased base patience even more
          if (currentMessageCount > 10000) {
            dynamicPatience = 60; // ULTRA maximum patience for ultra-massive conversations (10k+)
          } else if (currentMessageCount > 5000) {
            dynamicPatience = 50; // Maximum patience for massive conversations
          } else if (currentMessageCount > 2000) {
            dynamicPatience = 40; // Very high patience for very large conversations  
          } else if (currentMessageCount > 1000) {
            dynamicPatience = 35; // High patience for large conversations
          } else if (currentMessageCount > 500) {
            dynamicPatience = 30; // Good patience for moderate conversations
          } else if (currentMessageCount > 200) {
            dynamicPatience = 25; // Medium patience for long conversations
          } else if (currentMessageCount > 100) {
            dynamicPatience = 20; // Medium patience for medium conversations
          } else {
            dynamicPatience = 15; // Higher patience for small conversations too
          }
          
          // Basic patience exceeded (with dynamic patience)
          if (consecutiveNoChange >= dynamicPatience && !isLazyLoading) {
            console.log(`💤 Patience exhausted (${consecutiveNoChange}/${dynamicPatience}) and no lazy loading - stopping`);
            return true;
          }
          
          // ENHANCED: No progress for extended period suggests conversation is fully loaded (MORE LENIENT FOR 10K+)
          const maxNoProgressStreak = Math.min(dynamicPatience * 2, currentMessageCount > 10000 ? 80 : currentMessageCount > 5000 ? 60 : 40);
          if (noProgressStreak >= maxNoProgressStreak && !isLazyLoading) {
            console.log(`📈 No progress streak too long (${noProgressStreak}/${maxNoProgressStreak}) and no lazy loading - stopping`);
            return true;
          }
          
          // PERFORMANCE-BASED: If efficiency is very low and we've tried enough, stop (MORE LENIENT FOR 10K+)
          if (scrollCapabilityAttempts >= 50 && performanceScore < 0.3 && (scrollCapabilityAttempts - lastProgressAttempt) > 40) { // Increased thresholds and lowered performance threshold more
            console.log(`⚡ Very low efficiency (${performanceScore.toFixed(2)}) with no recent progress - stopping`);
            return true;
          }
          
          // SMART: If we've been scrolling a lot and message rate is very low, probably done (but not during lazy loading) (MORE LENIENT FOR 10K+)
          if (scrollCapabilityAttempts >= 40 && messageLoadingRate < 0.02 && consecutiveNoChange >= 15 && !isLazyLoading) { // Increased thresholds and lowered rate threshold more
            return true;
          }
          
          return false;
        };

        if (shouldStop()) {
          break;
        }

        // No need to increment scrollAttempts here since we're using scrollCapabilityAttempts
        // scrollAttempts is only incremented when we can actually scroll

        // ADAPTIVE special methods based on performance and aggression
        if (scrollCapabilityAttempts % Math.max(2, 6 - aggressionLevel) === 0) {
         

          // Message-specific scrolling
          const allMessages =
            conversationDetailContainer.querySelectorAll('div[role="row"]');
          if (allMessages.length > 0 && aggressionLevel >= 3) {
            const firstMessage = allMessages[0];
            if (firstMessage.scrollIntoView) {
              firstMessage.scrollIntoView({
                behavior: "instant",
                block: "start",
              });
              await sleep(300 * aggressionLevel);
            }
          }

          // Enhanced focus strategies
          if (aggressionLevel >= 4) {
            const focusElements = [
              conversationDetailContainer.querySelector('[tabindex="0"]'),
              conversationDetailContainer.querySelector('[role="textbox"]'),
              conversationDetailContainer.querySelector("input"),
              conversationDetailContainer.querySelector("textarea"),
              conversationDetailContainer,
            ].filter(Boolean);

            for (const el of focusElements) {
              if (el.focus) {
                el.focus();
                await sleep(100 * aggressionLevel);

                el.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Home",
                    ctrlKey: true,
                    bubbles: true,
                  })
                );
                await sleep(75 * aggressionLevel);
              }
            }
          }
        }

        // ADAPTIVE focus clicking based on performance
        if (scrollCapabilityAttempts % Math.max(3, 8 - aggressionLevel) === 0 && aggressionLevel >= 3) {
          
          if (conversationDetailContainer) {
            const clickX = containerRect.left + containerRect.width / 2;
            const clickY = containerRect.top + 100;

            const clickEvent = new MouseEvent("click", {
              clientX: clickX,
              clientY: clickY,
              bubbles: true,
              cancelable: true,
            });

            conversationDetailContainer.dispatchEvent(clickEvent);
            await sleep(150 * aggressionLevel);
          }
        }
      }

      // Remove the message listener
      chrome.runtime.onMessage.removeListener(messageListener);

      const stopReason = userRequestedStop ? "User requested stop" : "Automatic completion";
      console.log('stopReason: ', stopReason);
      
      if (userRequestedStop) {
        console.log('userRequestedStop: ', userRequestedStop);
      }

      // ADAPTIVE final scrolling - intensity based on final aggression level (skip if user stopped)
      if (!userRequestedStop) {
        const finalScrollCount = Math.min(aggressionLevel + 2, 8);
        for (let i = 0; i < finalScrollCount; i++) {
          if (conversationDetailContainer) {
            conversationDetailContainer.scrollTop = 0;
            if (conversationDetailContainer.scrollTo) {
              conversationDetailContainer.scrollTo({
                top: 0,
                behavior: "instant",
              });
            }

            // Also ensure parent containers are at top
            let parent = conversationDetailContainer.parentElement;
            let parentLevel = 0;
            while (parent && parent !== document.body && parentLevel < 3) {
              parent.scrollTop = 0;
              if (parent.scrollTo) {
                parent.scrollTo({ top: 0, behavior: "instant" });
              }
              parent = parent.parentElement;
              parentLevel++;
            }
          }

          // Ensure window is also at top
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;

          await sleep(200);
        }
      }

      // ADAPTIVE final wait based on conversation characteristics and loading performance (shorter if user stopped)
      const avgLoadTime = loadingHistory.reduce((sum, h) => sum + h.loadTime, 0) / Math.max(loadingHistory.length, 1);
      const baseFinalWaitTime = Math.min(
        Math.max(
          2000, // minimum wait
          avgLoadTime * 1.5, // 1.5x average load time
          isLongConversation ? 4000 : 2500 // longer for long conversations
        ),
        8000 // maximum wait
      );
      
      // Reduce wait time if user stopped early
      const finalWaitTime = userRequestedStop ? Math.min(baseFinalWaitTime / 2, 3000) : baseFinalWaitTime;
      
      await sleep(finalWaitTime);

      const finalCount = messageMap.size;
      
      // STREAMING SAVE: Save any remaining buffered messages
      if (streamingBuffer.length > 0) {
        console.log(`📦 FINAL STREAMING SAVE: Saving remaining ${streamingBuffer.length} messages...`);
        saveStreamingData();
      }
      
      // Log final scroll capability statistics
      console.log(`📊 SCROLL CAPABILITY STATS:
        💬 Messages extracted: ${finalCount}
        📜 Effective scroll attempts: ${scrollCapabilityAttempts}
        🔄 Total attempts (including non-scrollable): ${totalScrollAttempts}
        ⚡ Efficiency: ${scrollCapabilityAttempts > 0 ? (finalCount / scrollCapabilityAttempts).toFixed(1) : 'N/A'} messages per scroll
        🎯 Scroll success rate: ${totalScrollAttempts > 0 ? ((scrollCapabilityAttempts / totalScrollAttempts) * 100).toFixed(1) : 'N/A'}%
        🚀 Smart stopping: ${canStillScroll ? 'Manual stop' : 'Auto-detected completion'}
        📁 Streaming files saved: ${streamingSaveCount}
      `);

      return { finalCount, userRequestedStop, scrollCapabilityAttempts, totalScrollAttempts };
    }

    // Simple extraction of text content only from conversation in original order
    async function extractAllMessages() {
      try {
        // Show initial progress
        updateProgress(5, 0);
        chrome.runtime.sendMessage({
          type: "progress",
          percent: 10,
          current: 0,
          total: 0,
          status: "Starting dynamic scrolling to load all messages...",
        });

        const scrollResult = await performAdvancedScroll();
        const totalScrolledMessages = scrollResult.finalCount;
        const wasStoppedByUser = scrollResult.userRequestedStop;
        const effectiveScrollAttempts = scrollResult.scrollCapabilityAttempts;
        const totalAttempts = scrollResult.totalScrollAttempts;

        chrome.runtime.sendMessage({
          type: "progress",
          percent: 85,
          current: messageMap.size,
          total: messageMap.size,
          status: `Processing ${messageMap.size} messages from Map...`,
        });

        // Since scrolling up collects newest messages first, we need to reverse the order
        // to get the proper Facebook-like ordering (oldest to newest)
        let globalIndex = 0;
        const reversedMessages = Array.from(messageMap.values()).reverse(); // Reverse to get oldest first
        
        // Reassign proper chronological order - oldest messages get lowest numbers
        for (const msg of reversedMessages) {
          msg.chronoOrder = globalIndex++; // Now oldest messages have lowest chronoOrder
        }
        
        // Sort by the corrected chronoOrder (oldest first)
        const allMessages = reversedMessages.sort((a, b) => {
          return (a.chronoOrder || 0) - (b.chronoOrder || 0);
        });

        if (allMessages.length > 0) {
          messages.push(...allMessages);
          totalMessages = messages.length;

          updateProgress(100, totalMessages);
        } else {
          
          chrome.runtime.sendMessage({
            type: "error",
            error:
              "No messages found. Make sure you are viewing a conversation with messages.",
          });
          return;
        }

        // Generate simple text output in Messenger's original order with deduplication
        let output = "";

        // Sort messages chronologically (oldest first) - messages already properly ordered
        const sortedMessages = messages.sort((a, b) => {
          // Use chronoOrder (now properly set with oldest = lowest numbers)
          const aOrder = a.chronoOrder || a.mapIndex || a.index || 0;
          const bOrder = b.chronoOrder || b.mapIndex || b.index || 0;
          return aOrder - bOrder;
        });

        // ENHANCED: Remove duplicates with better similarity detection
        const uniqueMessages = [];
        const seenMessages = new Set();
        const seenContentFingerprints = new Set();

        for (const msg of sortedMessages) {
          if (msg.type === "message") {
            const messageKey = `${msg.sender}:${msg.content}`;
            const contentFingerprint = msg.content.toLowerCase().trim().replace(/\s+/g, ' ');

            // Skip if exact same message key 
            if (seenMessages.has(messageKey)) {
              console.log(`🔄 Skipped exact duplicate: "${msg.content.substring(0, 50)}..."`);
              continue;
            }

            // Check for very similar messages from same sender using enhanced similarity
            let isSimilarDuplicate = false;
            for (const existingFingerprint of seenContentFingerprints) {
              if (contentFingerprint.length > 10 && existingFingerprint.length > 10) {
                const similarity = calculateContentSimilarity(contentFingerprint, existingFingerprint);
                if (similarity > 0.85) { // 85% similar threshold
                  console.log(`🔄 Skipped similar duplicate (${(similarity * 100).toFixed(1)}% match): "${msg.content.substring(0, 50)}..."`);
                  isSimilarDuplicate = true;
                  break;
                }
              }
            }

            if (!isSimilarDuplicate) {
              uniqueMessages.push(msg);
              seenMessages.add(messageKey);
              seenContentFingerprints.add(contentFingerprint);
            }
          } else {
            // Always include date headers (but check for date duplicates too)
            const dateContent = msg.content.toLowerCase().trim();
            if (!seenContentFingerprints.has(dateContent)) {
              uniqueMessages.push(msg);
              seenContentFingerprints.add(dateContent);
            }
          }
        }

        // Group messages by date in chronological order for proper Facebook-like output
        const messagesByDate = new Map();
        const dateOrder = [];
        
        for (const msg of uniqueMessages) {
          if (msg.type === "date") {
            const dateKey = msg.content;
            if (!messagesByDate.has(dateKey)) {
              messagesByDate.set(dateKey, []);
              dateOrder.push(dateKey);
            }
          } else if (msg.type === "message") {
            // Find the most recent date for this message
            let currentDate = "Unknown Date";
            
            // Look backwards through the uniqueMessages to find the date this message belongs to
            const msgIndex = uniqueMessages.indexOf(msg);
            for (let i = msgIndex - 1; i >= 0; i--) {
              if (uniqueMessages[i].type === "date") {
                currentDate = uniqueMessages[i].content;
                break;
              }
            }
            
            // If no date found before this message, look forward
            if (currentDate === "Unknown Date") {
              for (let i = msgIndex + 1; i < uniqueMessages.length; i++) {
                if (uniqueMessages[i].type === "date") {
                  currentDate = uniqueMessages[i].content;
                  break;
                }
              }
            }
            
            // Ensure we have an entry for this date
            if (!messagesByDate.has(currentDate)) {
              messagesByDate.set(currentDate, []);
              if (!dateOrder.includes(currentDate)) {
                dateOrder.push(currentDate);
              }
            }
            
            messagesByDate.get(currentDate).push(msg);
          }
        }
        
        // Sort dates chronologically and output messages in proper order
        output += `Facebook Messenger Conversation Export\n`;
        output += `Exported: ${new Date().toLocaleString()}\n`;
        output += `Total Messages: ${uniqueMessages.filter(m => m.type === "message").length}\n`;
        output += `${'='.repeat(50)}\n\n`;
        
        // Output messages grouped by date in chronological order
        for (const dateKey of dateOrder) {
          const messagesForDate = messagesByDate.get(dateKey);
          if (messagesForDate && messagesForDate.length > 0) {
            output += `--- ${dateKey} ---\n\n`;
            
            // Sort messages within this date by their chronological order
            const sortedDateMessages = messagesForDate.sort((a, b) => {
              const aOrder = a.chronoOrder || a.mapIndex || a.index || 0;
              const bOrder = b.chronoOrder || b.mapIndex || b.index || 0;
              return aOrder - bOrder;
            });
            
            for (const message of sortedDateMessages) {
              if (settings.includeTimestamps && message.timestamp) {
                output += `${message.sender} [${message.timestamp}]: ${message.content}\n`;
              } else {
                output += `${message.sender}: ${message.content}\n`;
              }
            }
            output += "\n";
          }
        }

        // Download the file
        const conversationTitle = getConversationTitle();
        const filename = `messenger_${new Date()
          .toISOString()
          .slice(0, 10)}_ALL_MESSAGES.txt`;

        const blob = new Blob([output], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        // Send completion message with scroll capability stats
        const exportStatus = wasStoppedByUser ? "stopped by user" : "completed automatically";
        const scrollEfficiency = effectiveScrollAttempts > 0 ? (totalMessages / effectiveScrollAttempts).toFixed(1) : 'N/A';
        const scrollSuccessRate = totalAttempts > 0 ? ((effectiveScrollAttempts / totalAttempts) * 100).toFixed(1) : 'N/A';
        
        // Final save remaining streaming buffer
        if (streamingBuffer.length > 0) {
          saveStreamingData();
        }
        
        const streamingInfo = streamingSaveCount > 0 ? ` Also saved ${streamingSaveCount} streaming files during extraction.` : '';
        
        chrome.runtime.sendMessage({
          type: "complete",
          totalMessages: totalMessages,
          filename: filename,
          participants: ["YOU", getConversationPartnerName() || "OTHER PERSON"],
          status: exportStatus + streamingInfo,
          scrollStats: {
            effectiveScrolls: effectiveScrollAttempts,
            totalAttempts: totalAttempts,
            efficiency: scrollEfficiency,
            successRate: scrollSuccessRate,
            streamingSaves: streamingSaveCount
          }
        });

      } catch (error) {
        chrome.runtime.sendMessage({
          type: "error",
          error: error.message,
        });
      }
    }

    // Helper to get conversation title for filename
    function getConversationTitle() {
      const selectors = [
        'h1[dir="auto"]',
        '[data-testid="conversation_name"] span',
        'div[role="banner"] h1',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          return el.textContent
            .trim()
            .replace(/[^a-zA-Z0-9]/g, "_")
            .substring(0, 30);
        }
      }

      return "unknown_conversation";
    }

    // Start the extraction process
    extractAllMessages();
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "progress") {
    updateProgress(message.percent);
    const statusText = message.status || `Processing conversation - ${
      message.current || message.total || 0
    } messages found`;
    showStatus(statusText, "info");
  } else if (message.type === "streamingSave") {
    // Handle streaming save notifications
    const statusText = `💾 Streaming save: ${message.filename} (${message.messageCount} messages, total saved: ${message.totalSaved})`;
    showStatus(statusText, "success");
    console.log(`📦 Streaming save: ${message.filename}`);
  } else if (message.type === "complete") {
    const filename = message.filename || "messenger_chat.txt";
    const participants = message.participants
      ? message.participants.join(" and ")
      : "both participants";
    
    const exportStatus = message.status === "stopped by user" 
      ? `Stopped! ${message.totalMessages} messages from ${participants} saved to ${filename}`
      : `Complete! ${message.totalMessages} text messages from ${participants} saved to ${filename}`;
    
    showStatus(exportStatus, "success");
    resetUI();
  } else if (message.type === "error") {
    showStatus(`Error: ${message.error}`, "error");
    resetUI();
  }
});

// Event listeners
checkStatusBtn.addEventListener("click", checkCurrentPage);
startExportBtn.addEventListener("click", startExport);
stopExportBtn.addEventListener("click", stopExport);

// Check page status when popup opens
document.addEventListener("DOMContentLoaded", checkCurrentPage);
