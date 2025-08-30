#!/bin/bash

# Killer Game Setup Script
echo "Setting up Killer Game project..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first:"
    echo "https://nodejs.org/"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "npm is not installed. Please install npm first."
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install

echo "Setup complete!"
echo "Run 'npm start' to start the server"