// background.js - Simple service worker
console.log("Background service worker loaded");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("BG received:", message);

  // Handle ping requests
  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return false;
  }

  // Handle progress updates from content script
  if (message.type === 'progress') {
    // Forward progress updates to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward progress to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  // Handle export completion
  if (message.type === 'exportComplete') {
    // Forward completion message to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward completion to popup:", error);
    }
    sendResponse({ received: true });
    return false;
  }

  // Handle export error
  if (message.type === 'exportError') {
    // Forward error message to popup if it's open
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      console.log("Could not forward error to popup:", error);
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
