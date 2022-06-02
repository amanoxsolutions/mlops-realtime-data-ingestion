# Dockerfile implementing Node best practices -> 
# https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/

# --------------> The build image
FROM public.ecr.aws/docker/library/node:16.13.1 AS build
# Install dumb-init (5. Properly handle events to safely terminate a Node.js Docker web application)
RUN apt-get -y update
# Set env variable to production
ENV NODE_ENV production
# Create microservice directory
WORKDIR /usr/src/microservice
# Install microservice dependencies
COPY --chown=node:node package*.json ./
# Install dependencies
RUN npm ci --only=production

# --------------> The production image
FROM public.ecr.aws/docker/library/node:16.13.1-alpine
# Install dumb-init
RUN apk add --update dumb-init curl
# Set env variable to production
ENV NODE_ENV production
# Sets limited user (node)
USER node
# Create microservice directory
WORKDIR /usr/src/microservice

# Open ports
# EXPOSE 3000
# Set env variables
# ENV PORT=3000
# ENV HOST=0.0.0.0
# Starts service
# CMD [ "node", "index.js" ]