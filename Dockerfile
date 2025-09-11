FROM node:20-slim

WORKDIR /app

# Copia todo el monorepo
COPY . .

# Instala pnpm y typescript globalmente
RUN npm install -g pnpm typescript

# Instala todas las dependencias del monorepo
RUN pnpm install

# Compila todos los espacios de trabajo
RUN /usr/local/bin/tsc --project packages/core/tsconfig.json
RUN /usr/local/bin/tsc --project services/request-registration-service/tsconfig.json

# Establece el directorio de trabajo al servicio
WORKDIR /app/services/request-registration-service

# Expone el puerto
EXPOSE 8080

# Define el comando para ejecutar la aplicación
CMD ["node", "lib/index.js"]