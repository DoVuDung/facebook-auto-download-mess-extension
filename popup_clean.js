let isExporting = false;
let currentTab = null;

// DOM elements - Updated interface
const statusDiv = document.getElementById("status");
const startExportBtn = document.getElementById("startExport");
const stopExportBtn = document.getElementById("stopExport");
const initialControls = document.getElementById("initialControls");
const runningInterface = document.getElementById("runningInterface");

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

// Update messages count (removed - no longer needed)
function updateMessagesCount(count) {
  // Message count removed - no longer needed
}

// Check if background script is available
async function checkBackgroundAvailable() {
  try {
    const check = await chrome.runtime.sendMessage({ action: 'ping' });
    if (!check?.alive) throw new Error('Dead listener');
    return true;
  } catch (e) {
    console.warn("🛑 Background not listening");
    return false;
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
  showRunningInterface();
  showStatus("Starting background export...", "info");

  const settings = {
    includeDates: true,
    includeTimestamps: true,
    clearDOM: true,
    delayMin: parseInt(delayMinInput.value) || 1000,
    delayMax: parseInt(delayMaxInput.value) || 5000,
  };

  try {
    // Send start export message to background script
    const response = await chrome.runtime.sendMessage({
      action: 'startExport',
      tabId: currentTab.id,
      settings: settings
    });

    if (response && response.success) {
      showStatus("Export running in background. You can close this popup.", "success");
    } else {
      throw new Error("Failed to start background export");
    }

  } catch (error) {
    showStatus("Export failed: " + error.message, "error");
    console.error("Export error:", error);
    resetUI();
  }
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
  console.log("🎯 Popup loaded - clean version");
  
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
    }
  } catch (error) {
    console.log("Could not check export status:", error);
  }
});
