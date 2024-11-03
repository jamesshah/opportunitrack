FROM node:lts-alpine

WORKDIR /completion-handler-queue
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Command to run the app
CMD ["npm", "start"]