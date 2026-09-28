# Every target runs in containers; make only saves typing. Without make
# (plain Windows), run the command after the colon, or `bash scripts/verify.sh`.
.PHONY: up down test eval e2e e2e-update verify catchments

up:
	docker compose up --build --detach --wait web api

down:
	docker compose down --remove-orphans

# Needs the pipeline's output, so run `make up` first.
test:
	docker compose run --rm --no-deps data python -m pytest -q -p no:cacheprovider tests
	docker compose run --rm --no-deps api python -m pytest -q -p no:cacheprovider tests

eval:
	docker compose run --rm --no-deps api python -m localio_api.evaluate

e2e:
	docker compose --profile test run --rm --build e2e

# Only after a deliberate layout change: rewrites the committed baselines.
e2e-update:
	docker compose --profile test run --rm --build e2e npx playwright test --update-snapshots

verify:
	bash scripts/verify.sh

# Needs network access; rebuilds seed_data/catchments.geojson.
catchments:
	docker compose run --rm catchments
