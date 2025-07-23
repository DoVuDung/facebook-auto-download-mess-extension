#!/bin/bash

echo "🚀 Creating Complete Distribution Package"
echo "========================================"
echo ""

# Create a complete distribution folder
DIST_DIR="facebook-messenger-exporter-distribution"
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')

# Clean and create distribution directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Building distribution package v$VERSION..."

# Copy the built extension
cp -r dist/facebook-messenger-exporter "$DIST_DIR/"
cp dist/facebook-messenger-exporter-v1.0.zip "$DIST_DIR/" 2>/dev/null || cp dist/facebook-messenger-exporter-v*.zip "$DIST_DIR/" 2>/dev/null || echo "No ZIP file found"
cp dist/facebook-messenger-exporter-v1.0.zip "$DIST_DIR/" 2>/dev/null || cp dist/facebook-messenger-exporter-v*.zip "$DIST_DIR/" 2>/dev/null || echo "No ZIP file found"
cp dist/index.html "$DIST_DIR/" 2>/dev/null || echo "Creating new index.html"

# Create index.html if it doesn't exist
if [ ! -f "$DIST_DIR/index.html" ]; then
    cat > "$DIST_DIR/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Facebook Messenger Chat Exporter - Installation Guide</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .header { background: #1877f2; color: white; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 30px; }
        .download { background: #e8f5e8; border: 2px solid #4caf50; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
        .download a { background: #4caf50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .step { margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #1877f2; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📱 Facebook Messenger Chat Exporter v1.0</h1>
        <p>Export your Facebook conversations to text files with one click</p>
    </div>
    
    <div class="download">
        <h2>🚀 Ready to Install</h2>
        <p>Download the extension and follow the installation steps below</p>
        <a href="facebook-messenger-exporter-v1.0.zip" download>Download Extension v1.0</a>
    </div>
    
    <h2>Installation Steps</h2>
    
    <div class="step">
        <h3>1. Download & Extract</h3>
        <p>Click the download button above to get the extension ZIP file. Extract it to a folder you can remember.</p>
    </div>
    
    <div class="step">
        <h3>2. Open Chrome Extensions</h3>
        <p>In Google Chrome, type <code>chrome://extensions/</code> in the address bar.</p>
    </div>
    
    <div class="step">
        <h3>3. Enable Developer Mode</h3>
        <p>Turn ON "Developer mode" (toggle in top-right corner).</p>
    </div>
    
    <div class="step">
        <h3>4. Load the Extension</h3>
        <p>Click "Load unpacked" button, then select the extracted extension folder.</p>
    </div>
    
    <div class="step">
        <h3>5. Pin to Toolbar</h3>
        <p>Click the puzzle piece icon in Chrome's toolbar and pin the extension for easy access.</p>
    </div>
    
    <h2>🎯 How to Use</h2>
    <p>1. Go to Facebook Messenger (messenger.com or facebook.com/messages)</p>
    <p>2. Open any conversation you want to export</p>
    <p>3. Click the extension icon in your toolbar</p>
    <p>4. Click "Start Export" and wait for it to complete</p>
    <p>5. Your messages will download as a text file!</p>
    
    <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <strong>Features:</strong> Scrolls backwards through entire conversation • Includes sender names • Preserves timestamps • Prevents crashes with DOM cleanup • Works locally (no data sent anywhere)
    </div>
</body>
</html>
EOF
fi

# Create a quick start guide
cat > "$DIST_DIR/QUICK_START.txt" << 'EOF'
🚀 FACEBOOK MESSENGER CHAT EXPORTER - QUICK START

What's in this package:
• facebook-messenger-exporter/ (extension folder)
• facebook-messenger-exporter-v2.0.zip (same as above, zipped)
• index.html (detailed installation guide)
• This quick start file

⚡ SUPER QUICK INSTALL (5 steps):
1. Go to chrome://extensions/ in Google Chrome
2. Turn ON "Developer mode" (top-right toggle)
3. Click "Load unpacked" button
4. Select the "facebook-messenger-exporter" folder
5. Done! Extension appears in Chrome

🎯 HOW TO USE:
1. Go to messenger.com or facebook.com/messages
2. Open any conversation
3. Click the extension icon in Chrome toolbar
4. Click "Start Export" button
5. Wait for it to finish - text file downloads automatically!

📄 For detailed instructions, open index.html in your browser.

Your conversations will be exported as plain text files with:
• Sender names at the start of each line
• Date headers (Jul 11, 2025, 5:35 PM format)
• Chronological order (oldest to newest)
• Safe memory management to prevent crashes

🔒 PRIVACY: All processing happens locally in your browser.
No data is sent to external servers.
EOF

# Create a technical readme for developers
cat > "$DIST_DIR/TECHNICAL_INFO.md" << EOF
# Facebook Messenger Chat Exporter - Technical Information

## Version: $VERSION

## Package Contents
- **Extension Files**: Complete Chrome extension ready to load
- **Installation Guide**: User-friendly HTML guide (index.html)
- **Quick Start**: Text instructions for immediate use

## Technical Specifications
- **Platform**: Chrome Extension (Manifest v3)
- **Compatibility**: Chrome 88+, Edge 88+, other Chromium browsers
- **Permissions**: scripting, activeTab, downloads, storage
- **File Size**: ~12KB compressed, ~52KB uncompressed
- **Languages**: JavaScript, HTML, CSS

## Extension Architecture
- **manifest.json**: Extension configuration and permissions
- **popup.html/js**: User interface and main extraction logic
- **content.js**: Page interaction and status indicators
- **Icons**: SVG icons for browser integration

## Key Features
1. **Backward Scrolling**: Automatically scrolls up through conversation history
2. **Message Extraction**: Reads sender names, content, and timestamps
3. **DOM Cleanup**: Prevents memory leaks during extraction
4. **Progress Tracking**: Real-time progress updates during export
5. **File Generation**: Creates downloadable text files with UTF-8 encoding

## Privacy & Security
- No external network requests
- No data collection or analytics
- All processing happens locally
- No persistent data storage
- Works with existing Facebook session

## Distribution
This package is ready for end-user distribution. Users only need:
1. Chrome browser with Developer mode enabled
2. Basic folder navigation skills
3. Active Facebook/Messenger account

Generated on: $(date)
EOF

# Create file structure info
echo "📁 Created distribution package:"
echo "   📂 $DIST_DIR/"
find "$DIST_DIR" -type f | sed 's/^/      📄 /'

echo ""
echo "Package Statistics:"
TOTAL_SIZE=$(du -sh "$DIST_DIR" | cut -f1)
FILE_COUNT=$(find "$DIST_DIR" -type f | wc -l | tr -d ' ')
echo "   Total size: $TOTAL_SIZE"
echo "   📄 Files: $FILE_COUNT"
echo ""

echo "🎯 DISTRIBUTION READY!"
echo "======================"
echo ""
echo "📤 Ready to share:"
echo "   📂 Folder: $DIST_DIR/"
echo "   🌐 Main file: $DIST_DIR/index.html"
echo "   ⚡ Quick start: $DIST_DIR/QUICK_START.txt"
echo ""
echo "👥 End users should:"
echo "   1. Download/receive this entire folder"
echo "   2. Open index.html for detailed instructions"
echo "   3. Or follow QUICK_START.txt for immediate use"
echo ""
echo "Build complete! Package ready for distribution."
