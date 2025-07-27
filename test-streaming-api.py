#!/usr/bin/env python3
"""
Test script to demonstrate the streaming API
"""
import requests
import time

API_BASE = "http://127.0.0.1:3010"

def test_streaming_api():
    print("🧪 Testing Streaming API...")
    
    # Reset session
    try:
        response = requests.get(f"{API_BASE}/reset")
        print(f"✅ Session reset: {response.json()}")
    except:
        print("❌ Server not running? Start with: python3 start-local-server.py")
        return
    
    # Test messages
    test_messages = [
        "Facebook Messenger Conversation Export",
        "Exported: 2025-01-26 15:30:00",
        "=" * 50,
        "",
        "--- January 26, 2025 ---",
        "YOU: Hello there!",
        "FRIEND: Hey back!",
        "YOU: How are you doing?",
        "--- January 25, 2025 ---",
        "FRIEND: Good morning!",
        "YOU: Morning! Ready for today?"
    ]
    
    print(f"\n📡 Streaming {len(test_messages)} messages to API...")
    
    for i, message in enumerate(test_messages, 1):
        try:
            response = requests.get(f"{API_BASE}/saveTxt.js", params={"txt": message})
            result = response.json()
            print(f"[{i:2d}] {result['status']}: {result.get('line_preview', message[:50])}")
            time.sleep(0.1)  # Simulate streaming delay
        except Exception as e:
            print(f"❌ Error sending message {i}: {e}")
    
    print("\n✅ Streaming test complete!")
    print("📁 Check the generated messenger_export_*.txt file")

if __name__ == "__main__":
    test_streaming_api()
