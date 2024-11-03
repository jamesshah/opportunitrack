FROM node:lts-alpine

WORKDIR /server
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 8000

# Command to run the app
CMD ["npm", "start"]