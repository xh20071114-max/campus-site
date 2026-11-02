FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=3000 DATA_DIR=/data ADMIN=AevonEcho
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node","server.js"]
