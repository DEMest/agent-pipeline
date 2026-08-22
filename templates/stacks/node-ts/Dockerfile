FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
# Эта строка адаптируется под конкретный проект скиллом pipeline-init: если в проекте нет шага
# сборки и он запускается прямо из исходников, сюда будут скопированы исходники, а не /app/dist.
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npm", "start"]
