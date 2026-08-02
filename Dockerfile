# CineVault — one image, three jobs.
#
# The same image runs the web app, the background worker, and the migrator. They share a
# codebase and a database, so building them separately would mean three builds that can drift
# apart; the entrypoint decides which one this container is.
#
#   docker run … cinevault            # the web app (default)
#   docker run … cinevault worker     # the background loops
#   docker run … cinevault migrate    # apply migrations, then exit
#
# Node 22 to match what the app is developed against. Alpine because the only native
# dependency is pg, which ships a pure-JS fallback.

# ══════════════════════════════════════════════════════════════════════════════
# deps — installed once, reused by the build
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until a dependency actually changes. Copying
# the whole source here would rebuild node_modules on every edit to a component.
COPY package.json package-lock.json ./

# `--include=dev` is not optional, and it is not the default it looks like.
#
# npm omits devDependencies whenever NODE_ENV=production, and a host can set that without
# asking: Coolify injects every environment variable as a build ARG into every stage, so
# NODE_ENV=production in its dashboard silently becomes NODE_ENV=production here. TypeScript,
# Tailwind and the rest are devDependencies, so `next build` then fails on a missing compiler
# with an error that says nothing about why it went missing.
#
# Being explicit makes the build produce the same image whatever the host injects.
RUN npm ci --include=dev

# ══════════════════════════════════════════════════════════════════════════════
# build — Next.js, plus plain-JS bundles of the worker and migrator
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Telemetry off. It phones home during the build, which is neither wanted nor reliable on a
# machine that may have no outbound access.
ENV NEXT_TELEMETRY_DISABLED=1

# The build imports lib/env.ts, which validates configuration and refuses to start when
# something required is missing. That check is right at runtime and wrong here: no real
# secret should ever be baked into an image layer. These placeholders satisfy the schema and
# are replaced by the real environment when the container runs.
#
# The publishable key is the one exception that genuinely IS compiled in — NEXT_PUBLIC_* is
# inlined into the browser bundle by design — so it has to be a build argument.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
#
# Note there is deliberately NO "skip validation" flag. An escape hatch that turns the
# configuration check off is one that eventually gets set on a real server, and the check
# exists precisely so a half-configured app refuses to take somebody's money.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV SESSION_SECRET=build_time_placeholder_not_a_real_secret_00
ENV STRIPE_SECRET_KEY=sk_test_placeholder

RUN npm run build

# The worker and the migrator are TypeScript, and tsx is a dev dependency that will not be in
# the runtime image. Bundling them to plain JS here means the runtime carries no toolchain and
# no source — and it fails loudly at BUILD time if an import cannot be resolved, rather than
# at 4am when the worker restarts.
RUN npx esbuild worker/index.ts \
      --bundle --platform=node --target=node22 --format=cjs \
      --external:pg-native --tsconfig=tsconfig.json \
      --outfile=dist/worker.js \
 && npx esbuild lib/db/migrate.ts \
      --bundle --platform=node --target=node22 --format=cjs \
      --external:pg-native --tsconfig=tsconfig.json \
      --outfile=dist/migrate.js

# ══════════════════════════════════════════════════════════════════════════════
# runtime
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Not root. A container that is compromised should not also be privileged inside itself.
RUN addgroup -g 1001 -S nodejs && adduser -S cinevault -u 1001

# `standalone` is a self-contained server with only the files Next traced as reachable —
# node_modules does not come along. static/ and public/ are not traced because they are
# served as files rather than imported, so they are copied separately.
COPY --from=build --chown=cinevault:nodejs /app/.next/standalone ./
COPY --from=build --chown=cinevault:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=cinevault:nodejs /app/public ./public

COPY --from=build --chown=cinevault:nodejs /app/dist ./dist
# The migration SQL itself, which the migrator reads at runtime from ./drizzle.
COPY --from=build --chown=cinevault:nodejs /app/drizzle ./drizzle

COPY --chown=cinevault:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER cinevault
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["web"]
