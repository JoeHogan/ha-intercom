# Use an official Node runtime as a parent image
FROM node:23-slim

RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Set the working directory (already present, but good practice to show where it's set)
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install --force

# Copy the rest of the application code
COPY . .

# Set correct permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

WORKDIR /app 

EXPOSE 3001

# Define the default command to run when the container starts
CMD ["npm", "run", "start"]