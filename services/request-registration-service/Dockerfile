# Use the official Node.js 20 image as the base image.
FROM node:20-slim

# Set the working directory to the monorepo root inside the container.
WORKDIR /app

# Copy the entire monorepo structure (or at least relevant parts)
# This assumes the docker build context is the monorepo root.
COPY . .

# Install pnpm globally
RUN npm install -g pnpm

# Install all dependencies for the monorepo
RUN pnpm install

# Change working directory to the specific service for subsequent steps
WORKDIR /app/services/request-registration-service

# Build the TypeScript code for this service
RUN pnpm build

# Expose the port that the application listens on.
EXPOSE 8080

# Define the command to run the application.
CMD ["npm", "start"]