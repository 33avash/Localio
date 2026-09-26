# The official image ships Chromium, its system libraries and fonts at the
# version @playwright/test expects, so screenshots match wherever it runs.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /e2e

COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY playwright.config.js ./
COPY specs/ specs/

CMD ["npx", "playwright", "test"]
