-- Ding Language Server setup for Neovim
--
-- Add this to your Neovim config (init.lua or a LazyVim plugin spec).
-- Requires: nvim-lspconfig, ding compiler installed and on PATH.
--
-- Quick setup:
--   1. Add editors/nvim/ to your runtimepath (for syntax + ftdetect)
--   2. Source or require this file for LSP support

-- Filetype detection
vim.filetype.add({ extension = { dg = "ding" } })

-- LSP config
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

if not configs.ding then
  configs.ding = {
    default_config = {
      cmd = { 'ding', 'lsp' },
      filetypes = { 'ding' },
      root_dir = lspconfig.util.find_git_ancestor,
      single_file_support = true,
      settings = {},
    },
  }
end

lspconfig.ding.setup({})
