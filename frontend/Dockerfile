# Build context is the repo root (not this directory) — the frontend imports
# generated Convex types from the sibling ../backend folder, so the image
# needs both. See docker-compose.yml's `frontend` service (context: .).
FROM node:20-alpine AS base
WORKDIR /repo
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY gateway/simulator/package.json gateway/simulator/package.json
RUN npm install
COPY backend ./backend
COPY convex.json ./convex.json
COPY frontend ./frontend
WORKDIR /repo/frontend

FROM base AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS build
RUN npm run build

FROM node:20-alpine AS prod
WORKDIR /repo
COPY --from=build /repo ./
WORKDIR /repo/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
