#!/usr/bin/env python3
import http.server
import socketserver
import os
import urllib.parse
from datetime import datetime
import json

# Change to the directory containing writeProxy.html
os.chdir('/Users/andydo/Desktop/facebook-script-extract-messenger-from-chrome')

PORT = 3010
saved_messages = set()  # Track saved messages to prevent duplicates
content_hashes = set()  # Track content hashes for better duplicate detection
current_session_file = None  # Track current session file

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to allow cross-origin requests
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        # Handle preflight CORS requests
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        global current_session_file, saved_messages
        
        # Handle the saveTxt.js API endpoint for streaming messages
        if self.path.startswith('/saveTxt.js'):
            try:
                # Parse the query string to get the text
                url_parts = urllib.parse.urlparse(self.path)
                query_params = urllib.parse.parse_qs(url_parts.query)
                
                if 'txt' in query_params:
                    text = query_params['txt'][0]
                    
                    # Initialize session file if needed
                    if current_session_file is None:
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        current_session_file = f"messenger_export_{timestamp}.txt"
                        print(f"🎯 Started new session: {current_session_file}")
                    
                    # Enhanced duplicate detection
                    normalized_text = text.lower().strip()
                    
                    # Create content hash for better duplicate detection
                    content_hash = f"{normalized_text[:100]}_{len(normalized_text)}"
                    
                    # Check for exact duplicates first
                    if normalized_text in saved_messages:
                        # Send duplicate response
                        self.send_response(200)
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        response = json.dumps({
                            "status": "duplicate",
                            "message": f"Exact duplicate skipped: {text[:50]}{'...' if len(text) > 50 else ''}"
                        })
                        self.wfile.write(response.encode('utf-8'))
                        print(f"🔄 Duplicate blocked: {text[:50]}{'...' if len(text) > 50 else ''}")
                        return
                    
                    # Check for near-duplicates (same content hash)
                    if content_hash in content_hashes:
                        self.send_response(200)
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        response = json.dumps({
                            "status": "duplicate",
                            "message": f"Similar duplicate skipped: {text[:50]}{'...' if len(text) > 50 else ''}"
                        })
                        self.wfile.write(response.encode('utf-8'))
                        print(f"🔄 Similar duplicate blocked: {text[:50]}{'...' if len(text) > 50 else ''}")
                        return
                    
                    # Add to seen messages and hashes
                    saved_messages.add(normalized_text)
                    content_hashes.add(content_hash)
                    
                    # Stream/append to file
                    with open(current_session_file, 'a', encoding='utf-8') as f:
                        f.write(text + '\n')
                        f.flush()  # Ensure immediate write for streaming
                    
                    # Send success response
                    self.send_response(200)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = json.dumps({
                        "status": "saved",
                        "message": f"Saved line to {current_session_file}",
                        "line_preview": text[:50] + ('...' if len(text) > 50 else ''),
                        "total_lines": len(saved_messages)
                    })
                    self.wfile.write(response.encode('utf-8'))
                    
                    # Log to console for monitoring
                    print(f"📝 [{len(saved_messages):4d}] {text[:80]}{'...' if len(text) > 80 else ''}")
                    return
                else:
                    self.send_response(400)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = json.dumps({
                        "status": "error",
                        "message": "No 'txt' parameter provided"
                    })
                    self.wfile.write(response.encode('utf-8'))
                    return
                    
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = json.dumps({
                    "status": "error",
                    "message": str(e)
                })
                self.wfile.write(response.encode('utf-8'))
                return
        
        # Handle session reset endpoint
        elif self.path == '/reset':
            saved_messages.clear()
            current_session_file = None
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = json.dumps({
                "status": "reset",
                "message": "Session reset successfully"
            })
            self.wfile.write(response.encode('utf-8'))
            print("🔄 Session reset")
            return
        
        # Handle regular file requests
        super().do_GET()

    def log_message(self, format, *args):
        # Override to reduce log verbosity for API calls
        if 'saveTxt.js' not in args[0]:
            return super().log_message(format, *args)

with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
    print(f"🚀 Streaming API Server running at http://127.0.0.1:{PORT}/")
    print(f"📡 API Endpoint: http://127.0.0.1:{PORT}/saveTxt.js?txt=<message>")
    print(f"🔄 Reset Endpoint: http://127.0.0.1:{PORT}/reset")
    print(f"🔄 Extension will scroll back through Facebook Messenger")
    print(f"📝 Each detected DOM node (message) will be streamed to API")
    print(f"💾 Messages saved to: messenger_export_YYYYMMDD_HHMMSS.txt")
    print(f"Press Ctrl+C to stop the server\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print(f"\n🛑 Server stopped")
        if current_session_file:
            print(f"📁 Final export saved as: {current_session_file}")
            print(f"📊 Total messages saved: {len(saved_messages)}")
