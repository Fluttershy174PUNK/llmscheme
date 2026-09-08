# llmscheme-service — single image, no build step. The container runs src/ on
# the host's Node 22.18+, so the build pipeline (esbuild + svelte/compiler)
# only needs to run when we want a fresh console.html or editor.html — that
# is done OUTSIDE this image by `npm run build`, and the artifacts are
# mounted in via /assets.
FROM node:22.22-bookworm-slim

WORKDIR /app
# only what the service needs at runtime; the test/build deps are not here
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY schemes/ ./schemes/
# editor.html + console.html + assets/ are produced by `npm run build` and
# mounted as a volume in docker-compose; COPY them in if you bake the image
# without a volume.
# COPY mcp-service/editor.html mcp-service/console.html mcp-service/assets/ ./mcp-service/

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV ASSETS_DIR=/app/mcp-service

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/service/server.ts"]
