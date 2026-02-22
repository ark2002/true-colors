import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ColorDecorationProvider } from './colorDecorationProvider';
import { CssVariableHoverProvider } from './hoverProvider';

let decorationProvider: ColorDecorationProvider | undefined;
let hoverProvider: CssVariableHoverProvider | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
let fileChangeTimer: NodeJS.Timeout | undefined;
let enabledLanguagesCache: Set<string> | undefined;

const SUPPORTED_LANGUAGES = ['css', 'typescript', 'typescriptreact', 'javascript', 'javascriptreact'];
const FILE_TYPE_TO_LANGUAGE: Record<string, string> = {
    css: 'css',
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact'
};
const DEFAULT_ENABLED_FILE_TYPES = ['css', 'ts', 'tsx', 'js', 'jsx'];
const LANGUAGE_TO_FILE_TYPE: Record<string, string> = {
    css: 'css',
    typescript: 'ts',
    typescriptreact: 'tsx',
    javascript: 'js',
    javascriptreact: 'jsx'
};
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

function getEnabledFileTypes(): string[] {
    const config = vscode.workspace.getConfiguration('trueColors');
    const configured = config.get<string[]>('enabledLanguages', DEFAULT_ENABLED_FILE_TYPES);
    const normalized = (configured || [])
        .map((value) => FILE_TYPE_TO_LANGUAGE[value] ? value : LANGUAGE_TO_FILE_TYPE[value] || '')
        .filter((value): value is string => Boolean(value));

    const unique = Array.from(new Set(normalized));
    if (unique.length === 0) {
        return DEFAULT_ENABLED_FILE_TYPES;
    }

    return unique;
}

function getEnabledLanguages(): Set<string> {
    if (enabledLanguagesCache) {
        return enabledLanguagesCache;
    }
    const validConfigured = getEnabledFileTypes()
        .map((fileType) => FILE_TYPE_TO_LANGUAGE[fileType]);

    enabledLanguagesCache = validConfigured.length === 0
        ? new Set(SUPPORTED_LANGUAGES)
        : new Set(validConfigured);
    return enabledLanguagesCache;
}

function isDecorationEnabledForLanguage(languageId: string): boolean {
    return getEnabledLanguages().has(languageId);
}

