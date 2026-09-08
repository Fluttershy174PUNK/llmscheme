# llmscheme-service — single image, no build step in the container.
# The image ships the sources (src/) AND the pre-built single-file HTML
# artifacts (SERVICE-MCP/llmscheme/*.html + assets/). `npm run build` runs on
# the developer's machine (Node 22.18+), never inside this image, so the
# sandbox does not need Node on the host.
FROM node:22-alpine

WORKDIR /app
# the service has zero runtime dependencies, but npm ci keeps the lockfile honest
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY README.md ./
COPY SERVICE-MCP/llmscheme/ ./SERVICE-MCP/llmscheme/

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV ASSETS_DIR=/app/SERVICE-MCP/llmscheme

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/service/server.ts"]
