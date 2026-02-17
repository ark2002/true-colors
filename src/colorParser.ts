export interface ParsedColor {
    red: number;
    green: number;
    blue: number;
    alpha?: number;
    originalText: string;
}

/**
 * Parses CSS custom property values in RGB/RGBA format
 * Supports formats like:
 * - "248 250 252" (RGB)
 * - "87 91 239 / 0.2" (RGBA with alpha)
 */
export function parseColorValue(text: string): ParsedColor | null {
    // Match RGB format: "248 250 252" or RGBA format: "87 91 239 / 0.2"
    const rgbPattern = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*$/;
    const match = text.match(rgbPattern);

    if (!match) {
        return null;
    }

    const red = parseInt(match[1], 10);
    const green = parseInt(match[2], 10);
    const blue = parseInt(match[3], 10);
    const alpha = match[4] ? parseFloat(match[4]) : undefined;

    // Validate RGB values are in range 0-255
    if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
        return null;
    }

    // Validate alpha if present (0-1)
    if (alpha !== undefined && (alpha < 0 || alpha > 1)) {
        return null;
    }

    return {
        red,
        green,
        blue,
        alpha,
        originalText: text.trim()
    };
}

/**
 * Converts ParsedColor to CSS rgba() string
 */
export function toRgbaString(color: ParsedColor): string {
    const alpha = color.alpha !== undefined ? color.alpha : 1;
    return `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}

/**
 * Converts ParsedColor to hex string
 */
export function toHexString(color: ParsedColor): string {
    const r = color.red.toString(16).padStart(2, '0');
    const g = color.green.toString(16).padStart(2, '0');
    const b = color.blue.toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

/**
 * Converts hex color to RGB format string
 */
export function hexToRgb(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return null;
    }
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `${r} ${g} ${b}`;
}

/**
 * Formats color value with optional alpha
 */
export function formatColorValue(red: number, green: number, blue: number, alpha?: number): string {
    if (alpha !== undefined && alpha < 1) {
        return `${red} ${green} ${blue} / ${alpha}`;
    }
    return `${red} ${green} ${blue}`;
}
