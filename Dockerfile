FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json server.js core.js ./
COPY public ./public
ENV NODE_ENV=production DB_PATH=/data/app.sqlite PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
