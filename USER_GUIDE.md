# Facebook Messenger Exporter - User Guide

## 📋 What This Extension Does

This Chrome extension allows you to **download your complete Facebook Messenger conversations** as text files. It automatically scrolls through your entire chat history and extracts all messages from both you and the other person.

## 🚀 Quick Start Guide

### Step 1: Install the Extension

1. **Download** the extension files to your computer
2. **Open Chrome** and go to `chrome://extensions/`
3. **Turn on "Developer mode"** (toggle in top-right corner)
4. **Click "Load unpacked"** button
5. **Select the extension folder** (`facebook-messenger-exporter`)
6. **Done!** You'll see the extension icon in your Chrome toolbar

### Step 2: Open Your Conversation

1. **Go to Facebook Messenger**:
   - Visit `facebook.com/messages` OR
   - Visit `messenger.com`
2. **Open the conversation** you want to download
3. **Make sure you can see messages** on the screen

### Step 3: Start the Export

1. **Click the extension icon** in Chrome toolbar (looks like a download icon)
2. **Check the settings** (optional):
   - Include Dates (recommended)
   - ⚙️ Clear DOM (helps with large conversations)
3. **Click "Start Export"** button
4. **Wait for completion** - the extension will:
   - Automatically scroll through your entire conversation
   - Extract all messages from both participants
   - Show progress as it works
   - Download the file when finished

## 📁 What You'll Get

Your downloaded file will be named like:
```
messenger_ConversationName_2025-07-24_14-30-15.txt
```

**File contents example:**
```
Jul 24, 2025, 2:30 PM

YOU: Hey! How's your day going?
JOHN SMITH: Pretty good! Just finished work
YOU: Nice! Want to grab dinner later?

Jul 23, 2025, 8:45 PM

JOHN SMITH: Did you see the game last night?
YOU: Yes! What an amazing finish
JOHN SMITH: I know right! Can't believe that final play
```

## ⚙️ Settings Explained

### Include Dates ✅
- **ON**: Adds date headers like "Jul 24, 2025, 2:30 PM"
- **OFF**: Just shows messages without dates
- **Recommended**: Keep this ON

### Clear DOM ⚙️
- **ON**: Removes processed messages from memory (helps with large conversations)
- **OFF**: Keeps all messages in browser memory
- **Recommended**: Turn ON for conversations with 1000+ messages

## 🔍 Troubleshooting

### "Please open Facebook Messenger first"
- Make sure you're on `facebook.com/messages` or `messenger.com`
- Refresh the page and try again

### "Please open a specific conversation"
- You need to click on a specific chat, not just the main messages page
- Make sure you can see actual messages on screen

### "No messages found"
- Try scrolling up manually to load some messages first
- Make sure the conversation has messages
- Check browser console (F12) for detailed error info

### Extension not working
1. **Refresh** the Facebook page
2. **Reload** the extension in `chrome://extensions/`
3. **Try a different conversation** to test
4. **Check** that you're logged into Facebook

### Large conversations taking too long
- This is normal for conversations with thousands of messages
- The extension may take 5-15 minutes for very large conversations
- Progress bar shows current status
- You can click "Stop Export" if needed

## 📊 Performance Guide

| Conversation Size | Expected Time | Tips |
|------------------|---------------|------|
| 100 messages | 1-2 minutes | Quick and easy |
| 1,000 messages | 3-5 minutes | Turn on "Clear DOM" |
| 5,000 messages | 8-12 minutes | Be patient, grab coffee ☕ |
| 10,000+ messages | 15+ minutes | Consider exporting in parts |

## 🛡️ Privacy & Security

- **No data sent online**: Everything happens locally in your browser
- **No passwords saved**: Uses your existing Facebook login
- **No tracking**: Extension doesn't collect any data
- **Open source**: You can review the code

## 💡 Pro Tips

### For Best Results:
1. **Close other tabs** to save memory
2. **Don't use Facebook** while exporting
3. **Start with smaller conversations** to test
4. **Export during off-peak hours** (Facebook loads faster)

### For Large Conversations:
1. **Turn on "Clear DOM"** setting
2. **Close unnecessary browser tabs**
3. **Let it run in background** - don't interrupt
4. **Consider breaking very large exports** into time periods

### File Organization:
- Files are automatically named with date/time
- Create folders for different conversations
- Consider backing up important conversations

## 🆘 Getting Help

### Check Console for Errors:
1. Press **F12** to open Developer Tools
2. Click **Console** tab
3. Look for error messages in red
4. Copy any error messages for support

### Common Error Messages:
- "No message container found" = Page not loaded properly, refresh and try again
- "Export failed" = Try refreshing Facebook and restarting export
- "Selector failed" = Facebook changed layout, extension may need update

## 📞 Support

If you need help:
1. **Try the troubleshooting steps** above
2. **Check the console** for error details (F12 → Console)
3. **Test with a small conversation** first
4. **Share console errors** if asking for help

## 🔄 Updates

To update the extension:
1. Download new version files
2. Go to `chrome://extensions/`
3. Click "Reload" button under the extension
4. Or remove old version and install new one

---

**Enjoy backing up your precious conversations! 💬**
