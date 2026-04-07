# Ding Language Support for Neovim

Syntax highlighting and LSP integration for `.dg` files in Neovim.

## Prerequisites

- Neovim 0.8+
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) (for LSP)
- `ding` compiler installed and on PATH (`npm link` from the ding repo)

## Quick Setup

### 1. Add to runtimepath

Add this directory to your Neovim runtimepath. In your `init.lua`:

```lua
vim.opt.rtp:append('/path/to/ding/editors/nvim')
```

Or symlink into your Neovim config:

```bash
ln -s /path/to/ding/editors/nvim/ftdetect ~/.config/nvim/ftdetect
ln -s /path/to/ding/editors/nvim/syntax ~/.config/nvim/syntax
```

### 2. LSP setup

Add to your `init.lua` (or source `lsp.lua`):

```lua
dofile('/path/to/ding/editors/nvim/lsp.lua')
```

Or copy the contents into your LSP config.

## LazyVim Setup

Add a custom plugin spec in `~/.config/nvim/lua/plugins/ding.lua`:

```lua
return {
  {
    dir = "/path/to/ding/editors/nvim",
    ft = "ding",
    config = function()
      dofile("/path/to/ding/editors/nvim/lsp.lua")
    end,
  },
}
```

## Features

- **Syntax highlighting** — keywords, types, strings, template literals, comments, operators
- **Filetype detection** — `.dg` files automatically recognized
- **LSP support** — diagnostics (real-time error checking), completions, hover documentation, document symbols, go-to-definition

## Claude Code Integration

When using Claude Code in Neovim (via the CLI or the VS Code terminal), the LSP will automatically provide diagnostics and completions for `.dg` files. No additional configuration needed.
