# Every target runs in containers; make only saves typing. Without make
# (plain Windows), run the command under the target, or `bash scripts/verify.sh`.
.PHONY: up down test eval e2e e2e-update verify osm population

# Build, run the pipeline, and start the map and the chat.
up:
	docker compose up --build --detach --wait web api

down:
	docker compose down --remove-orphans

# The pipeline tests start the db; the API tests need `make up` first.
test:
	docker compose run --rm data python -m pytest -q -p no:cacheprovider tests
	docker compose run --rm --no-deps api python -m pytest -q -p no:cacheprovider tests

# The chat's labelled questions: off-topic refused, on-topic cite the right wards.
eval:
	docker compose run --rm --no-deps api python -m localio_api.evaluate

e2e:
	docker compose --profile test run --rm --build e2e

# Only after a deliberate layout change: rewrites the committed baselines.
e2e-update:
	docker compose --profile test run --rm --build e2e npx playwright test --update-snapshots

# Clean start to every check, with a summary.
verify:
	bash scripts/verify.sh

# Need network access; rewrite files in seed_data/.
osm:
	docker compose run --rm osm --refresh

population:
	docker compose run --rm population
