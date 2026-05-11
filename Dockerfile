FROM mcr.microsoft.com/azurelinux/base/nodejs:20
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
