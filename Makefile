.PHONY: pack debug-storage

pack:
	pnpm install
	pnpm pack
	npm install -g "$$PWD/$$(ls -t *.tgz | head -n1)"

debug-storage:
	pnpm exec tsx debug.ts
