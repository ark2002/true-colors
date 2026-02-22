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

// Pre-compiled per-prefix patterns (avoids RegExp construction on every parseTailwindClass call)
const prefixPatterns: Array<{ prefix: string; pattern: RegExp }> = colorPrefixes.map((prefix) => ({
    prefix,
    pattern: new RegExp(`^${prefix}-(.+)$`),
}));

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
    
    for (const { prefix, pattern } of prefixPatterns) {
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

// Normalized lookup map built lazily from the custom color map — avoids O(n) fuzzy loops.
let normalizedMapCache: Map<string, ParsedColor> | undefined;
let normalizedMapSource: Map<string, ParsedColor> | undefined;

function buildNormalizedMap(customColorMap: Map<string, ParsedColor>): Map<string, ParsedColor> {
    if (normalizedMapCache && normalizedMapSource === customColorMap) {
        return normalizedMapCache;
    }
    const normalized = new Map<string, ParsedColor>();
    for (const [key, value] of customColorMap.entries()) {
        const varName = key.startsWith('--') ? key.substring(2) : key;
        normalized.set(varName.toLowerCase().replace(/_/g, '-'), value);
    }
    normalizedMapCache = normalized;
    normalizedMapSource = customColorMap;
    return normalized;
}

/**
 * Resolve a Tailwind color to RGB values
 * Handles both standard Tailwind colors (red-500) and custom colors
 */
export function resolveTailwindColor(
    colorName: string,
    customColorMap: Map<string, ParsedColor>
): ParsedColor | null {
    // Direct lookup
    let customColor = customColorMap.get(`--${colorName}`);
    if (customColor) {
        return customColor;
    }

    // txt- → text- mapping
    if (colorName.startsWith('txt-')) {
        customColor = customColorMap.get(`--text-${colorName.substring(4)}`);
        if (customColor) {
            return customColor;
        }
    }

    // Normalized fuzzy lookup via pre-built map (O(1) instead of O(n))
    const normalizedMap = buildNormalizedMap(customColorMap);
    const normalizedColor = colorName.toLowerCase().replace(/_/g, '-');
    customColor = normalizedMap.get(normalizedColor)
        ?? normalizedMap.get(normalizedColor.replace('txt-', 'text-'));
    if (customColor) {
        return customColor;
    }

    // Standard Tailwind palette (e.g., red-500, blue-200)
    const dashIdx = colorName.lastIndexOf('-');
    if (dashIdx !== -1) {
        const color = colorName.substring(0, dashIdx);
        const shade = colorName.substring(dashIdx + 1);
        const tailwindColor = tailwindColors[color]?.[shade];
        if (tailwindColor) {
            return { red: tailwindColor.r, green: tailwindColor.g, blue: tailwindColor.b, originalText: colorName };
        }
    }

    // Single-word color defaults to shade 500
    const tailwindColor = tailwindColors[colorName]?.['500'];
    if (tailwindColor) {
        return { red: tailwindColor.r, green: tailwindColor.g, blue: tailwindColor.b, originalText: colorName };
    }

    return null;
}

