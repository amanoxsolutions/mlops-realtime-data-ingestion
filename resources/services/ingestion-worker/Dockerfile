# Dockerfile implementing Node best practices ->
# https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/

# --------------> The build image
FROM public.ecr.aws/docker/library/node:22.2.0 AS build
# Install dumb-init (5. Properly handle events to safely terminate a Node.js Docker web application)
RUN apt-get -y update
# Set env variable to production
ENV NODE_ENV production
# Create ingestion directory
WORKDIR /usr/src/ingestion
# Install ingestion dependencies
COPY --chown=node:node package*.json ./
# Install dependencies
RUN npm ci --only=production

# --------------> The production image

FROM public.ecr.aws/docker/library/node:22.2.0-alpine
# Install dumb-init
RUN apk add --update dumb-init curl
# Set env variable to production
ENV NODE_ENV production
# Sets limited user (node)
USER node
# Create ingestion directory
WORKDIR /usr/src/ingestion
# Copy libraires/node modules
COPY --chown=node:node --from=build /usr/src/ingestion/node_modules /usr/src/ingestion/node_modules
# Bundle ingestion source
COPY --chown=node:node . /usr/src/ingestion

# Start data ingestion
CMD [ "dumb-init", "node", "index.js" ]
