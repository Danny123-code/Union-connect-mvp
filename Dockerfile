FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/union-connect.json

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/index.js"]
