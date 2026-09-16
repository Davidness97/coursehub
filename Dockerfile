FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package*.json ./

RUN npm ci --only=production

COPY . .

# Set default env vars for docker
ENV COURSES_PATH=/courses
ENV DATA_PATH=/data
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
