#!/bin/bash

echo "🏗️ Building Chrome Extension for Distribution"
echo "============================================="
echo ""

# Function to increment version number
increment_version() {
    local version=$1
    local increment_type=${2:-patch} # patch, minor, or major
    
    IFS='.' read -ra VERSION_PARTS <<< "$version"
    local major=${VERSION_PARTS[0]}
    local minor=${VERSION_PARTS[1]}
    local patch=${VERSION_PARTS[2]}
    
    case $increment_type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch|*)
            patch=$((patch + 1))
            ;;
    esac
    
    echo "$major.$minor.$patch"
}

# Create build directory
BUILD_DIR="dist"
EXTENSION_NAME="facebook-messenger-exporter"
CURRENT_VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')

# Check for version increment type argument
INCREMENT_TYPE="patch"
if [ "$1" = "major" ] || [ "$1" = "minor" ] || [ "$1" = "patch" ]; then
    INCREMENT_TYPE="$1"
fi

echo "Current version: $CURRENT_VERSION"
echo "Creating distribution package..."
echo "   Extension: $EXTENSION_NAME"
echo "   Increment type: $INCREMENT_TYPE"
echo ""

# Clean previous build
if [ -d "$BUILD_DIR" ]; then
    rm -rf "$BUILD_DIR"
fi

mkdir -p "$BUILD_DIR/$EXTENSION_NAME"

echo "Copying essential files..."

# Copy only the files needed for the extension
cp manifest.json "$BUILD_DIR/$EXTENSION_NAME/"
cp popup.html "$BUILD_DIR/$EXTENSION_NAME/"
cp popup.js "$BUILD_DIR/$EXTENSION_NAME/"
cp content.js "$BUILD_DIR/$EXTENSION_NAME/"
cp icon16.svg "$BUILD_DIR/$EXTENSION_NAME/"
cp icon48.svg "$BUILD_DIR/$EXTENSION_NAME/"
cp icon128.svg "$BUILD_DIR/$EXTENSION_NAME/"

# Copy user guides (both markdown and HTML)
if [ -f "INSTALLATION.md" ]; then
    cp INSTALLATION.md "$BUILD_DIR/$EXTENSION_NAME/"
fi
if [ -f "QUICK_START.md" ]; then
    cp QUICK_START.md "$BUILD_DIR/$EXTENSION_NAME/"
fi
if [ -f "USER_GUIDE.md" ]; then
    cp USER_GUIDE.md "$BUILD_DIR/$EXTENSION_NAME/"
fi
if [ -f "USER_GUIDE.html" ]; then
    cp USER_GUIDE.html "$BUILD_DIR/$EXTENSION_NAME/"
fi
if [ -f "welcome.html" ]; then
    cp welcome.html "$BUILD_DIR/$EXTENSION_NAME/"
fi
if [ -f "index.html" ]; then
    cp index.html "$BUILD_DIR/$EXTENSION_NAME/"
fi

# Create a clean README for end users
cat > "$BUILD_DIR/$EXTENSION_NAME/README.md" << 'EOF'
# Facebook Messenger Chat Exporter

Export your Facebook Messenger conversations to text files with one click.

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Turn ON "Developer mode" (toggle in top-right)
3. Click "Load unpacked" button
4. Select this folder
5. Extension will be installed!

## Usage

1. Go to Facebook Messenger (messenger.com or facebook.com/messages)
2. Open any conversation
3. Click the extension icon in your toolbar
4. Click "Start Export" button
5. Wait for export to complete - file downloads automatically!

## Features

- Scrolls backwards through entire conversation history
- Extracts sender names and message content
- Includes date headers (Jul 11, 2025, 5:35 PM format)
- Saves as plain text file
- Prevents memory crashes with DOM cleanup
- Works on both messenger.com and facebook.com/messages

Your messages are exported locally - no data is sent to external servers.
EOF

# Create installation instructions
cat > "$BUILD_DIR/$EXTENSION_NAME/INSTALL.txt" << 'EOF'
🚀 INSTALLATION INSTRUCTIONS

1. Open Google Chrome
2. Type: chrome://extensions/ in the address bar
3. Turn ON "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked" button
5. Select this folder and click "Select"
6. Extension will appear in your extensions list
7. Pin it to your toolbar for easy access

Ready to use!

Go to Facebook Messenger, open any conversation, and click the extension icon!
EOF

echo "Extension files copied"
echo ""

# Create a ZIP file for distribution
cd "$BUILD_DIR"
ZIP_NAME="${EXTENSION_NAME}-v${CURRENT_VERSION}.zip"
zip -r "$ZIP_NAME" "$EXTENSION_NAME/" > /dev/null

echo "Created distribution files:"
echo "   📁 Folder: $BUILD_DIR/$EXTENSION_NAME/"
echo "   ZIP file: $BUILD_DIR/$ZIP_NAME"
echo ""

# Get folder size
FOLDER_SIZE=$(du -sh "$EXTENSION_NAME" | cut -f1)
ZIP_SIZE=$(du -sh "$ZIP_NAME" | cut -f1)

echo "Package info:"
echo "   📁 Folder size: $FOLDER_SIZE"
echo "   ZIP size: $ZIP_SIZE"
echo "   Files included:"
ls -1 "$EXTENSION_NAME/" | sed 's/^/      • /'

echo ""

# If build was successful, increment version
if [ $? -eq 0 ]; then
    cd ..
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$INCREMENT_TYPE")
    
    echo "🎯 BUILD SUCCESSFUL!"
    echo "=============================="
    echo ""
    echo "🔄 Auto-incrementing version..."
    echo "   From: $CURRENT_VERSION"
    echo "   To: $NEW_VERSION"
    echo ""
    
    # Update version in manifest.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\": *\"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" manifest.json
    else
        # Linux
        sed -i "s/\"version\": *\"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" manifest.json
    fi
    
    # Update version in package.json if it exists
    if [ -f "package.json" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/\"version\": *\"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
        else
            # Linux
            sed -i "s/\"version\": *\"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
        fi
        echo "   ✅ Updated package.json"
    fi
    
    echo "   ✅ Updated manifest.json"
    echo "   ✅ Version increment complete"
    echo ""
    echo "📤 Share with users:"
    echo "   1. Send them the ZIP file: $ZIP_NAME"
    echo "   2. Or share the folder: $EXTENSION_NAME/"
    echo ""
    echo "User instructions:"
    echo "   1. Extract ZIP (if using ZIP)"
    echo "   2. Go to chrome://extensions/"
    echo "   3. Enable Developer mode"
    echo "   4. Click 'Load unpacked'"
    echo "   5. Select the extension folder"
    echo ""
    echo "🚀 Ready for next development cycle with version $NEW_VERSION!"
else
    cd ..
    echo "❌ BUILD FAILED!"
    echo "Version not incremented due to build errors."
    exit 1
fi

cd ..
echo ""
echo "📁 Build output location: $(pwd)/$BUILD_DIR/"
