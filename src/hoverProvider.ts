import * as vscode from 'vscode';
import { toRgbaString, ParsedColor } from './colorParser';
import { parseTailwindClass, resolveTailwindColor } from './tailwindParser';
import { ContextColor } from './colorDecorationProvider';

export class CssVariableHoverProvider implements vscode.HoverProvider {
    private contextualColorVariables: Map<string, ContextColor[]> = new Map();

    constructor(private globalColorVariables: Map<string, ParsedColor>) {}

    private swatchMd(colorString: string, size = 14): string {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="2" fill="${colorString}"/><rect width="${size}" height="${size}" rx="2" fill="none" stroke="rgba(128,128,128,0.4)" stroke-width="1"/></svg>`;
        const b64 = Buffer.from(svg).toString('base64');
        return `![](data:image/svg+xml;base64,${b64})`;
    }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const line = document.lineAt(position.line).text;
        
        // First, try to match CSS variable
        const varName = this.getVariableNameAtPosition(line, position.character);
        if (varName) {
            const color = this.globalColorVariables.get(varName);
            if (color) {
                const contextColors = this.contextualColorVariables.get(varName);
                return this.createCssVariableHover(varName, color, contextColors);
            }
        }
        
        // Second, try to match Tailwind class
        const tailwindClass = this.getTailwindClassAtPosition(line, position.character);
        if (tailwindClass) {
            const classInfo = parseTailwindClass(tailwindClass);
            if (classInfo) {
                const color = resolveTailwindColor(classInfo.colorName, this.globalColorVariables);
                if (color) {
                    // Try to find the underlying CSS variable so we can show context info
                    const resolvedVarName = this.findResolvedCssVar(classInfo.colorName);
                    const contextColors = resolvedVarName
                        ? this.contextualColorVariables.get(resolvedVarName)
                        : undefined;
                    return this.createTailwindClassHover(tailwindClass, classInfo, color, contextColors);
                }
            }
        }

        return undefined;
    }

    private createCssVariableHover(varName: string, color: ParsedColor, contextColors?: ContextColor[]): vscode.Hover {
        const colorString = toRgbaString(color);

        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = true;

        markdown.appendMarkdown(`**CSS Variable**: \`${varName}\`\n\n`);

        if (contextColors && contextColors.length > 0) {
            for (const { context, color: ctxColor } of contextColors) {
                const cs = toRgbaString(ctxColor);
                const rs = ctxColor.alpha !== undefined
                    ? `${ctxColor.red} ${ctxColor.green} ${ctxColor.blue} / ${ctxColor.alpha}`
                    : `${ctxColor.red} ${ctxColor.green} ${ctxColor.blue}`;
                const isActive = cs === colorString;
                const label = context === 'global' ? `global` : `.${context}`;
                const activeMark = isActive ? ' *(active)*' : '';
                markdown.appendMarkdown(`**${label}**${activeMark} &nbsp;${this.swatchMd(cs)} \`${rs}\`\n\n`);
            }
        } else {
            const rgbString = color.alpha !== undefined
                ? `${color.red} ${color.green} ${color.blue} / ${color.alpha}`
                : `${color.red} ${color.green} ${color.blue}`;
            markdown.appendMarkdown(`${this.swatchMd(colorString)} \`${rgbString}\``);
        }

