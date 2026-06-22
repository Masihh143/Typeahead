# Node.js multi-stage build

FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src ./src

# Server image
FROM base AS server
COPY web ./web
EXPOSE 8080
CMD ["npm", "start"]

# Ingest image
FROM base AS ingest
ENTRYPOINT ["node", "src/ingest.js"]
CMD ["-file=/data/user-ct-test-collection-02.txt"]

