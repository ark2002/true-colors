import * as vscode from 'vscode';
import { parseColorValue, toRgbaString, ParsedColor } from './colorParser';
import { parseTailwindClass, resolveTailwindColor } from './tailwindParser';

export class CssVariableHoverProvider implements vscode.HoverProvider {
    constructor(private globalColorVariables: Map<string, ParsedColor>) {}

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
                return this.createCssVariableHover(varName, color);
            }
        }
        
        // Second, try to match Tailwind class
        const tailwindClass = this.getTailwindClassAtPosition(line, position.character);
        if (tailwindClass) {
            const classInfo = parseTailwindClass(tailwindClass);
            if (classInfo) {
                const color = resolveTailwindColor(classInfo.colorName, this.globalColorVariables);
                if (color) {
                    return this.createTailwindClassHover(tailwindClass, classInfo, color);
                }
            }
        }

        return undefined;
    }

    private createCssVariableHover(varName: string, color: ParsedColor): vscode.Hover {
        const colorString = toRgbaString(color);
        const rgbString = color.alpha !== undefined 
            ? `${color.red} ${color.green} ${color.blue} / ${color.alpha}`
            : `${color.red} ${color.green} ${color.blue}`;

        const colorBox = `<span style="display:inline-block;width:12px;height:12px;background:${colorString};border:1px solid #ccc;margin-right:4px;"></span>`;
        
        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = true;
        
        markdown.appendMarkdown(`**CSS Variable**: \`${varName}\`\n\n`);
        markdown.appendMarkdown(`**Value**: \`${rgbString}\`\n\n`);
        markdown.appendMarkdown(`**Color**: ${colorBox} ${colorString}`);

        return new vscode.Hover(markdown);
    }

    private createTailwindClassHover(
        className: string,
        classInfo: { type: string; colorName: string },
        color: ParsedColor
    ): vscode.Hover {
        const colorString = toRgbaString(color);
        const rgbString = color.alpha !== undefined 
            ? `${color.red} ${color.green} ${color.blue} / ${color.alpha}`
            : `${color.red} ${color.green} ${color.blue}`;

        const colorBox = `<span style="display:inline-block;width:12px;height:12px;background:${colorString};border:1px solid #ccc;margin-right:4px;"></span>`;
        
        const markdown = new vscode.MarkdownString();
        markdown.supportHtml = true;
        markdown.isTrusted = true;
        
        markdown.appendMarkdown(`**Tailwind Class**: \`${className}\`\n\n`);
        markdown.appendMarkdown(`**Type**: ${classInfo.type}\n\n`);
        markdown.appendMarkdown(`**Value**: \`${rgbString}\`\n\n`);
        markdown.appendMarkdown(`**Color**: ${colorBox} ${colorString}`);

        return new vscode.Hover(markdown);
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

                // Check if cursor is within the variable name
                if (character >= start && character <= end) {
                    return varName;
                }
            }
            pattern.lastIndex = 0;
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
}
