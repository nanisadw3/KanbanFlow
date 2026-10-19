# --- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# On a network that TLS-inspects HTTPS (corporate proxy/VPN/antivirus),
# Alpine's package index fetch fails with "TLS: server certificate not
# trusted" because apk doesn't trust that proxy's certificate. The proper fix
# is trusting that proxy's root CA inside the image; as a pragmatic escape
# hatch, pass --build-arg APK_INSECURE_HTTP=1 to fetch packages over plain
# HTTP instead (skips TLS validation for this fetch only). Left off by
# default — do not set this for a build that leaves your own trusted network.
ARG APK_INSECURE_HTTP=
RUN if [ -n "$APK_INSECURE_HTTP" ]; then sed -i 's/https:/http:/' /etc/apk/repositories; fi

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

# See the build stage above for what this is.
ARG APK_INSECURE_HTTP=
RUN if [ -n "$APK_INSECURE_HTTP" ]; then sed -i 's/https:/http:/' /etc/apk/repositories; fi

# Needed only to compile sqlite3's native addon during `npm ci`; removed
# afterwards so the runtime image doesn't carry a C/C++ toolchain.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY server ./server
COPY --from=build /app/dist ./dist

# kanban.db lives on a volume so it survives image rebuilds/redeploys.
# Email notices (Gmail API) need GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (and TZ,
# which decides when "today" rolls over). Pass them at run time with `docker run -e ...`
# — don't bake credentials into the image. Without them the app runs but sends no email.
ENV PORT=3001 \
    DB_PATH=/app/data/kanban.db
VOLUME ["/app/data"]
EXPOSE 3001

CMD ["npm", "run", "server"]
