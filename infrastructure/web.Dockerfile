FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /workspace
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/core packages/core
COPY apps/web apps/web
COPY scripts scripts
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @still/web build
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
RUN rm -rf /usr/local/lib/node_modules /opt/yarn* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg && apk del --no-network apk-tools zlib
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/apps/web/out apps/web/out
COPY --from=build --chown=node:node /workspace/scripts/serve-web.mjs scripts/serve-web.mjs
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "scripts/serve-web.mjs"]
