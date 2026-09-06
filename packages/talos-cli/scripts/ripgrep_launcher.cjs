#!/usr/bin/env node

/**
 * Ripgrep runner - executed as a subprocess to run the native module
 * This file is intentionally written in CommonJS to avoid ESM complexities
 *
 * Updated with graceful fallback chain for runtime compatibility:
 * - Node.js: Try native addon first, fall back to binary
 * - Bun: Use binary or system ripgrep directly
 * - All runtimes: Cross-platform system detection
 * - Prefer the shipped binary before an optional system installation
 */

const path = require('path');
const fs = require('fs');

// Runtime detection (minimal, focused)
function detectRuntime() {
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof Deno !== 'undefined') return 'deno';
    if (process?.versions?.bun) return 'bun';
    if (process?.versions?.deno) return 'deno';
    if (process?.versions?.node) return 'node';
    return 'unknown';
}

// Find ripgrep in system PATH (cross-platform)
function findSystemRipgrep() {
    const { execFileSync } = require('child_process');

    // Platform-specific commands to find ripgrep
    const commands = [
        // Windows: Use where command
        process.platform === 'win32' && { cmd: 'where', args: ['rg'] },
        // Unix-like: Use which command
        process.platform !== 'win32' && { cmd: 'which', args: ['rg'] }
    ].filter(Boolean);

    for (const { cmd, args } of commands) {
        try {
            const result = execFileSync(cmd, args, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
            });

            if (result) {
                const paths = result.trim().split('\n').filter(Boolean);
                if (paths.length > 0) {
                    return paths[0].trim();
                }
            }
        } catch {
            // Command failed, try next one
            continue;
        }
    }

    // Fallback: Try common installation paths directly
    const commonPaths = [];
    if (process.platform === 'win32') {
        commonPaths.push(
            'C:\\Program Files\\ripgrep\\rg.exe',
            'C:\\Program Files (x86)\\ripgrep\\rg.exe'
        );
    } else if (process.platform === 'darwin') {
        commonPaths.push(
            '/opt/homebrew/bin/rg',
            '/usr/local/bin/rg'
        );
    } else if (process.platform === 'linux') {
        commonPaths.push(
            '/usr/bin/rg',
            '/usr/local/bin/rg',
            '/opt/homebrew/bin/rg'
        );
    }

    for (const testPath of commonPaths) {
        if (fs.existsSync(testPath)) {
            return testPath;
        }
    }

    return null;
}

// Create wrapper that mimics native addon interface
function createRipgrepWrapper(binaryPath) {
    return {
        ripgrepMain: (args) => {
            const { spawnSync } = require('child_process');
            const result = spawnSync(binaryPath, args, {
                stdio: 'inherit',
                cwd: process.cwd(),
                windowsHide: true
            });
            if (result.error) throw result.error;
            if (result.signal) {
                console.error(`Ripgrep terminated by ${result.signal}`);
                return 128 + (require('os').constants.signals[result.signal] || 0);
            }
            return result.status ?? 2;
        }
    };
}

// Load ripgrep with graceful fallback chain
function loadRipgrepNative() {
    const runtime = detectRuntime();
    const toolsDir = path.join(__dirname, '..', 'tools', 'unpacked');
    const nativePath = path.join(toolsDir, 'ripgrep.node');
    const binaryPath = path.join(toolsDir, process.platform === 'win32' ? 'rg.exe' : 'rg');

    // Try Node.js native addon first (preserves existing behavior)
    if (runtime === 'node') {
        try {
            const addon = require(nativePath);
            if (typeof addon.ripgrepMain !== 'function') throw new Error('Missing ripgrepMain export');
            return addon;
        } catch (error) {
            console.warn('Failed to load ripgrep native addon:', error.message);
            console.warn('Falling back to ripgrep binary...');
            // Fall through to binary fallback
        }
    }

    // Prefer the version shipped and verified with this package.
    if (fs.existsSync(binaryPath)) {
        return createRipgrepWrapper(binaryPath);
    }

    // A system installation is useful when the packaged tools are unavailable.
    const systemRipgrep = findSystemRipgrep();
    if (systemRipgrep) {
        console.warn(`Using system ripgrep: ${systemRipgrep}`);
        return createRipgrepWrapper(systemRipgrep);
    }

    console.warn('Install ripgrep to enable search:');

    if (process.platform === 'win32') {
        console.warn('  • Windows: winget install BurntSushi.ripgrep');
        console.warn('  • Or download from: https://github.com/BurntSushi/ripgrep/releases');
    } else {
        console.warn('  • macOS/Linux: brew install ripgrep');
        console.warn('  • npm: npm install -g @silentsilas/ripgrep-bin');
    }
    console.warn('');

    throw new Error('Search functionality unavailable without ripgrep');
}

// Get arguments from command line (skip node and script name)
const args = process.argv.slice(2);

// Parse the JSON-encoded arguments
let parsedArgs;
try {
    parsedArgs = JSON.parse(args[0]);
    if (!Array.isArray(parsedArgs) || parsedArgs.some(arg => typeof arg !== 'string')) {
        throw new Error('Expected an array of string arguments');
    }
} catch (error) {
    console.error('Failed to parse arguments:', error.message);
    process.exit(2);
}

// Run ripgrep using the loaded implementation
try {
    const ripgrepImplementation = loadRipgrepNative();
    const exitCode = ripgrepImplementation.ripgrepMain(parsedArgs);
    process.exit(Number.isInteger(exitCode) ? exitCode : 2);
} catch (error) {
    console.error('Ripgrep error:', error.message);
    process.exit(2);
}
