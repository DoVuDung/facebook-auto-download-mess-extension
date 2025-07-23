// Test detailed message extraction
console.log('Testing detailed message extraction...');

// Test the new extraction logic
function testDetailedExtraction() {
  // Find all potential message elements
  const roleRows = document.querySelectorAll('[role="row"]');
  console.log(`Found ${roleRows.length} role="row" elements for detailed analysis`);
  
  for (let i = 0; i < Math.min(roleRows.length, 10); i++) {
    const element = roleRows[i];
    console.log(`\n=== Testing element ${i + 1} ===`);
    
    // Get basic info
    const text = element.textContent?.trim() || '';
    const dirAutoElements = element.querySelectorAll('div[dir="auto"], span[dir="auto"]');
    
    console.log(`Text preview: "${text.substring(0, 100)}..."`);
    console.log(`Dir="auto" elements: ${dirAutoElements.length}`);
    
    // Check for visual alignment
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const isRightAligned = rect.right > window.innerWidth * 0.6;
    const isLeftAligned = rect.left < window.innerWidth * 0.4;
    
    console.log(`Position: left=${rect.left.toFixed(1)}, right=${rect.right.toFixed(1)}, width=${rect.width.toFixed(1)}`);
    console.log(`Alignment: ${isRightAligned ? 'RIGHT' : isLeftAligned ? 'LEFT' : 'CENTER'}`);
    
    // Try to identify content
    if (dirAutoElements.length > 0) {
      dirAutoElements.forEach((dirEl, idx) => {
        const dirText = dirEl.textContent.trim();
        console.log(`  Dir[${idx}]: "${dirText}"`);
      });
    }
    
    // Check for special elements
    const hasImage = element.querySelector('img') ? 'YES' : 'NO';
    const hasLink = element.querySelector('a[href]') ? 'YES' : 'NO';
    const hasTime = element.querySelector('[aria-label*="time"], [data-testid*="time"]') ? 'YES' : 'NO';
    
    console.log(`Special elements: Image=${hasImage}, Link=${hasLink}, Time=${hasTime}`);
  }
}

// Run the test
testDetailedExtraction();
