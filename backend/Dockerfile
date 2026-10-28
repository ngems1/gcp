FROM node:22-alpine

WORKDIR /home/app

# install deps first so this layer is cached between builds
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000
USER node

CMD ["node", "src/server.js"]
