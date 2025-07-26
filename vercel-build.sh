#!/bin/bash

# Vercel Build Script for Facebook Messenger Exporter
echo "🚀 Starting Vercel Build Process..."

# Check if we're in Vercel environment
if [ "$VERCEL" = "1" ]; then
    echo "📦 Running in Vercel environment"
    
    # Install dependencies if package.json exists
    if [ -f "package.json" ]; then
        echo "📥 Installing dependencies..."
        npm ci
    fi
    
    # Run the extension build
    echo "🏗️ Building extension..."
    chmod +x build.sh
    ./build.sh
    
    # Copy web files to root for Vercel deployment
    echo "📁 Preparing web files for deployment..."
    cp -r web/* ./
    
    # Ensure dist directory is accessible
    if [ -d "dist" ]; then
        echo "✅ Dist directory ready for deployment"
        ls -la dist/
    else
        echo "❌ Dist directory not found"
        exit 1
    fi
    
    echo "🎉 Vercel build completed successfully!"
else
    echo "🔧 Running local build..."
    ./build.sh
fi
