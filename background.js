// Background script for handling streaming downloads
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "streamingSave") {
    // Handle streaming save downloads
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: false // Auto-save without prompting
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Streaming download error:", chrome.runtime.lastError);
      } else {
        console.log(`📦 Streaming save completed: ${message.filename} (${message.messageCount} messages)`);
        
        // Send confirmation back to content script
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "streamingSaveComplete",
          filename: message.filename,
          messageCount: message.messageCount,
          totalSaved: message.totalSaved
        }).catch(() => {
          // Ignore errors if content script is no longer available
        });
        
        // Clean up the blob URL after a delay
        setTimeout(() => {
          URL.revokeObjectURL(message.url);
        }, 5000);
      }
    });
    
    // Return true to indicate we'll respond asynchronously
    return true;
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Facebook Messenger Exporter background script started");
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Facebook Messenger Exporter installed/updated");
});
