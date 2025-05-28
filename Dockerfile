# Use an official Node runtime as a parent image
FROM node:23-slim

RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Set the working directory
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

