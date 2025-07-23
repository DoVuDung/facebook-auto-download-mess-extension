# Facebook Messenger Chat Exporter

A Chrome extension that allows you to export Facebook Messenger conversations to text files with one click.

## Features

- 🚀 **One-click export** - Simple popup interface with export button
- 📱 **Smart conversation detection** - Automatically detects current conversation
- ⏱️ **Real-time progress tracking** - Shows export progress with visual indicators
- **Comprehensive message extraction** - Includes sender names, timestamps, and message content
- 🔧 **Customizable options** - Configure what to include in exports
- **Multiple export formats** - Save as text files with proper formatting
- 🛡️ **Safe and secure** - No data sent to external servers, all processing done locally

## Installation

1. **Download the extension files** to a folder on your computer
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer mode** (toggle in top-right corner)
4. **Click "Load unpacked"** and select the extension folder
5. **Pin the extension** to your toolbar for easy access

## Usage

1. **Open Facebook Messenger** in Chrome (`messenger.com` or `facebook.com/messages`)
2. **Navigate to any conversation** you want to export
3. **Click the extension icon** in your toolbar
4. **Configure export settings** (optional):
   - Include timestamps
   - Include sender names
   - Include message reactions
   - Number of messages to export
5. **Click "Export Messages"** button
6. **Wait for export to complete** - progress bar will show status
7. **File will download automatically** when complete

## Export Options

### What's Included
- **Sender names** - Who sent each message
- **Message content** - Full text of messages
- **Timestamps** - When messages were sent
- **Date headers** - Organized by conversation dates
- **Media indicators** - Notes when photos/files were shared

### File Format
```
Conversation: John Doe

=== January 15, 2024 ===

John Doe: Hey, how are you?
You: I'm doing great! How about you?
John Doe: Pretty good, thanks for asking!

=== January 16, 2024 ===

You: Did you see the game last night?
John Doe: Yes! What a finish!
```

## Technical Details

### Browser Compatibility
- **Chrome** 88+ (Manifest V3 support required)
- **Edge** 88+ (Chromium-based)
- **Other Chromium browsers** should work

### Permissions Required
- `activeTab` - Access current tab to read messages
- `scripting` - Inject content script for message extraction
- `downloads` - Save exported files to your computer
- `storage` - Remember your export preferences

### Privacy & Security
-  **No data collection** - Extension doesn't collect or store your personal data
-  **Local processing** - All message extraction happens in your browser
-  **No external servers** - No data sent to third parties
-  **Open source** - All code is visible and auditable

## How It Works

1. **Content Script Injection** - Extension injects code into Messenger pages
2. **DOM Parsing** - Reads message elements from Facebook's HTML structure
3. **Data Extraction** - Extracts sender names, timestamps, and message content
4. **Format Conversion** - Organizes data into readable text format
5. **File Download** - Uses Chrome's download API to save file locally

## Troubleshooting

### Extension Not Working?
- Make sure you're on a valid Messenger page (`/messages/` or `/t/`)
- Refresh the page and try again
- Check that extension is enabled in `chrome://extensions/`

### Export Button Disabled?
- Navigate to a specific conversation (not the main messages page)
- Wait for page to fully load before clicking export
- Try scrolling up to load more messages first

### Missing Messages?
- Extension exports currently visible messages
- Scroll up in the conversation to load older messages
- Facebook loads messages dynamically as you scroll

### File Download Issues?
- Check Chrome's download settings and permissions
- Make sure downloads aren't blocked for the site
- Try exporting a smaller number of messages first

## Development

### File Structure
```
facebook-script-extract-messenger-from-chrome/
├── manifest.json          # Extension configuration
├── popup.html            # Extension popup interface
├── popup.js              # Popup logic and message extraction
├── content.js            # Content script for Messenger pages
├── icon16.svg            # Extension icon (16x16)
├── icon48.svg            # Extension icon (48x48)
├── icon128.svg           # Extension icon (128x128)
└── README.md             # This file
```

### Building from Source
1. Clone or download the repository
2. No build process required - extension runs directly from source
3. Load unpacked extension in Chrome Developer mode

### Contributing
- Report bugs or request features via GitHub issues
- Submit pull requests for improvements
- Test on different browsers and Facebook UI changes

## Version History

### v2.0 (Current)
- Complete rewrite with modern UI
- Added progress tracking and status indicators
- Improved message extraction with multiple DOM selector strategies
- Enhanced error handling and user feedback
- Added export configuration options
- Better conversation title detection

### v1.0 (Legacy)
- Basic message extraction functionality
- Simple button interface
- Limited error handling

## Known Limitations

- **Facebook UI Changes** - Facebook frequently updates their interface, which may break extraction
- **Dynamic Loading** - Only exports currently loaded messages (scroll up to load more)
- **Media Content** - Photos and files are noted but not downloaded
- **Group Chat Complexity** - Large group chats may take longer to process
- **Rate Limiting** - Facebook may limit rapid scrolling/loading

## License

This project is provided as-is for educational and personal use. Respect Facebook's Terms of Service and don't use for automated data collection or commercial purposes.
