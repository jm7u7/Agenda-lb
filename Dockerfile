# Imagen única del monorepo Limablue Agenda (sirve para API y web; el comando lo elige compose).
# Build multi-stage: compila shared → api → web y genera el cliente Prisma.

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# openssl: requerido por Prisma para generar el engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Instala dependencias con el lockfile (capa cacheable)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
# Código y build
COPY . .
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl wget && rm -rf /var/lib/apt/lists/*
# Copia todo el árbol ya construido (incluye node_modules con Prisma client + CLI para migrate deploy)
COPY --from=builder /app ./
RUN mkdir -p apps/api/uploads
EXPOSE 3002 5180
# Por defecto arranca la API; compose sobreescribe el comando y el working_dir para el web.
WORKDIR /app/apps/api
CMD ["node", "dist/apps/api/src/index.js"]
