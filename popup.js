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
          
          // DYNAMIC MAX RETRIES - scales with conversation size and performance
          if (currentMessageCount > 10000) {
            // MASSIVE conversations (10k+) - scale dramatically with performance
            dynamicMaxRetries = Math.floor(Math.max(300, Math.min(2000, 
              currentMessageCount * 0.15 * performanceScore
            )));
          } else if (currentMessageCount > 5000) {
            // Very large conversations (5k+) - generous scaling
            dynamicMaxRetries = Math.floor(Math.max(200, Math.min(1000, 
              currentMessageCount * 0.1 * performanceScore
            )));
          } else if (currentMessageCount > 2000) {
            // Large conversations (2k+) - moderate scaling
            dynamicMaxRetries = Math.floor(Math.max(150, Math.min(500, 
              currentMessageCount * 0.08 * performanceScore
            )));
          } else if (currentMessageCount > 1000) {
            // Medium conversations (1k+) - conservative scaling
            dynamicMaxRetries = Math.floor(Math.max(100, Math.min(300, 
              currentMessageCount * 0.06 * performanceScore
            )));
          } else if (currentMessageCount > 500) {
            // Small conversations - fixed reasonable limit
            dynamicMaxRetries = Math.floor(Math.max(60, Math.min(150, 
              currentMessageCount * 0.05 * performanceScore
            )));
          } else {
            // Very small conversations - minimal attempts
            dynamicMaxRetries = Math.floor(Math.max(20, Math.min(80, 
              currentMessageCount * 0.1 + 10
            )));
          }
          
          console.log(`🎯 Dynamic attempts: ${dynamicMaxRetries} (performance: ${performanceScore.toFixed(2)}, msg/attempt: ${messagesPerAttempt.toFixed(1)})`);
        };
        
        calculateDynamicAttempts();
        
        // PERFORMANCE-OPTIMIZED wait times
        if (currentMessageCount > 5000) {
          waitTime = performanceScore > 1.2 ? 1500 : 2000; // Faster if efficient
        } else if (currentMessageCount > 2000) {
          waitTime = performanceScore > 1.2 ? 1200 : 1800;
        } else if (currentMessageCount > 1000) {
          waitTime = performanceScore > 1.2 ? 1000 : 1500;
        } else if (currentMessageCount < 30) {
          waitTime = 600; // Always fast for small conversations
        } else if (currentMessageCount < 100) {
          waitTime = 800;
        } else {
          waitTime = Math.max(800, 2000 - (aggressionLevel * 200)); // Scale with aggression
        }
        
        // PERFORMANCE-BASED patience levels
        if (currentMessageCount > 5000) {
          patienceLevel = Math.floor(15 * performanceScore); // Scale patience with performance
        } else if (currentMessageCount > 2000) {
          patienceLevel = Math.floor(12 * performanceScore);
        } else if (currentMessageCount > 1000) {
          patienceLevel = Math.floor(10 * performanceScore);
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

      while (scrollAttempts < dynamicMaxRetries && !userRequestedStop) {
        const startTime = Date.now();
        
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
          if (scrollAttempts > 0 && scrollAttempts % 10 === 0) {
            messagesPerAttempt = currentMessageCount / scrollAttempts;
            
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
            
            // EXTEND MAX RETRIES if we're still finding messages efficiently
            if (performanceScore > 1.0 && (scrollAttempts - lastProgressAttempt) < 20) {
              const extensionFactor = Math.min(2.0, performanceScore);
              const newMaxRetries = Math.floor(dynamicMaxRetries * extensionFactor);
              
              if (newMaxRetries > dynamicMaxRetries) {
                console.log(`🚀 EXTENDING max retries from ${dynamicMaxRetries} to ${newMaxRetries} (efficient: ${performanceScore.toFixed(2)})`);
                dynamicMaxRetries = newMaxRetries;
              }
            }
            
            // REDUCE MAX RETRIES if performance is consistently poor
            if (performanceScore < 0.7 && (scrollAttempts - lastProgressAttempt) > 15) {
              const reductionFactor = Math.max(0.7, performanceScore);
              const newMaxRetries = Math.floor(dynamicMaxRetries * reductionFactor);
              
              if (newMaxRetries < dynamicMaxRetries && newMaxRetries > scrollAttempts + 10) {
                console.log(`⚡ REDUCING max retries from ${dynamicMaxRetries} to ${newMaxRetries} (inefficient: ${performanceScore.toFixed(2)})`);
                dynamicMaxRetries = newMaxRetries;
              }
            }
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
        
        if (scrollAttempts > 0 && scrollAttempts % 3 === 0) {
          adaptStrategy();
        }
        
        // Update progress with dynamic information
        const dynamicProgressPercent = Math.min(85, (scrollAttempts / dynamicMaxRetries) * 80);
        const efficiencyInfo = scrollAttempts > 5 ? ` (${messagesPerAttempt.toFixed(1)} msg/attempt)` : '';
        
        chrome.runtime.sendMessage({
          type: "progress",
          percent: dynamicProgressPercent,
          current: currentMessageCount,
          total: currentMessageCount,
          status: `Loading messages... (${currentMessageCount} found, ${scrollAttempts}/${dynamicMaxRetries} attempts${efficiencyInfo})`,
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

        // ADDITIONAL: Extra wait for potential lazy loading after initial scroll methods
        if (aggressionLevel >= 3 && currentMessageCount > 500) {
          // Additional patience for large conversations that might have lazy loading
          const extraLazyWait = Math.min(
            currentMessageCount > 5000 ? 1500 : 
            currentMessageCount > 2000 ? 1200 : 
            currentMessageCount > 1000 ? 1000 : 500,
            2000 // Cap at 2 seconds
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
        
        // ENHANCED: Wait for lazy loading with dynamic timeout
        let lazyLoadWaitTime = 0;
        if (isLazyLoading) {
          // Calculate dynamic wait time based on conversation size
          if (currentMessageCount > 5000) {
            lazyLoadWaitTime = 4000; // 4 seconds for massive conversations
          } else if (currentMessageCount > 2000) {
            lazyLoadWaitTime = 3000; // 3 seconds for large conversations
          } else if (currentMessageCount > 1000) {
            lazyLoadWaitTime = 2500; // 2.5 seconds for medium conversations
          } else {
            lazyLoadWaitTime = 2000; // 2 seconds for smaller conversations
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
          lastProgressAttempt = scrollAttempts; // Track when we last made progress
          
          // Calculate message loading rate for adaptation
          messageLoadingRate = newMessages / (loadTime / 1000); // messages per second
          lastSuccessfulMethod = 'extractAndSave'; // Mark extraction as successful method
          
          // ENHANCED: Provide user feedback for massive conversations with better estimates
          if (currentMessageCount > 5000) {
            // For massive conversations, provide time estimates
            const messagesPerAttemptCurrent = currentMessageCount / scrollAttempts;
            const estimatedTotalAttempts = dynamicMaxRetries;
            const estimatedRemainingTime = (estimatedTotalAttempts - scrollAttempts) * (waitTime / 1000);
            const etaMinutes = Math.round(estimatedRemainingTime / 60);
            
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollAttempts / dynamicMaxRetries) * 80),
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading massive conversation... (${currentMessageCount} messages, ETA: ${etaMinutes}min, ${messagesPerAttemptCurrent.toFixed(1)} msg/attempt)`,
            });
          } else if (currentMessageCount > 2000) {
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollAttempts / dynamicMaxRetries) * 80),
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading large conversation... (${currentMessageCount} messages, ${scrollAttempts}/${dynamicMaxRetries} attempts)`,
            });
          } else if (currentMessageCount > 100 && scrollAttempts > 10) {
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollAttempts / dynamicMaxRetries) * 80),
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading conversation... (${currentMessageCount} messages, ${scrollAttempts} attempts)`,
            });
          }
          
          // Optimize for successful methods
          if (lastSuccessfulMethod) {
            efficientMethodsUsed.add(lastSuccessfulMethod);
          }
        } else {
          consecutiveNoChange++;
          noProgressStreak++;
        }

        // Update progress with adaptive calculation
        const progressPercent = Math.min(
          85,
          Math.max(
            (scrollAttempts / maxRetries) * 60 + (currentMessageCount / (currentMessageCount + 50)) * 25,
            (scrollAttempts / maxRetries) * 85
          )
        );
        updateProgress(progressPercent, currentMessageCount);

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
          
          // PRIORITY: If we can't scroll up anymore (stuck at top), but give extra time for lazy loading
          if (scrollingNotWorking && currentMessageCount > 0) {
            // For very long conversations, be extra patient with lazy loading
            if (currentMessageCount > 5000 && window.consecutiveAtTop < 8) {
              console.log("🏔️ Massive conversation - allowing more time for lazy loading");
              return false;
            }
            if (currentMessageCount > 2000 && window.consecutiveAtTop < 6) {
              console.log("🏔️ Large conversation - allowing more time for lazy loading");
              return false;
            }
            console.log("🔝 Can't scroll up anymore and no lazy loading, reached top of conversation");
            return true;
          }
          
          // ENHANCED: If we're at the top AND no new messages AND scroll not working AND no lazy loading, definitely done
          if (isAtTop && consecutiveNoChange >= 3 && scrollAttempts >= 5 && !scrollPositionChanged && !isLazyLoading) {
            console.log("🔝 At top with no progress, no scroll changes, and no lazy loading - conversation complete");
            return true;
          }
          
          // ENHANCED: Smart early detection for massive conversations (more patient with lazy loading)
          if (consecutiveNoChange >= 6 && currentMessageCount > 0 && !isLazyLoading) {
            // MASSIVE conversations (5k+ messages) - be very patient but still efficient
            if (currentMessageCount > 5000 && scrollAttempts >= 120 && consecutiveNoChange >= 15) {
              console.log("🏔️ Massive conversation (5k+) - stopping after extensive attempts");
              return true;
            }
            // VERY LARGE conversations (2k+ messages) - be patient
            if (currentMessageCount > 2000 && scrollAttempts >= 60 && consecutiveNoChange >= 12) {
              console.log("🏔️ Very large conversation (2k+) - stopping after many attempts");
              return true;
            }
            // LARGE conversations (1k+ messages) - moderate patience
            if (currentMessageCount > 1000 && scrollAttempts >= 40 && consecutiveNoChange >= 10) {
              console.log("🏔️ Large conversation (1k+) - stopping after reasonable attempts");
              return true;
            }
            // For small conversations (under 50 messages), be more aggressive about stopping
            if (currentMessageCount < 50 && scrollAttempts >= 8) {
              console.log("📝 Small conversation - stopping after sufficient attempts");
              return true;
            }
            // For medium conversations (50-200 messages), stop after more attempts
            if (currentMessageCount < 200 && scrollAttempts >= 15 && consecutiveNoChange >= 8) {
              console.log("📝 Medium conversation - stopping after extended attempts");
              return true;
            }
          }
          
          // ENHANCED: If scroll position isn't changing AND no new messages AND no lazy loading, we're stuck
          if (!scrollPositionChanged && consecutiveNoChange >= 5 && scrollAttempts >= 8 && !isLazyLoading) {
            console.log("🔒 Scroll position stuck, no new messages, and no lazy loading - likely complete");
            return true;
          }
          
          // ENHANCED: Dynamic patience for massive conversations (accounting for lazy loading delays)
          let dynamicPatience = Math.min(patienceLevel + 3, 15); // Default cap at 15, increased for lazy loading
          if (currentMessageCount > 5000) {
            dynamicPatience = 25; // Maximum patience for massive conversations (10k+)
          } else if (currentMessageCount > 2000) {
            dynamicPatience = 22; // Very high patience for very large conversations
          } else if (currentMessageCount > 1000) {
            dynamicPatience = 18; // High patience for large conversations
          } else if (currentMessageCount > 500) {
            dynamicPatience = 15; // Good patience for moderate conversations
          } else if (currentMessageCount > 200) {
            dynamicPatience = 12; // Medium patience for long conversations
          } else if (currentMessageCount > 100) {
            dynamicPatience = 10; // Medium patience for medium conversations
          } else {
            dynamicPatience = 6; // Lower patience for small conversations
          }
          
          // Basic patience exceeded (with dynamic patience)
          if (consecutiveNoChange >= dynamicPatience && !isLazyLoading) {
            console.log(`💤 Patience exhausted (${consecutiveNoChange}/${dynamicPatience}) and no lazy loading - stopping`);
            return true;
          }
          
          // ENHANCED: No progress for extended period suggests conversation is fully loaded
          const maxNoProgressStreak = Math.min(dynamicPatience * 2, currentMessageCount > 5000 ? 40 : 25);
          if (noProgressStreak >= maxNoProgressStreak && !isLazyLoading) {
            console.log(`📈 No progress streak too long (${noProgressStreak}/${maxNoProgressStreak}) and no lazy loading - stopping`);
            return true;
          }
          
          // Max attempts reached (now dynamic and performance-based)
          if (scrollAttempts >= dynamicMaxRetries) {
            console.log(`🏁 Reached dynamic max retries (${dynamicMaxRetries}) based on performance`);
            return true;
          }
          
          // PERFORMANCE-BASED: If efficiency is very low and we've tried enough, stop
          if (scrollAttempts >= 20 && performanceScore < 0.5 && (scrollAttempts - lastProgressAttempt) > 20) {
            console.log(`⚡ Very low efficiency (${performanceScore.toFixed(2)}) with no recent progress - stopping`);
            return true;
          }
          
          // SMART: If we've been scrolling a lot and message rate is very low, probably done (but not during lazy loading)
          if (scrollAttempts >= 15 && messageLoadingRate < 0.1 && consecutiveNoChange >= 5 && !isLazyLoading) {
            return true;
          }
          
          return false;
        };

        if (shouldStop()) {
          break;
        }

        scrollAttempts++;

        // ADAPTIVE special methods based on performance and aggression
        if (scrollAttempts % Math.max(2, 6 - aggressionLevel) === 0) {
         

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
        if (scrollAttempts % Math.max(3, 8 - aggressionLevel) === 0 && aggressionLevel >= 3) {
          
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
      

      return { finalCount, userRequestedStop };
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

        // Send completion message
        const exportStatus = wasStoppedByUser ? "stopped by user" : "completed automatically";
        chrome.runtime.sendMessage({
          type: "complete",
          totalMessages: totalMessages,
          filename: filename,
          participants: ["YOU", getConversationPartnerName() || "OTHER PERSON"],
          status: exportStatus,
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
