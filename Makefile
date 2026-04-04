.PHONY: build binary link test clean

build:
	npx tsc --outDir dist

binary:
	bun build src/cli/index.ts --compile --outfile ding-bin

link:
	npm run build && npm link

test:
	pnpm vitest run

clean:
	rm -rf dist/ ding-bin
