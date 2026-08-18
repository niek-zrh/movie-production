# Kinolab — multi-stage build.
#
# Targets:
#   convex-deploy  one-shot: pushes convex/ functions to the self-hosted
#                  backend (CONVEX_SELF_HOSTED_URL + _ADMIN_KEY), then exits.
#   (default)      Next.js frontend, standalone server on port 8090 with a
#                  /api/health healthcheck.
#
# NEXT_PUBLIC_CONVEX_URL is inlined into the browser bundle at build time —
# changing it requires a rebuild, not a restart. The same is true of the
# Content-Security-Policy: Next evaluates next.config.ts headers() during the
# build, so the CSP_* / CONVEX origin args below only take effect on rebuild.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# One-shot function push. Runs `npx convex deploy` against the self-hosted
# backend and exits 0. Skips (successfully) when no admin key is provided so
# the frontend can still deploy without it.
FROM deps AS convex-deploy
COPY convex ./convex
COPY tsconfig.json next-env.d.ts* ./
CMD ["sh", "-c", "\
  if [ -z \"$CONVEX_SELF_HOSTED_ADMIN_KEY\" ]; then \
    echo '[convex-deploy] CONVEX_SELF_HOSTED_ADMIN_KEY not set — skipping function push.'; \
    exit 0; \
  fi; \
  echo \"[convex-deploy] pushing convex/ to $CONVEX_SELF_HOSTED_URL\"; \
  npx convex deploy -v"]

# ---------------------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_CONVEX_URL
# Convex HTTP-actions origin + CSP escape hatches — consumed by
# next.config.ts when it builds the security headers.
ARG NEXT_PUBLIC_CONVEX_SITE_URL
ARG CSP_EXTRA_ORIGINS
ARG CSP_REPORT_ONLY
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL \
    CSP_EXTRA_ORIGINS=$CSP_EXTRA_ORIGINS \
    CSP_REPORT_ONLY=$CSP_REPORT_ONLY \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
# convex/_generated is committed (per Convex docs) so the build typechecks.
RUN pnpm build

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S kinolab && adduser -S kinolab -G kinolab
COPY --from=build --chown=kinolab:kinolab /app/.next/standalone ./
COPY --from=build --chown=kinolab:kinolab /app/.next/static ./.next/static
USER kinolab
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
CMD ["node", "server.js"]
