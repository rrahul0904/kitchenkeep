FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
