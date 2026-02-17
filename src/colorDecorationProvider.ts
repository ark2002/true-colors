import * as vscode from 'vscode';
import { parseColorValue, toRgbaString, ParsedColor } from './colorParser';
import { parseTailwindClass, resolveTailwindColor } from './tailwindParser';

interface ColorDecoration {
    decoration: vscode.TextEditorDecorationType;
    range: vscode.Range;
    color: ParsedColor;
}

interface ColorWithContext {
    color: ParsedColor;
    context: string; // e.g., 'light', 'dark', or 'global'
}

export class ColorDecorationProvider {
    private decorations: Map<string, ColorDecoration[]> = new Map();
    private colorVariables: Map<string, Map<string, ParsedColor>> = new Map(); // documentUri -> varName -> color
    private globalColorVariables: Map<string, ParsedColor> = new Map(); // Global registry of all color variables
    private contextualColorVariables: Map<string, Map<string, ColorWithContext>> = new Map(); // varName -> context -> color
    private decorationCache: Map<string, vscode.TextEditorDecorationType> = new Map(); // LRU cache: decorations by color string
    private readonly MAX_CACHE_SIZE = 100; // Limit cache size to prevent memory leak
    private detectedContexts: Set<string> = new Set(); // Track detected contexts (.light, .dark, etc.)

