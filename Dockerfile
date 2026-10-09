# EADEPRO Business Portal. Built on Playwright's own image so the parking report's Chromium and its Linux libraries
# are already there (the tag must match the playwright version in package.json).
#   docker compose up -d --build

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 # The standalone output only has the files Next.js saw being imported; Playwright also reads data files
 # (browsers.json, injected scripts) at run time, so its packages go in whole.
 && for d in node_modules/.pnpm/playwright@*/node_modules/playwright node_modules/.pnpm/playwright-core@*/node_modules/playwright-core; do \
      mkdir -p ".next/standalone/$d" && cp -r "$d/." ".next/standalone/$d/"; \
    done

FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production \
    PORT=23020 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Kuala_Lumpur \
    STORAGE_DIR=/app/storage \
    AD_TLS_CA=/app/ad-certificate.pem
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/ad-certificate.pem ./
RUN mkdir -p /app/storage && chown -R pwuser:pwuser /app/storage
USER pwuser
EXPOSE 23020
# Database migrations run when the server starts (src/instrumentation.ts).
CMD ["node", "server.js"]
