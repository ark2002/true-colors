# Change Log

All notable changes to the "True Colors" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-02-22

### Added
- **Decoration Style**: New `trueColors.decorationStyle` setting with two modes:
  - `highlight` (default) — fills the entire token with the color as a background.
  - `patch` — shows a small inline color swatch before the token; text is left unstyled.
- **New command**: `True Colors: Switch Decoration Style` — switch decoration style from the Command Palette.
- **Rich hover tooltips**: Hovering over a CSS variable now shows a per-context breakdown (e.g. `.light` / `.dark`) with an inline color swatch and RGB value for each context, and marks the currently active one.
- **Hover on definition lines**: Tooltips now appear when hovering over a CSS variable **name** or **value** in its definition (e.g. `--text-primary: 51 65 85;`), not only on `var(--name)` usages.

### Fixed
- **Multi-file context data wiped on save**: Saving or changing any CSS file previously cleared context data contributed by other CSS files (e.g. `.light` vars in `theme.css` were lost when `globals.css` was saved). The save and file-watcher handlers now re-scan all CSS files so every file's context data is preserved.
- **`getConfiguration` called per decoration render**: The decoration style setting was read inside the per-token `createDecoration` call, resulting in hundreds of redundant config reads per file update. The style is now stored as a class field and refreshed only when the setting actually changes.

### Performance
- **Tailwind regex pre-compilation**: `parseTailwindClass` previously constructed 13 `RegExp` objects on every call. Patterns are now compiled once at module load.
- **Tailwind fuzzy lookup O(1)**: `resolveTailwindColor` previously iterated the entire CSS variable map for each unrecognized Tailwind color name. A normalized lookup map is now built once and reused, making fuzzy matches O(1).
- **Enabled-languages cache**: `getEnabledLanguages` (called on every keystroke, editor switch, and refresh) previously triggered two `getConfiguration` reads. The result is now cached and only invalidated when the `trueColors.enabledLanguages` setting changes.

### Removed
- Dead code: `extractTailwindClasses`, `findTailwindClassPosition` (exported but never called).
- Dead code: `toHexString`, `hexToRgb`, `formatColorValue` (exported but never called).
- Dead internal state: `colorVariables` map (declared but never written to) and `variableColors` local variable (computed but immediately discarded).

## [0.0.3] - 2026-02-20

### Added
- **File type filtering for decorations** via `trueColors.enabledLanguages` with supported values: `css`, `ts`, `tsx`, `js`, `jsx`.
- **New command**: `True Colors: Switch File Types` for interactive file type selection.

### Changed
- Improved file type selection UX to avoid flicker and keep selection stable while toggling.
- Updated default behavior to keep decorations enabled across all supported file types unless customized.

## [0.0.2] - 2026-02-17

### Removed
- **Pick Color command** - Removed the "True Colors: Pick Color" command and its Quick Pick / input flow. The extension now focuses on color previews and hover tooltips only.

## [0.0.1] - 2026-02-17

### Initial Release

#### Added
- 🎨 **Color Background Highlighting** - Visual color previews for CSS custom properties
- 💡 **Hover Tooltips** - Detailed color information on hover
- 🎯 **Tailwind CSS Support** - Color previews for Tailwind utility classes
  - Supports standard colors (red-500, blue-200, etc.)
  - Supports custom Tailwind colors from config
  - Works with text-, bg-, border-, from-, to-, via-, ring-, divide-, fill-, stroke- prefixes
- 🌓 **Multi-Context Support** - Switch between light/dark/custom color modes
  - Auto-detect CSS class contexts (.light, .dark, etc.)
  - Quick command to switch between contexts
  - Settings integration for persistent mode selection
- 🔄 **Auto-Refresh** - Automatic updates when CSS files change
- ⚡ **Performance Optimizations**
  - esbuild bundling for fast builds (3ms)
  - LRU decoration cache for efficient rendering
  - Debounced updates (500ms) for smooth typing experience
  - Pre-compiled regex patterns
  - File size limits (1MB) for large codebases
- 🌐 **VSCode Web Compatible** - Works on github.dev and vscode.dev
- 📁 **Multi-File Support** - Works across TypeScript, React, JavaScript, and CSS files

#### Supported Formats
- RGB format: `--neutral-bg: 248 250 252;`
- RGBA format: `--highlight: 87 91 239 / 0.2;`
- CSS variable usage: `background: var(--neutral-bg);`
- Wrapped in color functions: `fill: rgba(var(--content-highlight));`
- Tailwind classes: `text-red-500 bg-blue-200 border-green-300`

#### Commands
- `True Colors: Refresh Colors` - Manually refresh color cache
- `True Colors: Switch Color Mode` - Switch between light/dark/custom contexts

#### Configuration
- `trueColors.colorMode` - Select which CSS context to use (auto, light, dark, or custom)

[0.0.1]: https://github.com/ark2002/true-colors/releases/tag/v0.0.1
[0.0.2]: https://github.com/ark2002/true-colors/releases/tag/v0.0.2
[0.0.3]: https://github.com/ark2002/true-colors/releases/tag/v0.0.3
[0.0.4]: https://github.com/ark2002/true-colors/releases/tag/v0.0.4
