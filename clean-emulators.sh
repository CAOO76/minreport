#!/bin/bash
# clean-emulators.sh
# Mata procesos de emuladores Firebase y libera puertos antes de iniciar el entorno dev

# Lista de puertos usados por los emuladores (ajusta según tu setup)
PORTS=(8085 9190 5001 5010 5015 5016 5017 9195 4001 4400 4500 9150 8046 8416)

for PORT in "${PORTS[@]}"; do
  PID=$(lsof -ti tcp:$PORT)
  if [ ! -z "$PID" ]; then
    echo "Matando proceso en puerto $PORT (PID $PID)"
    kill -9 $PID
  fi
done

# También mata procesos de firestore, emulator, o node que hayan quedado colgados
for PROC in firestore-emulator emulator-hub firebase-emulators firebase; do
  pkill -f $PROC 2>/dev/null
  # Ignora error si no hay procesos
  true
done

echo "Emuladores y puertos limpios. Listo para iniciar pnpm dev."
