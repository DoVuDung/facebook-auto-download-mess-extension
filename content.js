// Content script for Facebook Messenger Chat Exporter
// This script runs on Facebook Messenger pages

console.log('Messenger Chat Exporter content script loaded');

// Add visual indicator when extension is active
function addExportIndicator() {
  // Remove existing indicator
  const existing = document.getElementById('messenger-exporter-indicator');
  if (existing) existing.remove();
  
  // Create new indicator
  const indicator = document.createElement('div');
  indicator.id = 'messenger-exporter-indicator';
  indicator.innerHTML = 'Chat Exporter Ready';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: #1877f2;
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  `;
  
  document.body.appendChild(indicator);
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    if (indicator && indicator.parentNode) {
      indicator.style.opacity = '0';
      indicator.style.transition = 'opacity 0.5s';
      setTimeout(() => indicator.remove(), 500);
    }
  }, 3000);
}

// Show indicator when content script loads
if (window.location.href.includes('/messages') || window.location.href.includes('/t/')) {
  addExportIndicator();
}

// Listen for URL changes (Facebook is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (url.includes('/messages') || url.includes('/t/')) {
      setTimeout(addExportIndicator, 1000); // Delay to ensure page is loaded
    }
  }
}).observe(document, { subtree: true, childList: true });

// Utility functions
window.messengerExporter = {
  // Check if we're on a valid Messenger page
  isValidPage() {
    return window.location.href.includes('/messages') || window.location.href.includes('/t/');
  },
  
  // Get conversation name/title
  getConversationTitle() {
    const selectors = [
      'h1[dir="auto"]',
      '[data-testid="conversation_name"]',
      'div[role="banner"] h1',
      'span[dir="auto"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }
    
    return 'unknown_conversation';
  },
  
  // Show export status to user
  showStatus(message, type = 'info') {
    // Remove existing status
    const existing = document.getElementById('messenger-exporter-status');
    if (existing) existing.remove();
    
    // Create status element
    const status = document.createElement('div');
    status.id = 'messenger-exporter-status';
    status.textContent = message;
    
    const colors = {
      info: '#1877f2',
      success: '#00a400',
      error: '#e41e3f',
      warning: '#ff8c00'
    };
    
    status.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: ${colors[type] || colors.info};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      max-width: 300px;
      text-align: center;
    `;
    
    document.body.appendChild(status);
    
    // Auto-remove after delay
    setTimeout(() => {
      if (status && status.parentNode) {
        status.style.opacity = '0';
        status.style.transition = 'opacity 0.5s';
        setTimeout(() => status.remove(), 500);
      }
    }, type === 'error' ? 5000 : 3000);
  }
};

console.log('Messenger Chat Exporter ready');
