# True Colors

[![Version](https://img.shields.io/visual-studio-marketplace/v/aryak-lahane.true-colors?color=blue&label=version)](https://marketplace.visualstudio.com/items?itemName=aryak-lahane.true-colors)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/aryak-lahane.true-colors?color=success&label=vs%20installs)](https://marketplace.visualstudio.com/items?itemName=aryak-lahane.true-colors)
[![Open VSX Installs](https://img.shields.io/open-vsx/dt/aryak-lahane/true-colors?color=blueviolet&label=open%20vsx)](https://open-vsx.org/extension/aryak-lahane/true-colors)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/aryak-lahane.true-colors?color=yellow)](https://marketplace.visualstudio.com/items?itemName=aryak-lahane.true-colors)
[![License](https://img.shields.io/github/license/ark2002/true-colors?color=orange)](https://github.com/ark2002/true-colors/blob/main/LICENSE)

A VSCode extension that displays color previews for CSS custom properties (variables) that use RGB or RGBA format.

## Features

- 🎨 **Color Background Highlighting**: Shows colored backgrounds for CSS variables and Tailwind classes
- 🟥 **Decoration Style Choice**: Display colors as a full highlight or a small inline color swatch
- 💡 **Hover Tooltips**: Rich per-context tooltips showing color swatches and RGB values for every detected context (`.light`, `.dark`, etc.) — works on definition lines and usages alike
- 🎯 **Tailwind CSS Support**: Detects and shows colors for Tailwind utility classes
- 🌓 **Multi-Context Support**: Detect and switch between light/dark/custom color modes
- 🗂️ **File Type Control**: Choose where decorations appear (`css`, `ts`, `tsx`, `js`, `jsx`)
- 🔄 **Auto-Refresh**: Updates when CSS files change, preserving multi-file context data
- ⚡ **Optimized Performance**: esbuild bundling, debounced updates, LRU caching, pre-compiled patterns, O(1) color lookups
- 🌐 **VSCode Web Compatible**: Works on github.dev and vscode.dev
- 📁 **Multi-File Support**: Works in TypeScript, React, JavaScript, and CSS files

## Supported Formats

### 1. CSS Variable Definitions
```css
/* RGB format (space-separated) */
--neutral-bg: 248 250 252;

/* RGBA format (with opacity using /) */
--topologyHighlightPulse: 87 91 239 / 0.2;
```

### 2. CSS Variable Usage
```css
/* Direct usage */
background: var(--neutral-bg);

/* Wrapped in color functions */
fill: rgba(var(--content-highlight));
stroke: rgb(var(--neutral-outline));
```

```tsx
// In React/TypeScript files
<div style={{ background: 'var(--neutral-bg)' }} />
<rect fill="rgba(var(--content-highlight))" />
```

### 3. Tailwind CSS Classes (NEW! ✨)
```tsx
// Standard Tailwind colors
<div className="text-red-500 bg-blue-200 border-green-300">
//              ^^^^^^^^^^^^ - Shows red color
//                           ^^^^^^^^^^^ - Shows blue color
//                                        ^^^^^^^^^^^^^^^^ - Shows green color

// Custom Tailwind colors (from your tailwind.config.js)
<div className="text-txt-primary bg-card border-separator">
//              ^^^^^^^^^^^^^^^^ - Shows your custom color
//                               ^^^^^^^ - Shows your custom color
//                                        ^^^^^^^^^^^^^^^^^ - Shows your custom color

// Gradient colors
<div className="from-purple-500 to-pink-500">
//              ^^^^^^^^^^^^^^^ - Shows purple
//                              ^^^^^^^^^^^ - Shows pink
```

**Supported Tailwind prefixes:**
- `text-` - Text colors
- `bg-` - Background colors
- `border-` - Border colors
- `from-`, `to-`, `via-` - Gradient colors
- `ring-` - Ring colors
- `divide-` - Divider colors
- `decoration-`, `accent-`, `caret-`, `outline-` - Other color utilities
- `fill-`, `stroke-` - SVG colors

## Usage

1. Open any CSS file containing CSS custom properties
2. Color squares will automatically appear in the gutter and inline for detected color variables and Tailwind classes
3. Hover over a variable name, its value, or a `var(--name)` usage to see the resolved color in a tooltip — with per-context swatches if `.light`/`.dark` contexts are defined

### Multi-Context Support (Light/Dark Mode)

If your CSS has colors defined in different contexts:

```css
.light {
  --text-primary: 51 65 85;     /* Dark text for light backgrounds */
}

.dark {
  --text-primary: 226 232 240;  /* Light text for dark backgrounds */
}
```

**Switch between contexts:**
1. Press `Cmd+Shift+P`
2. Type "True Colors: Switch Color Mode"
3. Select: `auto`, `light`, `dark`, or any detected context
4. All colors update instantly!

**Or use Settings:**
- Open Settings (`Cmd+,`)
- Search "True Colors"
- Set **Color Mode** to your preferred context

The extension automatically detects ANY class-based contexts (`.theme-blue`, `.mobile`, `.print`, etc.)

### File Type Selection

Control which file types receive decorations:

**Command palette flow (recommended):**
1. Press `Cmd+Shift+P`
2. Run `True Colors: Switch File Types`
3. Toggle file types (`css`, `ts`, `tsx`, `js`, `jsx`)
4. Changes apply instantly

**Settings flow:**
- Open Settings (`Cmd+,`)
- Search `trueColors.enabledLanguages`
- Set a subset such as:

```json
"trueColors.enabledLanguages": ["css", "tsx", "jsx"]
```

Supported values:
- `css`
- `ts`
- `tsx`
- `js`
- `jsx`

### Decoration Style

Choose how color decorations are rendered next to your code:

- **`highlight`** (default) — the entire token is filled with the color as its background, with contrasting text so it stays readable.
- **`patch`** — a small square color swatch appears inline *before* the token; the text itself stays completely unstyled.

**Command palette flow (recommended):**
1. Press `Cmd+Shift+P`
2. Run `True Colors: Switch Decoration Style`
3. Pick `highlight` or `patch`
4. Style updates instantly across all open editors

**Settings flow:**
- Open Settings (`Cmd+,`)
- Search `trueColors.decorationStyle`
- Set the value:

```json
"trueColors.decorationStyle": "patch"
```

## Installation

### From VSIX File

```bash
code --install-extension true-colors-0.0.4.vsix
```

Or via VSCode: Extensions → `...` → Install from VSIX

### From Source

1. Clone or download this extension
2. Run `npm install` to install dependencies
3. Run `npm run esbuild:prod` to build with esbuild
4. Run `npm run package` to create the VSIX file
5. Install the generated `.vsix` file

## Development

```bash
# Install dependencies
npm install

# Build with esbuild (development)
npm run esbuild

# Watch mode for development (auto-rebuild on changes)
npm run watch

# Build for production (minified)
npm run esbuild:prod

# Package extension for distribution
npm run package

# Test the extension
Press F5 in VSCode
```

## Build System

This extension uses **esbuild** for fast, optimized bundling:
- ⚡ **600x faster builds** compared to traditional TypeScript compilation
- 📦 **85% smaller bundle size** - from 140KB (12 files) to 20KB (1 file)
- 🌐 **VSCode Web compatible** - works on github.dev and vscode.dev
- 🔥 **Hot reload** - instant rebuilds during development

## Contributing

Contributions are welcome! If you'd like to contribute:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Issues & Feature Requests

Found a bug or have a feature request? Please [open an issue](https://github.com/ark2002/true-colors/issues) on GitHub.

## Support

If you find this extension helpful, please:
- ⭐ Star the [repository](https://github.com/ark2002/true-colors)
- 📝 Leave a review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=aryak-lahane.true-colors)
- 🐛 Report issues to help improve the extension

## Author

**Aryak Lahane**

- GitHub: [@ark2002](https://github.com/ark2002)

## License

MIT - see [LICENSE](LICENSE) file for details
