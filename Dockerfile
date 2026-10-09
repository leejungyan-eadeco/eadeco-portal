# EADEPRO Business Portal. Built on Playwright's own image so the parking report's Chromium and its Linux libraries
# are already there (the tag must match the playwright version in package.json).
#   docker compose up -d --build
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV TZ=Asia/Kuala_Lumpur \
    STORAGE_DIR=/app/storage \
    AD_TLS_CA=/app/ad-certificate.pem
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && mkdir -p storage && chown -R pwuser:pwuser storage .next
ENV NODE_ENV=production
USER pwuser
EXPOSE 23020
# Database migrations run when the server starts (src/instrumentation.ts).
CMD ["node_modules/.bin/next", "start", "-p", "23020"]
