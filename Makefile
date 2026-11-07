PORT ?= 8765

.PHONY: start open stop

## Serve the app at http://localhost:$(PORT)
start:
	@echo "Global Quran → http://localhost:$(PORT)"
	@python3 -m http.server $(PORT)

## Serve and open in the default browser
open:
	@(sleep 1 && open http://localhost:$(PORT)) &
	@$(MAKE) start

## Stop a server left running on $(PORT)
stop:
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null || echo "nothing running on $(PORT)"
