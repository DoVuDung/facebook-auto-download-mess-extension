# How to Download All Messages with Auto-Scroll

## What This Extension Does

**Automatically scrolls** through your entire Messenger conversation
**Extracts ALL messages** from both you and the other person
**Downloads complete conversation** as a text file
**Includes date headers** to organize messages by time
**Handles large conversations** with thousands of messages

## How to Use

### Step 1: Install the Extension
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist/facebook-messenger-exporter/` folder

### Step 2: Open Facebook Messenger
1. Go to `facebook.com/messages` or `messenger.com`
2. Open the specific conversation you want to download
3. Make sure you can see the messages on screen

### Step 3: Start the Download
1. Click the extension icon in Chrome toolbar
2. Click "Start Export" button
3. The extension will automatically:
   - Scroll backwards through the entire conversation
   - Extract messages from both participants
   - Show progress as it works
   - Download the complete conversation as a `.txt` file

## What You'll Get

The downloaded file will contain:
```
Jul 24, 2025, 8:30 AM

YOU: Hello! How are you?
FRIEND_NAME: I'm doing great, thanks for asking!
YOU: That's wonderful to hear

Jul 23, 2025, 6:15 PM

FRIEND_NAME: Did you see the news today?
YOU: Yes, quite interesting!
```

## Settings

- **Include Dates**: Add date headers between message groups
- ⚙️ **Clear DOM**: Remove processed messages to save memory
- 🔄 **Auto-scroll**: Automatically enabled - scrolls through entire conversation

## Technical Details

- **Auto-scroll**: Uses multiple scroll methods to load all message history
- **Both participants**: Extracts messages from you AND the other person
- **Large conversations**: Can handle conversations with 1000+ messages
- **Memory efficient**: Clears processed DOM elements to prevent crashes
- **Format**: Clean text format with sender names and timestamps

## Troubleshooting

If the extension doesn't find messages:
1. Make sure you're on a Messenger conversation page
2. Scroll up manually to load some older messages first
3. Check the browser console (F12) for debug information
4. Try refreshing the page and running again

## Export Process

The extension will:
1. **Phase 1**: Detect the conversation container
2. **Phase 2**: Start auto-scrolling backwards to load history
3. **Phase 3**: Extract messages from both participants as it scrolls
4. **Phase 4**: Continue until it reaches the beginning of the conversation
5. **Phase 5**: Format and download the complete conversation

**Note**: For very large conversations (years of messages), this process may take several minutes. The progress bar will show the current status.
