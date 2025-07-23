// FACEBOOK MESSENGER DEBUG SCRIPT
// Copy and paste this into browser console on messenger.com to diagnose issues

console.log("=== FACEBOOK MESSENGER DEBUG TOOL ===");
console.log("Current URL:", window.location.href);
console.log("Page title:", document.title);

// Test 1: Check if we're on the right page
console.log("\n--- TEST 1: PAGE CHECK ---");
const isMessenger = window.location.href.includes('messenger.com') || window.location.href.includes('facebook.com/messages');
const hasConversation = window.location.href.includes('/t/');
console.log("Is Messenger page:", isMessenger);
console.log("Has conversation ID:", hasConversation);
console.log("URL should be: messenger.com/t/[conversation-id]");

// Test 2: Look for message containers
console.log("\n--- TEST 2: CONTAINER SEARCH ---");
const containers = [
    '[aria-label="Message list"]',
    '[aria-label="Messages"]',
    '[role="log"]',
    '[data-testid="conversation-viewer"]',
    '[data-testid="message-container"]',
    'div[style*="overflow"]',
    '[data-pagelet="MessengerDotCom"]'
];

let foundContainer = null;
for (const selector of containers) {
    const element = document.querySelector(selector);
    if (element) {
        console.log("FOUND container:", selector);
        foundContainer = element;
        break;
    } else {
        console.log("❌ No container:", selector);
    }
}

if (!foundContainer) {
    console.log("🚨 NO CONTAINERS FOUND! Facebook may have changed layout.");
    
    // Fallback: look for divs with many children
    console.log("\n--- FALLBACK: LOOKING FOR MESSAGE PATTERNS ---");
    const allDivs = document.querySelectorAll('div');
    console.log("Total divs on page:", allDivs.length);
    
    for (const div of allDivs) {
        const children = div.querySelectorAll('div[dir="auto"], [role="row"]');
        if (children.length > 10) {
            console.log("Potential container with", children.length, "message-like elements");
            foundContainer = div;
            break;
        }
    }
}

// Test 3: Look for message elements
if (foundContainer) {
    console.log("\n--- TEST 3: MESSAGE SEARCH ---");
    const messageSelectors = [
        'div[role="row"]',
        'div[data-testid*="message"]',
        'div[dir="auto"]',
        '[data-testid="message_bubble"]'
    ];
    
    for (const selector of messageSelectors) {
        const messages = foundContainer.querySelectorAll(selector);
        console.log(`Selector "${selector}":`, messages.length, "elements");
        if (messages.length > 0) {
            console.log("Sample element:", messages[0]);
            break;
        }
    }
}

// Test 4: Basic element counts
console.log("\n--- TEST 4: ELEMENT COUNTS ---");
console.log("Total divs:", document.querySelectorAll('div').length);
console.log("Divs with dir=auto:", document.querySelectorAll('div[dir="auto"]').length);
console.log("Elements with role=row:", document.querySelectorAll('[role="row"]').length);
console.log("Elements with 'message' in aria-label:", document.querySelectorAll('[aria-label*="message" i]').length);

// Test 5: Sample message text
console.log("\n--- TEST 5: SAMPLE TEXT ---");
const textElements = document.querySelectorAll('div[dir="auto"]');
if (textElements.length > 0) {
    console.log("Sample text elements:");
    for (let i = 0; i < Math.min(5, textElements.length); i++) {
        const text = textElements[i].textContent.trim();
        if (text && text.length > 10 && text.length < 100) {
            console.log(`  "${text}"`);
        }
    }
}

console.log("\n=== DIAGNOSIS COMPLETE ===");
console.log("COPY THIS ENTIRE OUTPUT AND SHARE IT!");
