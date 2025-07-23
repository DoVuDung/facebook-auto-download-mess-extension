// DATE FINDER SCRIPT - Copy and paste this into Facebook console
console.log("=== FACEBOOK DATE FINDER ===");

// Look for any text that might be dates
const allElements = document.querySelectorAll('*');
const datePatterns = [];

for (const el of allElements) {
    const text = el.textContent?.trim();
    if (text && text.length < 100) {
        // Check for date-like patterns
        if (text.match(/\d{1,2}:\d{2}\s*(AM|PM)|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i)) {
            datePatterns.push({
                text: text,
                tagName: el.tagName,
                className: el.className,
                role: el.getAttribute('role'),
                ariaLabel: el.getAttribute('aria-label')
            });
        }
    }
}

console.log("Found potential date elements:", datePatterns.slice(0, 10));

// Specifically look for role="row" elements with date-like content
const rowElements = document.querySelectorAll('[role="row"]');
console.log("\nChecking role=row elements for dates:");

for (let i = 0; i < Math.min(10, rowElements.length); i++) {
    const text = rowElements[i].textContent?.trim();
    if (text && (text.includes('AM') || text.includes('PM') || text.includes('Today') || text.includes('Yesterday'))) {
        console.log(`Row ${i}: "${text}"`);
    }
}

console.log("\nCopy this output to help find date patterns!");
