# Use the official Node.js 20 image as the base image.
FROM node:20-slim

# Set the working directory in the container.
WORKDIR /usr/src/app

# Copy package.json and pnpm-lock.yaml to the working directory.
# A wildcard is used to ensure both package.json and package-lock.json are copied.
# Copying them separately helps in leveraging Docker cache.
COPY package.json ./ 
COPY pnpm-lock.yaml ./ 

# Install pnpm globally
RUN npm install -g pnpm

# Install dependencies using pnpm
RUN pnpm install --prod

# Copy the rest of the application code.
COPY . .

# Build the TypeScript code.
RUN npm run build

# Expose the port that the application listens on.
EXPOSE 8080

# Define the command to run the application.
CMD ["npm", "start"]