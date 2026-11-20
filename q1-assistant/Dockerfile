FROM node:20-bookworm-slim
WORKDIR /app

# better-sqlite3 为原生模块：预编译包不可用时需本地编译，装构建工具兜底
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY Q1-语料 ./Q1-语料
RUN mkdir -p data

EXPOSE 3000
CMD ["npm", "start"]