    public scanCssContentForColors(fileName: string, content: string): void {
        // Clear previous contexts for re-scanning
        this.detectedContexts.clear();
        this.contextualColorVariables.clear();
        
        const lines = content.split('\n');
        let bracketDepth = 0;
        const contextStack: Array<{name: string, depth: number}> = []; // Stack to track contexts with their depth
        
        // Pre-compile regex patterns outside loop for performance
        const contextPattern = /\.([\w-]+)\s*\{/;
        const dotsPattern = /\./g;
        const cssVarPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
        const openBracesPattern = /\{/g;
        const closeBracesPattern = /\}/g;
        
        lines.forEach((line) => {
            try {
                // Check for class selector pattern: .className {
                const contextMatch = line.match(contextPattern);
                
                if (contextMatch) {
                    const contextName = contextMatch[1];
                    // Count dots in the line - if only one, it's a simple selector
                    const dots = (line.match(dotsPattern) || []).length;
                    
                    if (dots === 1) {
                        // This is a single class selector like .light or .dark
                        this.detectedContexts.add(contextName);
                        // Add to context stack with current depth
                        contextStack.push({ name: contextName, depth: bracketDepth });
                    }
                }
            } catch (error) {
                // Skip this line if context detection fails
            }
            
            // Determine current context based on the stack
            const currentContext = contextStack.length > 0 
                ? contextStack[contextStack.length - 1].name 
                : 'global';
            
            try {
                // Find CSS variables in this line BEFORE updating bracket depth
                // Reset lastIndex for global regex reuse
                cssVarPattern.lastIndex = 0;
                let match;
                
                while ((match = cssVarPattern.exec(line)) !== null) {
                    const varName = match[1];
                    const value = match[2].trim();
                    const color = parseColorValue(value);

                    if (color) {
                        // Store with context information
                        if (!this.contextualColorVariables.has(varName)) {
                            this.contextualColorVariables.set(varName, new Map());
                        }
                        const contexts = this.contextualColorVariables.get(varName);
                        if (contexts) {
                            contexts.set(currentContext, { color, context: currentContext });
                        }
                        
                        // Also update global registry with last seen value
                        this.globalColorVariables.set(varName, color);
                    }
                }
            } catch (error) {
                // Skip this line if variable parsing fails
            }
            
            // Count braces and update depth AFTER processing variables
            const openBraces = (line.match(openBracesPattern) || []).length;
            const closeBraces = (line.match(closeBracesPattern) || []).length;
            
            bracketDepth += openBraces;
            
            // Remove contexts from stack when their closing brace is reached
            for (let i = 0; i < closeBraces; i++) {
                bracketDepth = Math.max(0, bracketDepth - 1); // Prevent negative depth in malformed CSS
                // Pop contexts that were opened at this depth or deeper
                while (contextStack.length > 0 && contextStack[contextStack.length - 1].depth >= bracketDepth) {
                    contextStack.pop();
                }
            }
        });
    }
    
    public scanCssFileForColors(document: vscode.TextDocument): void {
        const text = document.getText();
        this.scanCssContentForColors(document.fileName, text);
    }

    public updateDecorations(document: vscode.TextDocument): void {
        const text = document.getText();
        const lines = text.split('\n');
        
        // Use the global color variables (already context-aware from initial scan)
        // Don't re-scan here as it would lose context information
        const variableColors = this.colorVariables.get(document.uri.toString()) || new Map<string, ParsedColor>();
        
        // Only scan this document if it's the first time or if it's a CSS file that needs re-scanning
        if (variableColors.size === 0 && document.languageId === 'css') {
            // Re-scan with context awareness
            const content = document.getText();
            this.scanCssContentForColors(document.fileName, content);
            
            // After scanning, rebuild for current mode
            const config = vscode.workspace.getConfiguration('trueColors');
            const mode = config.get<string>('colorMode', 'auto');
            this.rebuildGlobalVariablesForMode(mode);
        }

        // Find the editor for this document (might not exist during init scan)
        const editor = vscode.window.visibleTextEditors.find(
            (e) => e.document.uri.toString() === document.uri.toString()
        );

        // If no editor visible, we've still updated the global registry
        if (!editor) {
            return;
        }

        // Clear existing decorations for this document
        this.clearDecorations(document.uri.toString());
        const decorations: ColorDecoration[] = [];

        // Pre-compile regex patterns outside loops for performance
        const cssVarPattern2 = /(--[\w-]+)\s*:\s*([^;]+);/g;
        const varPattern = /(?:var\((--[\w-]+)|(?:rgba?|hsla?)\s*\(\s*var\s*\(\s*(--[\w-]+))\s*\)/g;

        // Now add variable name decorations for CSS definitions
        lines.forEach((line, lineIndex) => {
            // Reset lastIndex for global regex reuse
            cssVarPattern2.lastIndex = 0;
            let match;
            
            while ((match = cssVarPattern2.exec(line)) !== null) {
                try {
                    const varName = match[1];
                    const value = match[2].trim();
                    // Use global color variables (context-aware)
                    const color = this.globalColorVariables.get(varName);

                    if (color) {
                        // Highlight the variable name
                        const varNameStart = match.index;
                        const varNameRange = new vscode.Range(lineIndex, varNameStart, lineIndex, varNameStart + varName.length);
                        decorations.push({ 
                            decoration: this.createDecoration(color, document, varNameRange), 
                            range: varNameRange, 
                            color 
                        });

                        // Highlight the value
                        const valueStart = match.index + match[0].indexOf(value);
                        const valueRange = new vscode.Range(lineIndex, valueStart, lineIndex, valueStart + value.length);
                        decorations.push({ 
                            decoration: this.createDecoration(color, document, valueRange), 
                            range: valueRange, 
                            color 
                        });
                    }
                } catch (error) {
                    // Skip this variable if processing fails
                    continue;
                }
            }
        });

        // Second pass: Find all var(--variable-name) usages
        lines.forEach((line, lineIndex) => {
            // Reset lastIndex for global regex reuse
            varPattern.lastIndex = 0;
            let match;
            
            while ((match = varPattern.exec(line)) !== null) {
                try {
                    const varName = match[1] || match[2];
                    if (!varName) continue;
                    
                    // Use global color variables (context-aware)
                    const color = this.globalColorVariables.get(varName);

                    if (color) {
                        const varNameStart = match.index + match[0].indexOf(varName);
                        const range = new vscode.Range(lineIndex, varNameStart, lineIndex, varNameStart + varName.length);
                        decorations.push({ 
                            decoration: this.createDecoration(color, document, range),
                            range,
                            color 
                        });
                    }
                } catch (error) {
                    // Skip this usage if processing fails
                    continue;
                }
            }
        });

        // Third pass: Find Tailwind classes in TypeScript/React files
        if (document.languageId === 'typescriptreact' || 
            document.languageId === 'javascriptreact' ||
            document.languageId === 'typescript' ||
            document.languageId === 'javascript') {
            
            // Pre-compile regex for better performance
            const stringPattern = /["']([^"']*(?:text-|bg-|border-|hover:|focus:)[^"']*)["']/g;
            const whitespacePattern = /\s+/;
            
            lines.forEach((line, lineIndex) => {
                let match;
                while ((match = stringPattern.exec(line)) !== null) {
                    const classString = match[1];
                    const classStringStart = match.index + 1; // +1 to skip opening quote
                    
                    // Split and process classes
                    const classes = classString.split(whitespacePattern);
                    
                    for (const cls of classes) {
                        if (!cls) continue;
                        
                        try {
                            // Find actual position in line (handles multiple spaces correctly)
                            const clsStart = line.indexOf(cls, classStringStart);
                            if (clsStart === -1) continue;
                            
                            const classInfo = parseTailwindClass(cls);
                            if (classInfo) {
                                const color = resolveTailwindColor(classInfo.colorName, this.globalColorVariables);
                                if (color) {
                                    const range = new vscode.Range(lineIndex, clsStart, lineIndex, clsStart + cls.length);
                                    decorations.push({ 
                                        decoration: this.createDecoration(color, document, range),
                                        range,
                                        color 
                                    });
                                }
                            }
                        } catch (error) {
                            // Skip this class if parsing fails
                            continue;
                        }
                    }
                }
                stringPattern.lastIndex = 0;
            });
        }

        // Store decorations for this document
        this.decorations.set(document.uri.toString(), decorations);

        // Group decorations by type for efficient application
        const decorationGroups = new Map<vscode.TextEditorDecorationType, vscode.Range[]>();
        decorations.forEach(({ decoration, range }) => {
            if (!decorationGroups.has(decoration)) {
                decorationGroups.set(decoration, []);
            }
            const ranges = decorationGroups.get(decoration);
            if (ranges) {
                ranges.push(range);
            }
        });

        // Apply all ranges for each decoration type at once
        decorationGroups.forEach((ranges, decoration) => {
            editor.setDecorations(decoration, ranges);
        });
    }

    private createDecoration(
        color: ParsedColor,
        document: vscode.TextDocument,
        range: vscode.Range
    ): vscode.TextEditorDecorationType {
        const colorString = toRgbaString(color);
        
        // Check if decoration already exists in cache (LRU)
        const cached = this.decorationCache.get(colorString);
        if (cached) {
            // Move to end (most recently used) - O(1) operation
            this.decorationCache.delete(colorString);
            this.decorationCache.set(colorString, cached);
            return cached;
        }
        
        // Calculate if the color is light or dark for text contrast
        const brightness = (color.red * 299 + color.green * 587 + color.blue * 114) / 1000;
        const isDark = brightness < 128;
        const textColor = isDark ? '#ffffff' : '#000000'; // Use white text on dark backgrounds, black on light

        // Create new decoration
        const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: colorString,
            color: textColor,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'}`,
            borderRadius: '3px',
            gutterIconPath: this.createColorIcon(colorString),
            gutterIconSize: 'contain',
        });

        // Store in cache with LRU eviction
        if (this.decorationCache.size >= this.MAX_CACHE_SIZE) {
            // Evict least recently used (first entry in Map) - O(1) operation
            const oldestKey = this.decorationCache.keys().next().value;
            if (oldestKey) {
                const oldDecoration = this.decorationCache.get(oldestKey);
                if (oldDecoration) {
                    oldDecoration.dispose();
                }
                this.decorationCache.delete(oldestKey);
            }
        }
        
        this.decorationCache.set(colorString, decoration);

        return decoration;
    }

    private createColorIcon(color: string): vscode.Uri {
        // Create SVG data URI for the color square
        const size = 16;
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
                <rect width="${size}" height="${size}" fill="${color}" stroke="#333" stroke-width="1" rx="2"/>
            </svg>
        `;
        const encoded = Buffer.from(svg).toString('base64');
        return vscode.Uri.parse(`data:image/svg+xml;base64,${encoded}`);
    }

    private clearDecorations(documentUri: string): void {
        const existingDecorations = this.decorations.get(documentUri);
        if (existingDecorations) {
            // Group decorations by decoration type to clear them efficiently
            const decorationGroups = new Map<vscode.TextEditorDecorationType, vscode.Range[]>();
            
            existingDecorations.forEach(({ decoration, range }) => {
                if (!decorationGroups.has(decoration)) {
                    decorationGroups.set(decoration, []);
                }
                const ranges = decorationGroups.get(decoration);
                if (ranges) {
                    ranges.push(range);
                }
            });
            
            // Clear all decoration types from the editor
            const editor = vscode.window.visibleTextEditors.find(
                (e) => e.document.uri.toString() === documentUri
            );
            if (editor) {
                decorationGroups.forEach((ranges, decoration) => {
                    editor.setDecorations(decoration, []);
                });
            }
        }
        this.decorations.delete(documentUri);
    }

    public clearDocumentColors(documentUri: string): void {
        // Clear decorations and color variables for a specific document
        this.clearDecorations(documentUri);
        this.colorVariables.delete(documentUri);
    }

    public getColorVariableCount(): number {
        return this.globalColorVariables.size;
    }

    public getGlobalColorVariables(): Map<string, ParsedColor> {
        return this.globalColorVariables;
    }
    
    public getDetectedContexts(): string[] {
        return Array.from(this.detectedContexts);
    }
    
    public getColorForMode(varName: string, mode: string): ParsedColor | undefined {
        const contexts = this.contextualColorVariables.get(varName);
        if (!contexts) return undefined;
        
        // Try to get color for specified mode
        const contextColor = contexts.get(mode);
        if (contextColor) return contextColor.color;
        
        // Fallback to any available color
        const firstContext = contexts.values().next().value;
        return firstContext?.color;
    }
    
    public rebuildGlobalVariablesForMode(mode: string): void {
        // Rebuild global color variables based on selected mode
        this.globalColorVariables.clear();
        
        this.contextualColorVariables.forEach((contexts, varName) => {
            let selectedColor: ParsedColor | undefined;
            
            if (mode === 'auto') {
                // Use last defined (current behavior)
                const allColors = Array.from(contexts.values());
                selectedColor = allColors[allColors.length - 1]?.color;
            } else {
                // Use specific mode (light or dark)
                const contextColor = contexts.get(mode);
                if (contextColor) {
                    selectedColor = contextColor.color;
                } else {
                    // Fallback to first available if mode not found
                    const firstContext = contexts.values().next().value;
                    selectedColor = firstContext?.color;
                }
            }
            
            if (selectedColor) {
                this.globalColorVariables.set(varName, selectedColor);
            }
        });
    }

    public dispose(): void {
        // Clean up all decorations
        this.decorations.forEach((decorations) => {
            decorations.forEach(({ decoration }) => {
                decoration.dispose();
            });
        });
        this.decorations.clear();
        this.colorVariables.clear();
        this.globalColorVariables.clear();
        
        // Dispose all cached decorations
        this.decorationCache.forEach((decoration) => {
            decoration.dispose();
        });
        this.decorationCache.clear();
    }
}
