.PHONY: build binary link test clean lsp

build:
	npx tsc --outDir dist

binary:
	bun build src/cli/index.ts --compile --outfile ding-bin

link:
	npm run build && npm link

test:
	pnpm vitest run

lsp:
	node dist/lsp/server.js

clean:
	rm -rf dist/ ding-bin
