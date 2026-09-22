# Ticket 67: the image a self-hoster runs.
#
# Two stages, so the thing that ships carries no pnpm store and no build
# toolchain. The versions are pinned because an unpinned base silently changes
# the Node a hook runs under, and `packages/shared` is TypeScript that Node
# strips at runtime — a feature with a floor (22.18) rather than a polyfill.
FROM node:22.23.2-trixie-slim AS build

# Corepack reads `packageManager` from package.json, which is where this
# repo's pnpm version is already pinned.
RUN corepack enable
WORKDIR /app

# The lockfile and every manifest first, so a change to application code does
# not re-resolve the dependency graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/plugin/package.json packages/plugin/
RUN pnpm install --frozen-lockfile

COPY . .

# The public variables are read at build time by the client bundle, so they
# have to be here rather than only in the running container. The two Supabase
# ones are the deployment's own project; the URL is where the browser will
# reach this app.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN pnpm --filter web build

FROM node:22.23.2-trixie-slim AS run
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# Copied rather than rebuilt: the build stage already resolved the graph, and
# `next start` needs the same `node_modules` layout the build produced.
COPY --from=build --chown=node:node /app /app

# Nothing here runs as root. The image is a web server holding a service role
# key and a database password; a compromise that is also root in the container
# is a worse afternoon.
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
