FROM node:20-alpine
WORKDIR /app
COPY server.mjs /app/server.mjs
ENV NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "/app/server.mjs"]