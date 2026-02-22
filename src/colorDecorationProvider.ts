import * as vscode from 'vscode';
import { parseColorValue, toRgbaString, ParsedColor } from './colorParser';
import { parseTailwindClass, resolveTailwindColor } from './tailwindParser';

export interface ContextColor {
    context: string;
    color: ParsedColor;
}

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
    private globalColorVariables: Map<string, ParsedColor> = new Map(); // Global registry of all color variables
    private contextualColorVariables: Map<string, Map<string, ColorWithContext>> = new Map(); // varName -> context -> color
    private decorationCache: Map<string, vscode.TextEditorDecorationType> = new Map(); // LRU cache: decorations by color string
    private readonly MAX_CACHE_SIZE = 100; // Limit cache size to prevent memory leak
    private decorationStyle: string = vscode.workspace.getConfiguration('trueColors').get<string>('decorationStyle', 'highlight');
    private detectedContexts: Set<string> = new Set(); // Track detected contexts (.light, .dark, etc.)

    /**
     * Scan CSS content for color variables and context (.light, .dark, etc.).
     * @param merge When true, merge into existing context/variables (for multi-file initial scan).
     *              When false/omitted, clear first (for single-file update on save/file change).
     */
    public scanCssContentForColors(fileName: string, content: string, options?: { merge?: boolean }): void {
        if (options?.merge !== true) {
            this.detectedContexts.clear();
            this.contextualColorVariables.clear();
        }

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

        // If the global registry is empty (e.g. extension just activated on a CSS file
        // before the workspace scan completed), do a one-off merge scan so decorations
        // appear without wiping context data contributed by other CSS files.
        if (this.globalColorVariables.size === 0 && document.languageId === 'css') {
            const content = document.getText();
            this.scanCssContentForColors(document.fileName, content, { merge: true });
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
            cssVarPattern2.lastIndex = 0;
            let match;
            
            while ((match = cssVarPattern2.exec(line)) !== null) {
                try {
                    const varName = match[1];
                    const value = match[2].trim();
                    const color = this.globalColorVariables.get(varName);

                    if (color) {
                        const varNameStart = match.index;
                        const varNameRange = new vscode.Range(lineIndex, varNameStart, lineIndex, varNameStart + varName.length);
                        decorations.push({ decoration: this.createDecoration(color), range: varNameRange, color });

                        const valueStart = match.index + match[0].indexOf(value);
                        const valueRange = new vscode.Range(lineIndex, valueStart, lineIndex, valueStart + value.length);
                        decorations.push({ decoration: this.createDecoration(color), range: valueRange, color });
                    }
                } catch (error) {
                    continue;
                }
            }
        });

        // Second pass: Find all var(--variable-name) usages
        lines.forEach((line, lineIndex) => {
            varPattern.lastIndex = 0;
            let match;
            
            while ((match = varPattern.exec(line)) !== null) {
                try {
                    const varName = match[1] || match[2];
                    if (!varName) continue;
                    
                    const color = this.globalColorVariables.get(varName);

                    if (color) {
                        const varNameStart = match.index + match[0].indexOf(varName);
                        const range = new vscode.Range(lineIndex, varNameStart, lineIndex, varNameStart + varName.length);
                        decorations.push({ decoration: this.createDecoration(color), range, color });
                    }
                } catch (error) {
                    continue;
                }
            }
        });

        // Third pass: Find Tailwind classes in TypeScript/React files
        if (document.languageId === 'typescriptreact' || 
            document.languageId === 'javascriptreact' ||
            document.languageId === 'typescript' ||
            document.languageId === 'javascript') {
            
            const stringPattern = /["']([^"']*(?:text-|bg-|border-|hover:|focus:)[^"']*)["']/g;
            const whitespacePattern = /\s+/;
            
            lines.forEach((line, lineIndex) => {
                let match;
                while ((match = stringPattern.exec(line)) !== null) {
                    const classString = match[1];
                    const classStringStart = match.index + 1; // +1 to skip opening quote
                    
                    const classes = classString.split(whitespacePattern);
                    
                    for (const cls of classes) {
                        if (!cls) continue;
                        
                        try {
                            const clsStart = line.indexOf(cls, classStringStart);
                            if (clsStart === -1) continue;
                            
                            const classInfo = parseTailwindClass(cls);
                            if (classInfo) {
                                const color = resolveTailwindColor(classInfo.colorName, this.globalColorVariables);
                                if (color) {
                                    const range = new vscode.Range(lineIndex, clsStart, lineIndex, clsStart + cls.length);
                                    decorations.push({ 
                                        decoration: this.createDecoration(color),
                                        range,
                                        color 
                                    });
                                }
                            }
                        } catch (error) {
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

    private createDecoration(color: ParsedColor): vscode.TextEditorDecorationType {
        const colorString = toRgbaString(color);
        const cacheKey = `${this.decorationStyle}:${colorString}`;

        const cached = this.decorationCache.get(cacheKey);
        if (cached) {
            this.decorationCache.delete(cacheKey);
            this.decorationCache.set(cacheKey, cached);
            return cached;
        }

        const brightness = (color.red * 299 + color.green * 587 + color.blue * 114) / 1000;
        const isDark = brightness < 128;
        const borderColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';

        let decoration: vscode.TextEditorDecorationType;

        if (this.decorationStyle === 'patch') {
            const swatchUri = this.createSegmentedSwatchIcon([colorString]);
            decoration = vscode.window.createTextEditorDecorationType({
                before: {
                    contentIconPath: swatchUri,
                    margin: '0 0.3em 0 0',
                },
                gutterIconPath: this.createColorIcon(colorString),
                gutterIconSize: 'contain',
            });
        } else {
            // Default: highlight the whole token
            const textColor = isDark ? '#ffffff' : '#000000';
            decoration = vscode.window.createTextEditorDecorationType({
                backgroundColor: colorString,
                color: textColor,
                border: `1px solid ${borderColor}`,
                borderRadius: '3px',
                gutterIconPath: this.createColorIcon(colorString),
                gutterIconSize: 'contain',
            });
        }

        // LRU eviction
        if (this.decorationCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.decorationCache.keys().next().value;
            if (oldestKey) {
                const oldDecoration = this.decorationCache.get(oldestKey);
                if (oldDecoration) {
                    oldDecoration.dispose();
                }
                this.decorationCache.delete(oldestKey);
            }
        }
        
        this.decorationCache.set(cacheKey, decoration);
        return decoration;
    }

    public getContextualColorsMap(): Map<string, ContextColor[]> {
        const result = new Map<string, ContextColor[]>();
        this.contextualColorVariables.forEach((contexts, varName) => {
            result.set(varName, Array.from(contexts.entries())
                .map(([ctx, cwc]) => ({ context: ctx, color: cwc.color }))
                .sort((a, b) => a.context.localeCompare(b.context)));
        });
        return result;
    }

    public clearDecorationCache(): void {
        this.decorationCache.forEach((decoration) => {
            decoration.dispose();
        });
        this.decorationCache.clear();
        this.decorationStyle = vscode.workspace.getConfiguration('trueColors').get<string>('decorationStyle', 'highlight');
    }

    private createColorIcon(color: string): vscode.Uri {
        const size = 16;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${color}" stroke="#333" stroke-width="1" rx="2"/></svg>`;
        return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
    }

    private createSegmentedSwatchIcon(colorStrings: string[], segSize = 14): vscode.Uri {
        const n = colorStrings.length;
        const gap = 2; // gap between segments
        const totalW = n * segSize + (n - 1) * gap;
        const rects = colorStrings.map((cs, i) => {
            const x = i * (segSize + gap);
            return `<rect x="${x}" y="0" width="${segSize}" height="${segSize}" rx="2" fill="${cs}"/><rect x="${x}" y="0" width="${segSize}" height="${segSize}" rx="2" fill="none" stroke="rgba(128,128,128,0.5)" stroke-width="1"/>`;
        }).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${segSize}" viewBox="0 0 ${totalW} ${segSize}">${rects}</svg>`;
        return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
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
        this.clearDecorations(documentUri);
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
        this.globalColorVariables.clear();
        
        // Dispose all cached decorations
        this.decorationCache.forEach((decoration) => {
            decoration.dispose();
        });
        this.decorationCache.clear();
    }
}
