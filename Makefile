# Every target runs in containers; make only saves typing. Without make
# (plain Windows), run the command under the target, or `bash scripts/verify.sh`.
.PHONY: up down test e2e e2e-update verify osm population

# Build, run the pipeline and start the site at http://localhost:8080.
up:
	docker compose up --build --detach --wait web

down:
	docker compose down --remove-orphans

# Pipeline tests; they start the database themselves.
test:
	docker compose run --rm data python -m pytest -q -p no:cacheprovider tests

# Browser tests: the flow, the chat's labelled questions and the visuals.
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
