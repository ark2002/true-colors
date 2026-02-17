import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ColorDecorationProvider } from './colorDecorationProvider';
import { CssVariableHoverProvider } from './hoverProvider';

let decorationProvider: ColorDecorationProvider | undefined;
let hoverProvider: CssVariableHoverProvider | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
let fileChangeTimer: NodeJS.Timeout | undefined;

const SUPPORTED_LANGUAGES = ['css', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
const DEBOUNCE_DELAY_MS = 500; // Delay before updating decorations after typing stops (Microsoft recommended)

// Create output channel for logging
let outputChannel: vscode.OutputChannel;

function log(message: string) {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('True Colors');
    }
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
    log('True Colors extension is now active');

    // Create the decoration provider
    decorationProvider = new ColorDecorationProvider();

    // Create the hover provider
    hoverProvider = new CssVariableHoverProvider(new Map());

    // Register hover provider for supported languages  
    const hoverProviderDisposable = vscode.languages.registerHoverProvider(
        [
            { language: 'css' },
            { language: 'typescript' },
            { language: 'typescriptreact' },
            { language: 'javascript' },
            { language: 'javascriptreact' }
        ],
        hoverProvider
    );
    
    log('Hover provider registered for supported languages');

    // Initialize by scanning workspace for CSS files to build color variable map
    initializeColorVariables();

    // Register for text document changes with debouncing
    const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (SUPPORTED_LANGUAGES.includes(event.document.languageId)) {
            // Clear previous timer
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            
            // Set new timer to update decorations after typing stops
            debounceTimer = setTimeout(() => {
                decorationProvider?.updateDecorations(event.document);
            }, DEBOUNCE_DELAY_MS);
        }
    });

    // Register for active editor changes
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
            decorationProvider?.updateDecorations(editor.document);
        }
    });

    // Register for when files are saved (to refresh color variables)
    const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === 'css') {
            try {
                // Re-scan CSS file to update context-aware colors
                const fileContent = fs.readFileSync(document.uri.fsPath, 'utf8');
                decorationProvider?.scanCssContentForColors(document.fileName, fileContent);
                
                // Rebuild for current mode
                const config = vscode.workspace.getConfiguration('trueColors');
                const mode = config.get<string>('colorMode', 'auto');
                decorationProvider?.rebuildGlobalVariablesForMode(mode);
                
                // Update hover provider
                if (decorationProvider && hoverProvider) {
                    hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
                }
                
                // Refresh all visible editors
                vscode.window.visibleTextEditors.forEach((editor) => {
                    if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                        decorationProvider?.updateDecorations(editor.document);
                    }
                });
            } catch (error) {
                log(`Error refreshing after save: ${error}`);
            }
        }
    });

    // Watch for CSS file changes with debouncing
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.css');
    
    const refreshAllAfterCssChange = async (uri: vscode.Uri) => {
        // Clear previous timer
        if (fileChangeTimer) {
            clearTimeout(fileChangeTimer);
        }
        
        // Debounce CSS file changes
        fileChangeTimer = setTimeout(async () => {
            try {
                const fileContent = fs.readFileSync(uri.fsPath, 'utf8');
                decorationProvider?.scanCssContentForColors(uri.fsPath, fileContent);
                
                // Rebuild for current mode
                const config = vscode.workspace.getConfiguration('trueColors');
                const mode = config.get<string>('colorMode', 'auto');
                decorationProvider?.rebuildGlobalVariablesForMode(mode);
                
                // Update hover provider
                if (decorationProvider && hoverProvider) {
                    hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
                }
                
                // Refresh all visible editors
                vscode.window.visibleTextEditors.forEach((editor) => {
                    if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                        decorationProvider?.updateDecorations(editor.document);
                    }
                });
            } catch (error) {
                log(`Error refreshing after CSS change: ${error}`);
            }
        }, DEBOUNCE_DELAY_MS);
    };
    
    fileWatcher.onDidChange(refreshAllAfterCssChange);
    fileWatcher.onDidCreate(refreshAllAfterCssChange);

    fileWatcher.onDidDelete((uri) => {
        decorationProvider?.clearDocumentColors(uri.toString());
        vscode.window.visibleTextEditors.forEach((editor) => {
            if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                decorationProvider?.updateDecorations(editor.document);
            }
        });
    });

    // Update decorations for currently open editors
    vscode.window.visibleTextEditors.forEach((editor) => {
        if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
            decorationProvider?.updateDecorations(editor.document);
        }
    });

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand(
        'cssColorPreview.refresh',
        async () => {
            vscode.window.showInformationMessage('Refreshing CSS color variables...');
            await initializeColorVariables();
            // Refresh all visible editors
            vscode.window.visibleTextEditors.forEach((editor) => {
                if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                    decorationProvider?.updateDecorations(editor.document);
                }
            });
            vscode.window.showInformationMessage('CSS colors refreshed!');
        }
    );
    
    // Register mode switch command
    const switchModeCommand = vscode.commands.registerCommand(
        'cssColorPreview.switchMode',
        async () => {
            const config = vscode.workspace.getConfiguration('trueColors');
            const currentMode = config.get<string>('colorMode', 'auto');
            const detectedContexts = decorationProvider?.getDetectedContexts() || [];
            
            // Build quick pick items dynamically
            const items = [
                { 
                    label: 'auto', 
                    description: 'Use last defined color (default)', 
                    detail: 'Shows the final value when multiple contexts define the same variable',
                    picked: currentMode === 'auto' 
                }
            ];
            
            // Add all detected contexts dynamically
            detectedContexts.forEach((context) => {
                items.push({ 
                    label: context, 
                    description: `Show .${context} colors`,
                    detail: `Use colors defined in .${context} { } block`,
                    picked: currentMode === context 
                });
            });
            
            if (detectedContexts.length === 0) {
                vscode.window.showInformationMessage('No CSS class contexts detected (e.g., .light, .dark). Colors are global.');
                return;
            }
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Current: ${currentMode}. Detected contexts: ${detectedContexts.join(', ')}`,
                title: 'Select Color Context'
            });
            
            if (selected) {
                await config.update('colorMode', selected.label, vscode.ConfigurationTarget.Global);
                
                // Rebuild color registry for new mode
                decorationProvider?.rebuildGlobalVariablesForMode(selected.label);
                
                // Update hover provider
                if (decorationProvider && hoverProvider) {
                    hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
                }
                
                // Refresh all visible editors
                vscode.window.visibleTextEditors.forEach((editor) => {
                    if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                        decorationProvider?.updateDecorations(editor.document);
                    }
                });
                
                vscode.window.showInformationMessage(`True Colors: Switched to "${selected.label}" context`);
            }
        }
    );
    
    // Listen for configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('trueColors.colorMode')) {
            const config = vscode.workspace.getConfiguration('trueColors');
            const mode = config.get<string>('colorMode', 'auto');
            
            // Rebuild colors for new mode
            decorationProvider?.rebuildGlobalVariablesForMode(mode);
            
            // Update hover provider
            if (decorationProvider && hoverProvider) {
                hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
            }
            
            // Refresh all visible editors
            vscode.window.visibleTextEditors.forEach((editor) => {
                if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
                    decorationProvider?.updateDecorations(editor.document);
                }
            });
        }
    });

    context.subscriptions.push(
        disposable, 
        editorDisposable, 
        saveDisposable, 
        refreshCommand,
        switchModeCommand,
        configDisposable,
        fileWatcher,
        hoverProviderDisposable
    );
}

export function deactivate() {
    // Clear any pending debounce timers
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (fileChangeTimer) {
        clearTimeout(fileChangeTimer);
    }
    decorationProvider?.dispose();
    
    // Dispose output channel
    if (outputChannel) {
        outputChannel.dispose();
    }
}

async function initializeColorVariables() {
    log('========================================');
    log('Starting initialization...');
    log('Scanning workspace for CSS files...');
    
    // Find all CSS files in workspace (increased limit and better exclusions)
    const cssFiles = await vscode.workspace.findFiles(
        '**/*.css', 
        '{**/node_modules/**,**/dist/**,**/build/**,**/.next/**}',
        500
    );
    
    log(`Found ${cssFiles.length} CSS files:`);
    cssFiles.forEach(file => log(`  - ${file.fsPath}`));
    
    // Scan each CSS file to build global color variable registry
    for (const fileUri of cssFiles) {
        try {
            // Check file size before reading (skip files > 1MB for performance)
            const stats = fs.statSync(fileUri.fsPath);
            if (stats.size > 1024 * 1024) {
                log(`Skipping large file (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${fileUri.fsPath}`);
                continue;
            }
            
            // Read file directly using fs instead of openTextDocument to avoid 50MB limit
            const fileContent = fs.readFileSync(fileUri.fsPath, 'utf8');
            decorationProvider?.scanCssContentForColors(fileUri.fsPath, fileContent);
            log(`Successfully scanned: ${fileUri.fsPath}`);
        } catch (error) {
            log(`Error scanning ${fileUri.fsPath}: ${error}`);
        }
    }
    
    log('Initialization complete');
    log(`Total color variables in registry: ${decorationProvider?.getColorVariableCount()}`);
    log(`Detected contexts: ${decorationProvider?.getDetectedContexts().join(', ')}`);
    log('========================================');
    
    // Apply color mode setting
    const config = vscode.workspace.getConfiguration('trueColors');
    const mode = config.get<string>('colorMode', 'auto');
    log(`Using color mode: ${mode}`);
    decorationProvider?.rebuildGlobalVariablesForMode(mode);
    
    // Update hover provider with color variables
    if (decorationProvider && hoverProvider) {
        hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
    }
    
    // Now update all currently visible editors with the loaded colors
    vscode.window.visibleTextEditors.forEach((editor) => {
        if (SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
            log(`Updating visible editor: ${editor.document.fileName} (language: ${editor.document.languageId})`);
            decorationProvider?.updateDecorations(editor.document);
        }
    });
}
