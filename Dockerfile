FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build -w client
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
