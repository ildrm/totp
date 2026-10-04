FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @still/api build
RUN pnpm --filter @still/api deploy --legacy --prod /runtime
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg && apk del --no-network apk-tools zlib
WORKDIR /app
COPY --from=build --chown=node:node /runtime/node_modules node_modules
COPY --from=build --chown=node:node /workspace/apps/api/dist dist
COPY --from=build --chown=node:node /workspace/apps/api/migrations migrations
COPY --from=build --chown=node:node /workspace/apps/api/migrate.mjs migrate.mjs
COPY --from=build --chown=node:node /workspace/apps/api/package.json package.json
USER node
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/apps/api/src/main.js"]
