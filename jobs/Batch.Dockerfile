FROM node:22-bookworm-slim AS node
FROM cloudsphere-job:dev
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /cloudsphere
COPY --chmod=0444 package.json package-lock.json ./
COPY --chmod=0555 node_modules/ ./node_modules/
COPY --chmod=0555 backend/schemas.mjs ./backend/schemas.mjs
COPY --chmod=0555 jobs/batch-entry.mjs jobs/batch-protocol.mjs ./jobs/
USER 65534:65534
ENTRYPOINT ["node", "/cloudsphere/jobs/batch-entry.mjs"]
