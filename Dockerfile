FROM oven/bun:1
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock ./

# Copy package.json for each workspace member the backend needs
COPY apps/backend/package.json apps/backend/
COPY packages/contracts/package.json packages/contracts/

# Install dependencies (frozen lockfile for reproducibility)
RUN bun install --frozen-lockfile

# Copy source code (only what the backend needs)
COPY apps/backend/ apps/backend/
COPY packages/contracts/ packages/contracts/

EXPOSE 3001
CMD ["bun", "run", "--cwd", "apps/backend", "src/server.ts"]
