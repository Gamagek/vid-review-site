FROM node:20-alpine
WORKDIR /app
COPY server.cjs /app/server.cjs
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "/app/server.cjs"]
