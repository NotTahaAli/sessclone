# Ticket 67: the image a self-hoster runs.
#
# Two stages, so the pnpm store and the build cache stay out of the shipped
# layers. What ships is still the whole resolved `node_modules`, dev
# dependencies included: `next start` runs from the same layout `next build`
# produced, and `pnpm prune --prod` on a workspace is not safe to do blind.
# The versions are pinned because an unpinned base silently changes the Node a
# hook runs under, and `packages/shared` is TypeScript that Node strips at
# runtime — a feature with a floor (22.18) rather than a polyfill.
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
#
# The site flags (ticket 138) are here too: the public pages read them when
# they prerender, and the container reads them again per request.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG ENABLE_LANDING
ARG ENABLE_DOCS
ARG ENABLE_DEMO
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    ENABLE_LANDING=$ENABLE_LANDING \
    ENABLE_DOCS=$ENABLE_DOCS \
    ENABLE_DEMO=$ENABLE_DEMO
RUN pnpm --filter web build

FROM node:22.23.2-trixie-slim AS run
WORKDIR /app/apps/web
ENV NODE_ENV=production

# Copied rather than rebuilt: the build stage already resolved the graph, and
# `next start` needs the same `node_modules` layout the build produced.
COPY --from=build --chown=node:node /app /app

# Nothing here runs as root. The image is a web server holding a service role
# key and a database password; a compromise that is also root in the container
# is a worse afternoon.
USER node
EXPOSE 3000

# `next` directly, not `pnpm --filter web start`. Corepack materialises pnpm by
# downloading it from the npm registry the first time it is invoked, so a pnpm
# entrypoint means every container start reaches the network — and on an
# air-gapped or registry-blocked host it means a container that never serves,
# which `restart: unless-stopped` turns into a silent crash loop. The binary is
# already in the image, symlinked by the install above.
CMD ["node_modules/.bin/next", "start"]
