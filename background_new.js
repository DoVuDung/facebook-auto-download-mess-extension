// background.js
let exportState = {
  isRunning: false,
  tabId: null,
  settings: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("✅ BG received:", message);

  // Handle ping requests
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
        console.log("🚀 Starting fresh background export");
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
  }
}

// Simplified background export function
function exportMessagesBackground(settings) {
  console.log("🚀 Background export started with settings:", settings);
  
  // Simple message extraction and sending to localhost
  function sendToServer(text) {
    fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(text))
      .then((res) => res.text())
      .then((response) => console.log("✅ Sent:", response))
      .catch((err) => console.error("❌ Failed:", err));
  }

  // Send header
  sendToServer(`Facebook Messenger Export - ${new Date().toLocaleString()}`);
  sendToServer("=" + "=".repeat(50));
  
  // Start the extraction process
  performBackgroundExtraction(settings);
}

function performBackgroundExtraction(settings) {
  let extractionCount = 0;
  const maxAttempts = 100;
  let attempt = 0;
  
  function extractCurrentView() {
    const messageElements = document.querySelectorAll('div[role="row"]');
    console.log(`🔍 Found ${messageElements.length} message elements`);
    
    messageElements.forEach((element, index) => {
      const text = element.textContent?.trim();
      if (text && text.length > 5) {
        // Simple extraction - just send the text
        const line = `Message ${extractionCount++}: ${text}`;
        fetch("http://127.0.0.1:3010/saveTxt.js?txt=" + encodeURIComponent(line))
          .catch(err => console.error("Send failed:", err));
      }
    });
  }
  
  function scrollAndExtract() {
    if (attempt >= maxAttempts) {
      console.log("🏁 Background extraction completed");
      return;
    }
    
    attempt++;
    extractCurrentView();
    
    // Scroll up to load more messages
    window.scrollTo(0, 0);
    
    // Random delay between scrolls
    const delay = Math.random() * (settings.delayMax - settings.delayMin) + settings.delayMin;
    setTimeout(scrollAndExtract, delay);
  }
  
  // Start the process
  scrollAndExtract();
}
