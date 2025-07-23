#!/bin/bash

echo "🚀 Facebook Messenger Chat Exporter - Deployment Guide"
echo "====================================================="
echo ""

# Get current directory
EXTENSION_DIR=$(pwd)

echo "Extension Status Check:"
echo "-------------------------"

# Check required files
required_files=("manifest.json" "popup.html" "popup.js" "content.js" "icon16.svg" "icon48.svg" "icon128.svg")
missing_files=()

for file in "${required_files[@]}"; do
    if [[ -f "$file" ]]; then
        echo " $file"
    else
        echo " $file (MISSING)"
        missing_files+=("$file")
    fi
done

echo ""

if [[ ${#missing_files[@]} -eq 0 ]]; then
    echo "🎉 All extension files are present!"
    echo ""
    
    echo "INSTALLATION STEPS:"
    echo "====================="
    echo ""
    echo "1️⃣ Open Chrome browser"
    echo "2️⃣ Navigate to: chrome://extensions/"
    echo "3️⃣ Turn ON 'Developer mode' (toggle switch in top-right corner)"
    echo "4️⃣ Click 'Load unpacked' button"
    echo "5️⃣ Select this folder:"
    echo "   📁 $EXTENSION_DIR"
    echo ""
    echo " Your extension will appear in the extensions list!"
    echo ""
    echo "📌 USAGE:"
    echo "========="
    echo "1️⃣ Go to messenger.com or facebook.com/messages"
    echo "2️⃣ Open any conversation"
    echo "3️⃣ Click the extension icon in your toolbar"
    echo "4️⃣ Configure settings and click 'Export Messages'"
    echo "5️⃣ Wait for export to complete - file will download automatically"
    echo ""
    echo "🔗 Quick Links:"
    echo "  • Chrome Extensions: chrome://extensions/"
    echo "  • Facebook Messenger: https://messenger.com"
    echo "  • Facebook Messages: https://facebook.com/messages"
    echo ""
    
    # Check if Chrome is installed
    if [[ -d "/Applications/Google Chrome.app" ]]; then
        echo "💡 TIP: Would you like me to open Chrome extensions page?"
        echo "   Run: open -a 'Google Chrome' 'chrome://extensions/'"
    fi
    
else
    echo "  Missing required files: ${missing_files[*]}"
    echo "   Please ensure all extension files are present before deploying."
fi

echo ""
echo "📚 For detailed documentation, see: README_EXTENSION.md"
