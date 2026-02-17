import { tailwindColors, TailwindColor } from './tailwindColors';
import { ParsedColor } from './colorParser';

export interface TailwindClassInfo {
    type: string; // 'text', 'bg', 'border', etc.
    colorName: string; // 'red-500', 'txt-primary', etc.
}

// Tailwind color utility prefixes
const colorPrefixes = [
    'text',
    'bg',
    'border',
    'from',
    'to',
    'via',
    'ring',
    'divide',
    'decoration',
    'accent',
    'caret',
    'outline',
    'fill',
    'stroke',
];

/**
 * Parse a Tailwind class name to extract color information
 * Examples:
 * - text-red-500 → { type: 'text', colorName: 'red-500' }
 * - bg-txt-primary → { type: 'bg', colorName: 'txt-primary' }
 * - border-blue-200 → { type: 'border', colorName: 'blue-200' }
 * - hover:bg-slate-500/10 → { type: 'bg', colorName: 'slate-500' }
 */
export function parseTailwindClass(className: string): TailwindClassInfo | null {
    let trimmed = className.trim();
    
    // Remove state modifiers (hover:, focus:, active:, etc.) - handle multiple modifiers
    // hover:bg-red-500 → bg-red-500
    // md:hover:bg-red-500 → bg-red-500
    while (true) {
        const modifierPattern = /^(?:hover|focus|active|disabled|visited|checked|first|last|odd|even|group-hover|dark|sm|md|lg|xl|2xl):/;
        const match = trimmed.match(modifierPattern);
        if (!match) break;
        trimmed = trimmed.substring(match[0].length);
    }
    
    for (const prefix of colorPrefixes) {
        const pattern = new RegExp(`^${prefix}-(.+)$`);
        const match = trimmed.match(pattern);
        
        if (match) {
            let colorName = match[1];
            
            // Remove opacity modifiers like /50, /75
            // bg-red-500/50 → red-500
            colorName = colorName.split('/')[0];
            
            return {
                type: prefix,
                colorName: colorName,
            };
        }
    }
    
    return null;
}

/**
 * Resolve a Tailwind color to RGB values
 * Handles both standard Tailwind colors (red-500) and custom colors
 */
export function resolveTailwindColor(
    colorName: string,
    customColorMap: Map<string, ParsedColor>
): ParsedColor | null {
    // Try custom colors first (e.g., txt-primary, bg-card)
    // These come from tailwind.config.js and reference CSS variables
    
    // First try direct lookup
    let customColor = customColorMap.get(`--${colorName}`);
    if (customColor) {
        return customColor;
    }
    
    // Try with txt -> text mapping for nested structures
    if (colorName.startsWith('txt-')) {
        const mappedName = `--text-${colorName.substring(4)}`;
        customColor = customColorMap.get(mappedName);
        if (customColor) {
            return customColor;
        }
    }
    
    // Fuzzy matching for custom variables
    // Try to find a match by normalizing variable names
    for (const [key, value] of customColorMap.entries()) {
        const varName = key.startsWith('--') ? key.substring(2) : key;
        const normalizedVar = varName.toLowerCase().replace(/_/g, '-');
        const normalizedColor = colorName.toLowerCase().replace(/_/g, '-');
        
        if (normalizedVar === normalizedColor || 
            normalizedVar.endsWith(`-${normalizedColor}`) ||
            normalizedVar === normalizedColor.replace('txt-', 'text-') ||
            normalizedVar === normalizedColor.replace('bg-', 'bg-')) {
            return value;
        }
    }
    
    // Try standard Tailwind colors (e.g., red-500, blue-200)
    const tailwindParts = colorName.split('-');
    
    if (tailwindParts.length === 2) {
        const [color, shade] = tailwindParts;
        const tailwindColor = tailwindColors[color]?.[shade];
        
        if (tailwindColor) {
            return {
                red: tailwindColor.r,
                green: tailwindColor.g,
                blue: tailwindColor.b,
                originalText: colorName,
            };
        }
    }
    
    // Try color without shade (e.g., "red" defaults to 500)
    if (tailwindParts.length === 1) {
        const color = tailwindParts[0];
        const defaultShade = '500';
        const tailwindColor = tailwindColors[color]?.[defaultShade];
        
        if (tailwindColor) {
            return {
                red: tailwindColor.r,
                green: tailwindColor.g,
                blue: tailwindColor.b,
                originalText: colorName,
            };
        }
    }
    
    return null;
}

/**
 * Extract Tailwind class names from className attribute
 * Handles: className="text-red-500 bg-blue-200"
 * And: className={clsx("text-red-500", condition && "bg-blue")}
 */
export function extractTailwindClasses(text: string): string[] {
    const classes: string[] = [];
    
    // Match className="..." or className='...'
    const classNamePattern = /className\s*=\s*["']([^"']+)["']/g;
    let match;
    
    while ((match = classNamePattern.exec(text)) !== null) {
        const classString = match[1];
        // Split by spaces and filter out empty strings
        const individualClasses = classString.split(/\s+/).filter(c => c.length > 0);
        classes.push(...individualClasses);
    }
    
    // Also match individual quoted strings in className={clsx(...)}
    const quotedClassPattern = /["']([a-z]+-[a-z0-9-]+)["']/g;
    while ((match = quotedClassPattern.exec(text)) !== null) {
        const className = match[1];
        // Only add if it looks like a Tailwind class
        if (parseTailwindClass(className)) {
            classes.push(className);
        }
    }
    
    return classes;
}

/**
 * Find the position of a Tailwind class in a line of text
 * Returns the start and end character positions
 */
export function findTailwindClassPosition(
    line: string,
    targetClass: string
): { start: number; end: number } | null {
    // Look for the class in className attributes
    const patterns = [
        // className="...targetClass..."
        new RegExp(`className\\s*=\\s*["']([^"']*\\b${targetClass}\\b[^"']*)["']`),
        // className={clsx("...targetClass...")}
        new RegExp(`["']([^"']*\\b${targetClass}\\b[^"']*)["']`),
    ];
    
    for (const pattern of patterns) {
        const match = pattern.exec(line);
        if (match) {
            const fullMatch = match[0];
            const classString = match[1];
            const classStart = match.index + fullMatch.indexOf(classString);
            const targetStart = classStart + classString.indexOf(targetClass);
            
            return {
                start: targetStart,
                end: targetStart + targetClass.length,
            };
        }
    }
    
    return null;
}
