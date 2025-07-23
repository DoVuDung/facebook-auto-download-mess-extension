// FACEBOOK MESSAGE ELEMENT INSPECTOR
// Copy and paste this into console to see what the role="row" elements actually contain

console.log("=== FACEBOOK MESSAGE ELEMENT INSPECTOR ===");

// Find all role="row" elements
const rowElements = document.querySelectorAll('[role="row"]');
console.log(`Found ${rowElements.length} role="row" elements`);

if (rowElements.length > 0) {
    console.log("\n--- ANALYZING FIRST 5 ROLE=ROW ELEMENTS ---");
    
    for (let i = 0; i < Math.min(5, rowElements.length); i++) {
        const element = rowElements[i];
        console.log(`\n=== ELEMENT ${i + 1} ===`);
        console.log("Full text:", element.textContent.trim());
        console.log("HTML structure:", element.innerHTML.substring(0, 200) + "...");
        
        // Check for strong elements (potential senders)
        const strongElements = element.querySelectorAll('strong');
        console.log("Strong elements found:", strongElements.length);
        if (strongElements.length > 0) {
            strongElements.forEach((strong, idx) => {
                console.log(`  Strong ${idx + 1}: "${strong.textContent.trim()}"`);
            });
        }
        
        // Check for divs with text
        const divs = element.querySelectorAll('div');
        console.log("Div elements found:", divs.length);
        let textDivs = [];
        divs.forEach((div, idx) => {
            const text = div.textContent.trim();
            if (text && text.length > 5 && text.length < 200) {
                textDivs.push({index: idx, text: text.substring(0, 50)});
            }
        });
        console.log("Text-containing divs:", textDivs);
        
        // Check for dir="auto" elements
        const dirAutoElements = element.querySelectorAll('[dir="auto"]');
        console.log("dir=auto elements:", dirAutoElements.length);
        if (dirAutoElements.length > 0) {
            dirAutoElements.forEach((auto, idx) => {
                console.log(`  dir=auto ${idx + 1}: "${auto.textContent.trim().substring(0, 50)}"`);
            });
        }
    }
}

console.log("\n=== COPY THIS OUTPUT AND SHARE IT ===");
