# Build: SPA bundle + embedding model baked into the image (no download at runtime).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && MODEL_CACHE_DIR=/app/.cache/models node --input-type=module -e "await (await import('./src/server/embeddings.ts')).embedOne('warm up')"

# Runtime: production deps, server sources (Node 24 runs .ts directly), built SPA, model.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production TZ=UTC MODEL_CACHE_DIR=/app/.cache/models
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && rm -rf node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32 \
 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/.cache/models ./.cache/models
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY samples ./samples
EXPOSE 3000
CMD ["node", "src/server/index.ts"]
