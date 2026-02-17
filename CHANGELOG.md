# Change Log

All notable changes to the "True Colors" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- `True Colors: Pick Color` - Open color picker for CSS variables
- `True Colors: Refresh Colors` - Manually refresh color cache
- `True Colors: Switch Color Mode` - Switch between light/dark/custom contexts

#### Configuration
- `trueColors.colorMode` - Select which CSS context to use (auto, light, dark, or custom)

[0.0.1]: https://github.com/aryak-lahane/true-colors/releases/tag/v0.0.1
