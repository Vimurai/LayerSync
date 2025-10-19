# LayerSync - Automated Timelapse Capture
# Development Makefile

.PHONY: help install install-dev lint lint-fix format format-check test clean start dev stop restart python-lint python-format setup pre-commit quick-check status debug config-check health

# Default target
help: ## Show this help message
	@echo "LayerSync - Automated Timelapse Capture - Development Commands"
	@echo "=============================================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Installation
install: ## Install production dependencies
	npm install
	pip install -r requirements.txt

install-dev: ## Install all dependencies including dev tools
	npm install
	pip install -r requirements.txt
	@echo "✅ All dependencies installed!"

# JavaScript linting and formatting
lint: ## Run ESLint on JavaScript files
	npm run lint

lint-fix: ## Fix ESLint issues automatically
	npm run lint:fix

format: ## Format code with Prettier
	npm run format

format-check: ## Check if code is formatted correctly
	npm run format:check

# Python linting and formatting
python-lint: ## Run Python linting tools
	@echo "Running flake8..."
	flake8 python/
	@echo "Running pylint..."
	pylint python/*.py
	@echo "Running mypy..."
	mypy python/*.py

python-format: ## Format Python code
	@echo "Running black..."
	black python/
	@echo "Running isort..."
	isort python/

# Testing
test: ## Run tests (placeholder)
	@echo "No tests configured yet"

# Development
start: ## Start the application
	npm start

dev: ## Start development server with auto-reload
	npm run dev

stop: ## Stop the application (Ctrl+C)
	@echo "Use Ctrl+C to stop the application"

restart: stop start ## Restart the application

# Cleanup
clean: ## Clean up generated files
	rm -rf node_modules/
	rm -rf venv/
	rm -rf __pycache__/
	rm -rf .pytest_cache/
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -delete

# Setup development environment
setup: install-dev ## Set up complete development environment
	@echo "Setting up development environment..."
	@echo "Installing VS Code extensions..."
	@code --install-extension ms-python.python
	@code --install-extension ms-python.black-formatter
	@code --install-extension ms-python.isort
	@code --install-extension ms-python.flake8
	@code --install-extension esbenp.prettier-vscode
	@code --install-extension dbaeumer.vscode-eslint
	@echo "✅ Development environment setup complete!"

# Pre-commit checks
pre-commit: lint python-lint format-check ## Run all pre-commit checks
	@echo "✅ All pre-commit checks passed!"

# Quick development workflow
quick-check: lint-fix python-format ## Quick fix and format all code
	@echo "✅ Code formatted and linted!"

# Status and monitoring
status: ## Check application status
	@curl -s http://localhost:3000/api/status | jq '.' || echo "Application not running"

debug: ## Get debug information
	@curl -s http://localhost:3000/api/debug | jq '.' || echo "Application not running"

# Configuration
config-check: ## Validate configuration file
	@python3 -c "import json; json.load(open('config/config.json')); print('✅ Configuration is valid')" || echo "❌ Configuration error"

# Health checks
health: ## Run health checks
	@echo "Checking application health..."
	@make status
	@make config-check
	@echo "✅ Health checks completed"
