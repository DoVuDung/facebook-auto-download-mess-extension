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
                
                // SIMPLIFIED duplicate check - only exact matches
                let isDuplicate = false;
                for (const [key, existingMsg] of messageMap.entries()) {
                  if (existingMsg.content === messageData.content && 
                      existingMsg.sender === messageData.sender) {
                    isDuplicate = true;
                    break;
                  }
                }

                if (!isDuplicate) {
                  // Add to Map with proper ordering
                  messageData.mapIndex = messageIndex++;
                  messageData.elementId = elementId;
                  messageData.chronoOrder = messageIndex; // Add chronological order marker
                  messageMap.set(messageKey, messageData);
                  processedElementIds.add(elementId);
                  validMessages++;
                  newMessagesFound++;

                  if (validMessages % 25 === 0) {
                    console.log(`📝 Valid messages in Map: ${messageMap.size}...`);
                  }

                  // Debug: log first few messages to see what we're getting
                  if (messageMap.size <= 10) {
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
              messageData.chronoOrder = messageIndex; // Add chronological order marker
              
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
      
      // STEP 1: SAVE INITIAL VIEW TO MAP BEFORE SCROLLING
      const initialSave = extractAndSaveMessagesToMap(true);
      currentMessageCount = initialSave.totalInMap;
      previousMessageCount = currentMessageCount;
      
      
      if (!initialSave.container) {
        return { finalCount: currentMessageCount, userRequestedStop };
      }
      
      const conversationDetailContainer = initialSave.container;

      // DYNAMIC parameters based on content - FULLY ADAPTIVE
      let maxRetries = 30; // Start conservative, will scale dynamically
      let waitTime = 1500; // Start fast, will adapt based on loading performance
      let patienceLevel = 3; // Start impatient, increase as needed
      let aggressionLevel = 1; // Scale 1-5: how aggressive scrolling methods should be
      
      // Content analysis tracking for REAL-TIME adaptation
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

      // Skip container finding since we already have it from initial save

      const containerRect = conversationDetailContainer.getBoundingClientRect();
      

      // Initial count from Map (not DOM count)
      
      // DYNAMIC ASSESSMENT: Real-time analysis to determine optimal strategy
      const initialContentAnalysis = () => {
        const messageElements = conversationDetailContainer.querySelectorAll('div[role="row"]');
        const containerHeight = conversationDetailContainer.getBoundingClientRect().height;
        const avgMessageHeight = containerHeight / Math.max(messageElements.length, 1);
        
        contentDensity = messageMap.size / Math.max(scrollAttempts, 1);
        
        if (currentMessageCount > 500) {
          isLongConversation = true;
          aggressionLevel = 4; // High aggression for massive conversations
        } else if (currentMessageCount > 200) {
          isLongConversation = true;
          aggressionLevel = 4; // High aggression for very long conversations - INCREASED
        } else if (currentMessageCount > 100) {
          isLongConversation = true;
          aggressionLevel = 3; // Medium aggression for long conversations - INCREASED  
        } else if (currentMessageCount > 30) {
          aggressionLevel = 4; // Higher aggression for medium conversations
        } else {
          aggressionLevel = 5; // Maximum aggression for short conversations
        }
        
        // Adjust base parameters based on initial assessment - ENHANCED for long conversations with REASONABLE limits
        if (currentMessageCount > 500) {
          maxRetries = Math.floor(Math.max(40, Math.min(100, currentMessageCount * 0.8))); // Reduced from 300
        } else if (currentMessageCount > 200) {
          maxRetries = Math.floor(Math.max(30, Math.min(80, currentMessageCount * 0.6))); // Reduced from 250
        } else if (currentMessageCount > 100) {
          maxRetries = Math.floor(Math.max(20, Math.min(50, currentMessageCount * 0.4))); // Reduced significantly
        } else if (currentMessageCount > 50) {
          maxRetries = Math.floor(Math.max(15, Math.min(30, currentMessageCount * 0.3))); // Much more reasonable
        } else {
          maxRetries = Math.floor(Math.max(8, Math.min(20, currentMessageCount * 0.4 + 5))); // Much lower for small conversations
        }
        
        // OPTIMIZED wait time for short conversations
        if (currentMessageCount < 30) {
          waitTime = 600; // Faster for very short conversations
        } else if (currentMessageCount < 100) {
          waitTime = 1000; // Moderately fast for medium conversations
        } else {
          waitTime = Math.max(800, 2500 - (aggressionLevel * 300)); // Standard for long conversations
        }
        
        // OPTIMIZED patience levels - much more reasonable
        if (currentMessageCount < 30) {
          patienceLevel = 3; // Lower patience for very short conversations
        } else if (currentMessageCount < 100) {
          patienceLevel = 4; // Moderate patience for medium conversations  
        } else if (currentMessageCount < 200) {
          patienceLevel = 6; // Higher patience for long conversations
        } else {
          patienceLevel = 8; // Highest patience for very long conversations (capped at 8)
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

      while (scrollAttempts < maxRetries && !userRequestedStop) {
        const startTime = Date.now();
        
        // REAL-TIME ADAPTATION: Adjust strategy based on recent performance
        const adaptStrategy = () => {
          const recentHistory = loadingHistory.slice(-5); // Last 5 attempts
          const recentSuccess = recentHistory.filter(h => h.newMessages > 0).length;
          const avgRecentLoadTime = recentHistory.reduce((sum, h) => sum + h.loadTime, 0) / Math.max(recentHistory.length, 1);
          
          // Detect slow loading and adapt
          if (avgRecentLoadTime > waitTime * 1.5) {
            slowLoadingDetected = true;
            waitTime = Math.min(waitTime * 1.2, 5000); // Increase wait time but cap it
          }
          
          // Increase aggression if no recent success
          if (recentSuccess === 0 && recentHistory.length >= 3) {
            aggressionLevel = Math.min(aggressionLevel + 1, 5);
            adaptiveScrollIntensity = aggressionLevel;
          }
          
          // Decrease aggression if consistently successful
          if (recentSuccess >= 4 && aggressionLevel > 1) {
            aggressionLevel = Math.max(aggressionLevel - 1, 1);
            adaptiveScrollIntensity = aggressionLevel;
            waitTime = Math.max(waitTime * 0.9, 800); // Reduce wait time
          }
          
          // Dynamic patience adjustment
          if (consecutiveNoChange > patienceLevel / 2) {
            patienceLevel = Math.min(patienceLevel + 2, 15);
          }
        };
        
        if (scrollAttempts > 0 && scrollAttempts % 3 === 0) {
          adaptStrategy();
        }
        
        // Update progress with scrolling status
        chrome.runtime.sendMessage({
          type: "progress",
          percent: Math.min(80, (scrollAttempts / maxRetries) * 80),
          current: currentMessageCount,
          total: currentMessageCount,
          status: `Loading messages... (${currentMessageCount} found, attempt ${scrollAttempts + 1}/${maxRetries})`,
        });

        // === DYNAMIC MULTI-METHOD SCROLLING - Intensity based on aggression level ===

        // Method 1: Dynamic container scrolling with adaptive intensity
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
          if (aggressionLevel >= 2 && conversationDetailContainer.scrollTo) {
            conversationDetailContainer.scrollTo({ top: 0, behavior: "auto" });
            await sleep(50 * aggressionLevel); // More wait time for higher aggression
            conversationDetailContainer.scrollTo({
              top: 0,
              behavior: "smooth",
            });
            await sleep(75 * aggressionLevel);
          }

          // Parent container scrolling - scale with aggression
          if (aggressionLevel >= 3) {
            let parent = conversationDetailContainer.parentElement;
            let parentLevel = 0;
            const maxParentLevels = Math.min(aggressionLevel * 2, 10);
            
            while (parent && parent !== document.body && parentLevel < maxParentLevels) {
              const parentRect = parent.getBoundingClientRect();
              if (parentRect.left > window.innerWidth * 0.1) {
                if (parent.scrollTo) {
                  parent.scrollTo({ top: 0, behavior: "instant" });
                  await sleep(10 * aggressionLevel);
                }
                parent.scrollTop = 0;
              }
              parent = parent.parentElement;
              parentLevel++;
            }
          }
        }

        // Method 2: Dynamic window scrolling - scale with aggression
        if (aggressionLevel >= 2) {
          window.scrollTo({ top: 0, behavior: "instant" });
          await sleep(25 * aggressionLevel);
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }

        // Method 3: Dynamic focus and keyboard navigation
        if (aggressionLevel >= 3 && conversationDetailContainer) {
          if (conversationDetailContainer.focus) {
            conversationDetailContainer.focus();
          }

          const focusableElements =
            conversationDetailContainer.querySelectorAll(
              'input, textarea, [tabindex], [contenteditable], button, [role="textbox"]'
            );

          const elementsToFocus = Math.min(focusableElements.length, aggressionLevel);
          for (let i = 0; i < elementsToFocus; i++) {
            const element = focusableElements[i];
            if (element && element.focus) {
              element.focus();
              await sleep(25 * aggressionLevel);
              if (i === 0) break; // Only focus first element unless max aggression
            }
          }
        }

        // Method 4: Adaptive keyboard events - scale with aggression
        if (aggressionLevel >= 2) {
          const keyEvents = [
            { key: "Home", ctrlKey: true },
            { key: "PageUp", ctrlKey: true },
          ];
          
          if (aggressionLevel >= 4) {
            keyEvents.push(
              { key: "PageUp", ctrlKey: false },
              { key: "ArrowUp", ctrlKey: true }
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
            await sleep(25 * aggressionLevel);

            targetElement.dispatchEvent(
              new KeyboardEvent("keyup", {
                ...keyEvent,
                bubbles: true,
                cancelable: true,
              })
            );
            await sleep(15 * aggressionLevel);
          }
        }

        // Method 5: Dynamic Page Up simulation - intensity based on aggression
        if (aggressionLevel >= 3) {
          const pageUpCount = Math.min(aggressionLevel * 3, 20);
          const targetElement = conversationDetailContainer || document.body;
          
          for (let i = 0; i < pageUpCount; i++) {
            targetElement.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "PageUp",
                bubbles: true,
                cancelable: true,
              })
            );
            await sleep(25 * aggressionLevel);

            if (aggressionLevel >= 4) {
              targetElement.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "PageUp",
                  ctrlKey: true,
                  bubbles: true,
                  cancelable: true,
                })
              );
              await sleep(25 * aggressionLevel);
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

        // PROGRESSIVE MAP-BASED extraction: Save current view to Map
        const progressiveSave = extractAndSaveMessagesToMap(false);
        const newMessageCount = progressiveSave.totalInMap;
        const newMessages = newMessageCount - currentMessageCount;
        const loadTime = Date.now() - startTime;

        // ENHANCED: Check if we're at the top of the conversation (scroll position unchanged)
        const currentScrollTop = conversationDetailContainer ? conversationDetailContainer.scrollTop : window.pageYOffset;
        const isAtTop = currentScrollTop <= 10; // Within 10px of top
        
        // Track scroll position consistency 
        if (!window.lastScrollTop) window.lastScrollTop = currentScrollTop;
        const scrollPositionChanged = Math.abs(currentScrollTop - window.lastScrollTop) > 5;
        window.lastScrollTop = currentScrollTop;

        // Track loading performance for adaptation
        loadingHistory.push({
          attempt: scrollAttempts,
          newMessages: newMessages,
          loadTime: loadTime,
          aggressionLevel: aggressionLevel,
          method: lastSuccessfulMethod || 'unknown'
        });

        // Keep only recent history for adaptation
        if (loadingHistory.length > 10) {
          loadingHistory = loadingHistory.slice(-10);
        }

        // Enhanced loading detection
        const loadingIndicators = document.querySelectorAll(
          '[aria-label*="Loading"], [aria-label*="loading"], .loading, [data-testid*="loading"]'
        );
        const isStillLoading = loadingIndicators.length > 0;

        if (isStillLoading) {
          console.log("⏳ Page still loading, extending patience...");
          consecutiveNoChange = Math.max(0, consecutiveNoChange - 1);
        }

        if (newMessageCount > currentMessageCount) {
          consecutiveNoChange = 0;
          currentMessageCount = newMessageCount;
          noProgressStreak = 0;
          
          // Calculate message loading rate for adaptation
          messageLoadingRate = newMessages / (loadTime / 1000); // messages per second
          
          // Provide user feedback for long conversations
          if (currentMessageCount > 100 && scrollAttempts > 10) {
            chrome.runtime.sendMessage({
              type: "progress",
              percent: Math.min(80, (scrollAttempts / maxRetries) * 80),
              current: currentMessageCount,
              total: currentMessageCount,
              status: `Loading long conversation... (${currentMessageCount} messages found, ${scrollAttempts} attempts)`,
            });
          }
          
          // Optimize for successful methods
          if (lastSuccessfulMethod) {
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

        // ENHANCED stopping condition with SMART early detection
        const shouldStop = () => {
          // User requested stop
          if (userRequestedStop) {
            return true;
          }
          
          // SMART EARLY DETECTION: If no new messages for multiple consecutive attempts, likely at end
          if (consecutiveNoChange >= 4 && currentMessageCount > 0) {
            // For small conversations (under 50 messages), be more aggressive about stopping
            if (currentMessageCount < 50 && scrollAttempts >= 6) {
              return true;
            }
            // For medium conversations (50-200 messages), stop after more attempts
            if (currentMessageCount < 200 && scrollAttempts >= 10 && consecutiveNoChange >= 6) {
              return true;
            }
          }
          
          // ENHANCED: If we're at the top AND no new messages, we're likely done
          if (isAtTop && consecutiveNoChange >= 3 && scrollAttempts >= 3) {
            return true;
          }
          
          // ENHANCED: If scroll position isn't changing AND no new messages, we're stuck
          if (!scrollPositionChanged && consecutiveNoChange >= 2 && scrollAttempts >= 4) {
            return true;
          }
          
          // DYNAMIC patience based on conversation length - but more reasonable
          let dynamicPatience = Math.min(patienceLevel + 2, 12); // Cap at 12 for any conversation
          if (currentMessageCount > 500) {
            dynamicPatience = 15; // Still patient for massive conversations but capped
          } else if (currentMessageCount > 200) {
            dynamicPatience = 12; // More patient for long conversations
          } else if (currentMessageCount > 100) {
            dynamicPatience = 8; // Medium patience for medium conversations
          } else {
            dynamicPatience = 5; // Low patience for small conversations
          }
          
          // Basic patience exceeded (with dynamic patience)
          if (consecutiveNoChange >= dynamicPatience) {
            return true;
          }
          
          // ENHANCED: No progress for extended period suggests conversation is fully loaded
          if (noProgressStreak >= Math.min(dynamicPatience * 2, 20)) {
            return true;
          }
          
          // Max attempts reached (now much more reasonable)
          if (scrollAttempts >= maxRetries) {
            return true;
          }
          
          // SMART: If we've been scrolling a lot and message rate is very low, probably done
          if (scrollAttempts >= 8 && messageLoadingRate < 0.1 && consecutiveNoChange >= 3) {
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

        // Since scrolling up collects newest messages first, we need to reverse the chronological order
        // to get the proper Facebook-like ordering (oldest to newest)
        let globalIndex = 0;
        const reversedMessages = Array.from(messageMap.values()).reverse(); // Reverse to get oldest first
        
        // Reassign chronoOrder to ensure proper ordering
        for (const msg of reversedMessages) {
          msg.chronoOrder = globalIndex++;
        }
        
        // Now sort by the corrected chronoOrder
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

        // Sort messages chronologically to maintain Facebook's original order (oldest first)
        // Since we scroll up (newest to oldest), we need to reverse to get proper chronological order
        const sortedMessages = messages.sort((a, b) => {
          // Primary sort: use chronoOrder if available, fallback to mapIndex, then index
          const aOrder = a.chronoOrder || a.mapIndex || a.index || 0;
          const bOrder = b.chronoOrder || b.mapIndex || b.index || 0;
          return aOrder - bOrder;
        });

        // Remove any remaining duplicates based on content and sender with enhanced detection
        const uniqueMessages = [];
        const seenMessages = new Set();
        const seenExactContent = new Set();

        for (const msg of sortedMessages) {
          if (msg.type === "message") {
            const messageKey = `${msg.sender}:${msg.content}`;
            const contentOnly = msg.content.toLowerCase().trim();

            // Skip if exact same message key or very similar content
            if (
              !seenMessages.has(messageKey) &&
              !seenExactContent.has(contentOnly)
            ) {
              // Check for very similar messages from same sender
              let isSimilarDuplicate = false;

              for (const existingContent of seenExactContent) {
                if (contentOnly.length > 10 && existingContent.length > 10) {
                  const similarity = calculateSimilarity(
                    contentOnly,
                    existingContent
                  );
                  if (similarity > 0.85) {
                    // 85% similar threshold
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
                
              }
            } else {
              // 
            }
          } else {
            // Always include date headers
            uniqueMessages.push(msg);
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
