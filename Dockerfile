FROM node:20-alpine

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json .
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
