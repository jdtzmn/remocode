FROM oven/bun:1
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock ./

# Copy all workspace package.json files (bun install needs the full workspace)
COPY apps/backend/package.json apps/backend/
COPY apps/mobile/package.json apps/mobile/
COPY packages/contracts/package.json packages/contracts/
COPY packages/opencode-plugin/package.json packages/opencode-plugin/

# Install dependencies (frozen lockfile for reproducibility)
RUN bun install --frozen-lockfile

# Copy source code (only what the backend needs)
COPY apps/backend/ apps/backend/
COPY packages/contracts/ packages/contracts/

EXPOSE 3001
CMD ["bun", "run", "--cwd", "apps/backend", "src/server.ts"]
