# llmscheme-service — single-file Node service, zero runtime deps.
# Build context = repo root (Dockerfile copies the skill's editor template + core bundle).
FROM node:22-alpine
WORKDIR /app
# non-root: the service only writes to /data
# uid/gid pinned to 100:100 — host bind-mount ./data must be chown 100:100 (see README)
# -g/-u with || true: base image may already own gid 100 (node in alpine images)
RUN addgroup -S -g 100 llm || true && adduser -S -u 100 -G llm llm || true
COPY llmscheme-service-mcp/server.mjs .
COPY llmscheme-service-mcp/core.mjs .
COPY llmscheme-service-mcp/VERSION .
# editor template comes from the skill — same file, one source of truth
COPY llmscheme-skill/block_llm_core/editor-template.gen.html .
RUN mkdir -p /data && chown llm:llm /data
USER llm
ENV NODE_ENV=production
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8080}/health || exit 1
CMD ["node", "server.mjs"]
