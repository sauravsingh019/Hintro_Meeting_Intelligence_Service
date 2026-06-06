FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY .env.example ./
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "src/server.js"]
