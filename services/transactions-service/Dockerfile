FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./.pnpmrc ./

RUN npm install -g pnpm && pnpm install --prod

COPY . .

RUN pnpm build

CMD ["npm", "start"]