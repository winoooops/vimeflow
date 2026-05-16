#!/bin/bash
# VIBM Development Environment Initialization
# Run this script to set up your local development environment

set -e

echo "Initializing VIBM development environment..."

# Check Node.js version
echo "Checking Node.js version..."
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 24 or higher."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 24 ]; then
    echo "Warning: Node.js $NODE_VERSION detected. This project requires Node.js 24+."
    echo "   Consider using nvm: nvm install 24 && nvm use 24"
fi

# Install npm dependencies
echo "Installing npm dependencies..."
if [ -f "package.json" ]; then
    npm install
else
    echo "package.json not found. Run the initializer agent first."
fi

# Check if Rust is installed (for future Tauri work)
echo "Checking Rust toolchain..."
if command -v rustup &> /dev/null; then
    rustup show
else
    echo "Rust is not installed. It will be needed for Tauri development."
    echo "   Install from: https://rustup.rs/"
fi

# Initialize git hooks if Husky is set up
if [ -d ".husky" ]; then
    echo "Initializing git hooks..."
    npm run prepare
fi

# Run verification checks
echo "Running verification checks..."
if [ -f "package.json" ]; then
    echo "   - Checking lint configuration..."
    npm run lint --silent || echo "Lint check failed"

    echo "   - Checking format configuration..."
    npm run format:check --silent || echo "Format check failed"
fi

echo ""
echo "Environment initialization complete!"
echo ""
echo "Next steps:"
echo "  - Review feature_list.json for development roadmap"
echo "  - Run 'npm run lint' to check code quality"
echo "  - Run 'npm test' to run tests"
echo "  - Review CLAUDE.md for project conventions"
echo ""

# Check if Tauri is initialized
if [ -d "crates/backend" ]; then
    echo "Rust backend crate detected!"
    echo "To start development server: npm run electron:dev"
else
    echo "Rust backend crate not yet initialized."
    echo "Expected crate path: crates/backend"
fi
