# SurgeGuard developer commands. Requires bash (Git Bash on Windows), Docker with Compose v2, Node 22.
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

COMPOSE := docker compose
TEST_COMPOSE := docker compose -p surgeguard-test -f docker-compose.test.yml
export MSYS_NO_PATHCONV := 1

.PHONY: help setup up down logs ps health test test-backend test-frontend test-proxy lint loadtest demo \
        e2e dashboards terraform-validate validate-config clean alert-check

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[1m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Generate .env with fresh secrets (no-op if it exists) and install frontend deps
	@bash scripts/setup.sh
	@cd frontend && npm ci --no-audit --no-fund

up: validate-config ## Build and start the full stack, wait until healthy
	$(COMPOSE) up -d --build
	@bash scripts/health-check.sh --wait 180

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

logs: ## Follow logs of all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show service status
	$(COMPOSE) ps

health: ## Check service health and public routes
	@bash scripts/health-check.sh

validate-config: ## Validate .env against .env.example
	@bash scripts/validate-config.sh

test: test-backend test-frontend ## Backend tests (real Redis) + frontend tests

test-backend: ## ruff, mypy and pytest against a throwaway Redis
	$(TEST_COMPOSE) run --rm --build backend-tests
	$(TEST_COMPOSE) down -v --remove-orphans

test-frontend: ## Vitest component and unit tests
	cd frontend && npx vitest run

test-proxy: ## Proxy/security tests against the running stack (make up first)
	$(COMPOSE) --profile proxytest run --rm --build proxy-tests

lint: ## ruff + mypy (backend), eslint + tsc (frontend), shellcheck-style syntax check
	$(TEST_COMPOSE) run --rm --build backend-tests sh -c "ruff check app tests && ruff format --check app tests && mypy"
	$(TEST_COMPOSE) down -v --remove-orphans
	cd frontend && npx eslint . && npx tsc --noEmit
	@for f in scripts/*.sh infra/terraform/scripts/*.sh; do bash -n "$$f"; done && echo "shell syntax ok"

alert-check: ## Verify RedisUnavailable is quiet with Redis up and fires with it stopped (~3 min)
	@bash scripts/alert-check.sh

loadtest: ## Unprotected vs protected surge only (no failure run)
	@bash scripts/demo.sh unprotected
	@bash scripts/demo.sh protected
	@bash scripts/demo.sh summary

demo: ## Full 5-minute demo: unprotected, protected, backend failure, fairness, summary
	@bash scripts/demo.sh all

e2e: ## Playwright end-to-end tests against the running stack
	cd frontend && npx playwright test

dashboards: ## Regenerate Grafana dashboards JSON
	python monitoring/grafana/generate_dashboards.py

terraform-validate: ## Offline Terraform fmt + validate (no AWS access)
	cd infra/terraform && terraform fmt -check -recursive && terraform init -backend=false -input=false >/dev/null && terraform validate

clean: ## Stop the stack and delete its volumes (queue state, metrics, dashboards state)
	$(COMPOSE) down -v --remove-orphans
