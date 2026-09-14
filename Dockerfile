# Worker thuong tru — KHONG chay duoc tren Vercel serverless (rang buoc cung #6).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY db ./db
# Tin hieu dung: SIGTERM -> shutdown sach, flush not hang doi ghi DB.
STOPSIGNAL SIGTERM
CMD ["node", "dist/index.js"]