function refreshVisibleEditors(): void {
    vscode.window.visibleTextEditors.forEach((editor) => {
        if (isDecorationEnabledForLanguage(editor.document.languageId)) {
            decorationProvider?.updateDecorations(editor.document);
        } else {
            decorationProvider?.clearDocumentColors(editor.document.uri.toString());
        }
    });
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
        if (isDecorationEnabledForLanguage(event.document.languageId)) {
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
        if (editor) {
            if (isDecorationEnabledForLanguage(editor.document.languageId)) {
                decorationProvider?.updateDecorations(editor.document);
            } else {
                decorationProvider?.clearDocumentColors(editor.document.uri.toString());
            }
        }
    });

    // Register for when files are saved (to refresh color variables)
    const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.languageId === 'css') {
            // Re-scan ALL CSS files so multi-file context data (e.g. .light in one file,
            // .dark in another) is not wiped when a single file is saved.
            initializeColorVariables().catch((error) => log(`Error refreshing after save: ${error}`));
        }
    });

    // Watch for CSS file changes with debouncing
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.css');
    
    const refreshAllAfterCssChange = (_uri: vscode.Uri) => {
        if (fileChangeTimer) {
            clearTimeout(fileChangeTimer);
        }
        // Debounce: re-scan ALL CSS files so context data from other files is preserved.
        fileChangeTimer = setTimeout(() => {
            initializeColorVariables().catch((error) => log(`Error refreshing after CSS change: ${error}`));
        }, DEBOUNCE_DELAY_MS);
    };
    
    fileWatcher.onDidChange(refreshAllAfterCssChange);
    fileWatcher.onDidCreate(refreshAllAfterCssChange);

    fileWatcher.onDidDelete((uri) => {
        decorationProvider?.clearDocumentColors(uri.toString());
        refreshVisibleEditors();
    });

    // Update decorations for currently open editors
    refreshVisibleEditors();

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand(
        'cssColorPreview.refresh',
        async () => {
            vscode.window.showInformationMessage('Refreshing CSS color variables...');
            await initializeColorVariables();
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
                    hoverProvider.updateContextualVariables(decorationProvider.getContextualColorsMap());
                }
                
                refreshVisibleEditors();
                
                vscode.window.showInformationMessage(`True Colors: Switched to "${selected.label}" context`);
            }
        }
    );

    const switchFileTypesCommand = vscode.commands.registerCommand(
        'cssColorPreview.switchFileTypes',
        async () => {
            const config = vscode.workspace.getConfiguration('trueColors');
            const fileTypeMeta = [
                { key: 'css', name: 'CSS (.css)' },
                { key: 'ts', name: 'TypeScript (.ts)' },
                { key: 'tsx', name: 'TypeScript React (.tsx)' },
                { key: 'js', name: 'JavaScript (.js)' },
                { key: 'jsx', name: 'JavaScript React (.jsx)' }
            ];

            type FileTypePickerItem = vscode.QuickPickItem & { action: string; key?: string };
            const enabled = new Set(getEnabledFileTypes());
            let updating = false;

            const buildItems = (): FileTypePickerItem[] => ([
                    ...fileTypeMeta.map((item) => ({
                        label: `${enabled.has(item.key) ? '$(check)' : '$(circle-outline)'} ${item.name}`,
                        detail: enabled.has(item.key) ? 'Enabled' : 'Disabled',
                        action: 'toggle',
                        key: item.key
                    })),
                    {
                        label: 'Enable all file types',
                        detail: 'Turn decorations on for css, ts, tsx, js, jsx',
                        action: '__all__'
                    }
                ]);

            const applySelection = async () => {
                const chosenFileTypes = enabled.size > 0 ? Array.from(enabled) : DEFAULT_ENABLED_FILE_TYPES;
                await config.update('enabledLanguages', chosenFileTypes, vscode.ConfigurationTarget.Global);
                refreshVisibleEditors();
            };

            const picker = vscode.window.createQuickPick<FileTypePickerItem>();
            picker.title = 'True Colors: Configure File Types';
            picker.placeholder = 'Press Enter to toggle. Changes apply instantly. Esc to close.';
            picker.ignoreFocusOut = true;
            picker.canSelectMany = false;
            picker.items = buildItems();

            picker.onDidAccept(async () => {
                if (updating) {
                    return;
                }

                const choice = picker.selectedItems[0];
                if (!choice) {
                    return;
                }

                updating = true;
                try {
                    if (choice.action === '__all__') {
                        enabled.clear();
                        DEFAULT_ENABLED_FILE_TYPES.forEach((fileType) => enabled.add(fileType));
                    } else if (choice.action === 'toggle' && choice.key) {
                        if (enabled.has(choice.key)) {
                            enabled.delete(choice.key);
                        } else {
                            enabled.add(choice.key);
                        }
                    }

                    await applySelection();
                    picker.items = buildItems();

                    const next = picker.items.find((item) => item.key === choice.key || item.action === choice.action);
                    if (next) {
                        picker.activeItems = [next];
                    }
                } finally {
                    updating = false;
                }
            });

            picker.onDidHide(() => {
                picker.dispose();
            });

            picker.show();
        }
    );
    
    const switchDecorationStyleCommand = vscode.commands.registerCommand(
        'cssColorPreview.switchDecorationStyle',
        async () => {
            const config = vscode.workspace.getConfiguration('trueColors');
            const currentStyle = config.get<string>('decorationStyle', 'highlight');

            const items = [
                {
                    label: 'highlight',
                    description: 'Full background highlight on the token',
                    detail: 'The entire variable / class name is filled with the color',
                    picked: currentStyle === 'highlight',
                },
                {
                    label: 'patch',
                    description: 'Small color swatch before the token',
                    detail: 'A tiny color chip appears inline; the text itself is unstyled',
                    picked: currentStyle === 'patch',
                },
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Current style: ${currentStyle}`,
                title: 'True Colors: Select Decoration Style',
            });

            if (selected && selected.label !== currentStyle) {
                await config.update('decorationStyle', selected.label, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`True Colors: Decoration style set to "${selected.label}"`);
            }
        }
    );

    // Listen for configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (
            event.affectsConfiguration('trueColors.colorMode') ||
            event.affectsConfiguration('trueColors.enabledLanguages') ||
            event.affectsConfiguration('trueColors.decorationStyle')
        ) {
            if (event.affectsConfiguration('trueColors.enabledLanguages')) {
                enabledLanguagesCache = undefined;
            }
            const config = vscode.workspace.getConfiguration('trueColors');
            const mode = config.get<string>('colorMode', 'auto');
            
            // Rebuild colors for new mode
            decorationProvider?.rebuildGlobalVariablesForMode(mode);
            
            // When decoration style changes, flush the decoration type cache so
            // the next render creates fresh decorations for the new style
            if (event.affectsConfiguration('trueColors.decorationStyle')) {
                decorationProvider?.clearDecorationCache();
            }
            
            // Update hover provider
            if (decorationProvider && hoverProvider) {
                hoverProvider.updateGlobalVariables(decorationProvider.getGlobalColorVariables());
                hoverProvider.updateContextualVariables(decorationProvider.getContextualColorsMap());
            }
            
            refreshVisibleEditors();
        }
    });

    context.subscriptions.push(
        disposable, 
        editorDisposable, 
        saveDisposable, 
        refreshCommand,
        switchModeCommand,
        switchFileTypesCommand,
        switchDecorationStyleCommand,
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
    
    // Scan each CSS file to build global color variable registry (merge so all files' contexts are kept)
    cssFiles.forEach((fileUri, index) => {
        try {
            // Check file size before reading (skip files > 1MB for performance)
            const stats = fs.statSync(fileUri.fsPath);
            if (stats.size > 1024 * 1024) {
                log(`Skipping large file (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${fileUri.fsPath}`);
                return;
            }

            // Read file directly using fs instead of openTextDocument to avoid 50MB limit
            const fileContent = fs.readFileSync(fileUri.fsPath, 'utf8');
            // First file replaces; subsequent files merge so multi-file contexts (e.g. .light in one file, .dark in another) are accumulated
            decorationProvider?.scanCssContentForColors(fileUri.fsPath, fileContent, index > 0 ? { merge: true } : undefined);
            log(`Successfully scanned: ${fileUri.fsPath}`);
        } catch (error) {
            log(`Error scanning ${fileUri.fsPath}: ${error}`);
        }
    });
    
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
        hoverProvider.updateContextualVariables(decorationProvider.getContextualColorsMap());
    }
    
    // Now update all currently visible editors with the loaded colors
    const enabledLanguages = getEnabledLanguages();
    vscode.window.visibleTextEditors.forEach((editor) => {
        if (enabledLanguages.has(editor.document.languageId)) {
            log(`Updating visible editor: ${editor.document.fileName} (language: ${editor.document.languageId})`);
            decorationProvider?.updateDecorations(editor.document);
        } else {
            decorationProvider?.clearDocumentColors(editor.document.uri.toString());
        }
    });
}
