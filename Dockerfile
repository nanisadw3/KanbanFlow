# --- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# sqlite3's native bindings need a C/C++ toolchain to compile on Alpine.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes VITE_* vars into the JS bundle at build time. Leave
# VITE_BACKEND_URL unset for this single-container image — the frontend then
# talks to whatever origin served it, since Express serves both the API and
# the built frontend from the same port. Only set it for a split deployment
# where the API lives on a different host.
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN npm run build

# --- Runtime stage -------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# Needed only to compile sqlite3's native addon during `npm ci`; removed
# afterwards so the runtime image doesn't carry a C/C++ toolchain.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server ./server
COPY --from=build /app/dist ./dist

# kanban.db lives on a volume so it survives image rebuilds/redeploys.
ENV PORT=3001 \
    DB_PATH=/app/data/kanban.db
VOLUME ["/app/data"]
EXPOSE 3001

CMD ["npm", "run", "server"]
