.PHONY: pack

pack:
	pnpm install
	pnpm pack
	npm install -g "$$PWD/$$(ls -t *.tgz | head -n1)"
