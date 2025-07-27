// background.js - Background export management service worker
console.log("Background service worker loaded");

// Global export state management
let exportState = {
  isRunning: false,
  tabId: null,
  currentMessages: 0,
  scrollAttempts: 0,
  progress: 0,
  status: 'idle',
  settings: null,
  startTime: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("BG received:", message);

  // Handle ping requests
  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return false;
  }

  // Handle export state requests from popup
  if (message.type === 'getExportState') {
    sendResponse({ exportState });
    return false;
  }

  // Handle start export from popup
  if (message.type === 'startBackgroundExport') {
    if (!exportState.isRunning) {
      exportState.isRunning = true;
      exportState.tabId = message.tabId;
      exportState.settings = message.settings;
      exportState.startTime = Date.now();
      exportState.status = 'starting';
      
      // Send start command to content script
      chrome.tabs.sendMessage(message.tabId, {
        type: 'startExport',
        settings: message.settings
      });
      
      console.log("Started background export on tab:", message.tabId);
    }
    sendResponse({ exportState });
    return false;
  }

  // Handle stop export from popup
  if (message.type === 'stopBackgroundExport') {
    if (exportState.isRunning && exportState.tabId) {
      // Send stop command to content script
      chrome.tabs.sendMessage(exportState.tabId, {
        type: 'stopExport'
      });
      
      exportState.status = 'stopping';
      console.log("Stopping background export");
    }
    sendResponse({ exportState });
    return false;
  }

  // Handle manual scroll request from popup
  if (message.type === 'manualScroll') {
    if (exportState.isRunning && exportState.tabId) {
      // Send manual scroll command to content script
      chrome.tabs.sendMessage(exportState.tabId, {
        type: 'manualScroll'
      });
    }
    sendResponse({ exportState });
    return false;
  }

  // Handle progress updates from content script
  if (message.type === 'progress') {
    // Update global state
    exportState.currentMessages = message.current || 0;
    exportState.scrollAttempts = message.scrollAttempts || 0;
    exportState.progress = message.percent || 0;
    exportState.status = message.status || 'running';
    
    // Forward progress updates to all popup instances
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward progress to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  // Handle export completion from content script
  if (message.type === 'exportComplete') {
    exportState.isRunning = false;
    exportState.status = 'completed';
    exportState.tabId = null;
    
    // Forward completion message to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward completion to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  // Handle export error from content script
  if (message.type === 'exportError') {
    exportState.isRunning = false;
    exportState.status = 'error';
    exportState.tabId = null;
    
    // Forward error message to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward error to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  // Handle export stopped from content script
  if (message.type === 'exportStopped') {
    exportState.isRunning = false;
    exportState.status = 'stopped';
    exportState.tabId = null;
    
    // Forward stopped message to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward stopped to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  try {
    // Always respond to avoid connection errors
    sendResponse({ received: true, timestamp: Date.now() });
  } catch (error) {
    console.log("Error sending response:", error);
  }

  return false;
});