        return new vscode.Hover(markdown);
    }

    private createTailwindClassHover(
        className: string,
        classInfo: { type: string; colorName: string },
        color: ParsedColor,
        contextColors?: ContextColor[]
    ): vscode.Hover {
        const colorString = toRgbaString(color);

        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = true;

        markdown.appendMarkdown(`**Tailwind Class**: \`${className}\` · *${classInfo.type}*\n\n`);

        if (contextColors && contextColors.length > 0) {
            for (const { context, color: ctxColor } of contextColors) {
                const cs = toRgbaString(ctxColor);
                const rs = ctxColor.alpha !== undefined
                    ? `${ctxColor.red} ${ctxColor.green} ${ctxColor.blue} / ${ctxColor.alpha}`
                    : `${ctxColor.red} ${ctxColor.green} ${ctxColor.blue}`;
                const isActive = cs === colorString;
                const label = context === 'global' ? `global` : `.${context}`;
                const activeMark = isActive ? ' *(active)*' : '';
                markdown.appendMarkdown(`**${label}**${activeMark} &nbsp;${this.swatchMd(cs)} \`${rs}\`\n\n`);
            }
        } else {
            const rgbString = color.alpha !== undefined
                ? `${color.red} ${color.green} ${color.blue} / ${color.alpha}`
                : `${color.red} ${color.green} ${color.blue}`;
            markdown.appendMarkdown(`${this.swatchMd(colorString)} \`${rgbString}\``);
        }

        return new vscode.Hover(markdown);
    }

    private findResolvedCssVar(colorName: string): string | undefined {
        // Mirror the lookup order in resolveTailwindColor to find the CSS variable name
        const candidates = [
            `--${colorName}`,
            colorName.startsWith('txt-') ? `--text-${colorName.substring(4)}` : null,
        ].filter(Boolean) as string[];

        for (const candidate of candidates) {
            if (this.contextualColorVariables.has(candidate)) {
                return candidate;
            }
        }

        // Fuzzy match: find a contextual variable whose name ends with the color name
        const normalizedColor = colorName.toLowerCase().replace(/_/g, '-');
        for (const key of this.contextualColorVariables.keys()) {
            const varName = key.startsWith('--') ? key.substring(2) : key;
            const normalized = varName.toLowerCase().replace(/_/g, '-');
            if (normalized === normalizedColor || normalized.endsWith(`-${normalizedColor}`)) {
                return key;
            }
        }

        return undefined;
    }

    private getVariableNameAtPosition(line: string, character: number): string | null {
        // Match patterns: var(--name), rgba(var(--name)), etc.
        const patterns = [
            /var\s*\(\s*(--[\w-]+)/g,
            /rgba?\s*\(\s*var\s*\(\s*(--[\w-]+)/g,
            /hsla?\s*\(\s*var\s*\(\s*(--[\w-]+)/g,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                const varName = match[1];
                const start = match.index + match[0].indexOf(varName);
                const end = start + varName.length;

                if (character >= start && character <= end) {
                    return varName;
                }
            }
            pattern.lastIndex = 0;
        }

        // Match CSS variable definitions: --varname: value;
        // Covers both hovering on the name and on the value.
        const defPattern = /(--[\w-]+)\s*:\s*([^;]+);?/g;
        let match;
        while ((match = defPattern.exec(line)) !== null) {
            const varName = match[1];
            const nameStart = match.index;
            const nameEnd = nameStart + varName.length;
            // Cursor is on the variable name
            if (character >= nameStart && character <= nameEnd) {
                return varName;
            }
            // Cursor is on the value portion
            const valueStart = nameStart + match[0].indexOf(match[2]);
            const valueEnd = valueStart + match[2].trimEnd().length;
            if (character >= valueStart && character <= valueEnd) {
                return varName;
            }
        }

        return null;
    }

    private getTailwindClassAtPosition(line: string, character: number): string | null {
        // Extract word at position
        const wordRange = this.getWordRangeAtPosition(line, character);
        if (!wordRange) {
            return null;
        }
        
        const word = line.substring(wordRange.start, wordRange.end);
        
        // Check if it's a valid Tailwind class
        if (parseTailwindClass(word)) {
            return word;
        }
        
        return null;
    }

    private getWordRangeAtPosition(line: string, character: number): { start: number; end: number } | null {
        // Find word boundaries (alphanumeric, hyphens, underscores)
        let start = character;
        let end = character;
        
        // Move start backwards
        while (start > 0 && /[a-zA-Z0-9\-_]/.test(line[start - 1])) {
            start--;
        }
        
        // Move end forwards
        while (end < line.length && /[a-zA-Z0-9\-_]/.test(line[end])) {
            end++;
        }
        
        if (start === end) {
            return null;
        }
        
        return { start, end };
    }

    public updateGlobalVariables(variables: Map<string, ParsedColor>): void {
        this.globalColorVariables = variables;
    }

    public updateContextualVariables(contextualVars: Map<string, ContextColor[]>): void {
        this.contextualColorVariables = contextualVars;
    }
}
