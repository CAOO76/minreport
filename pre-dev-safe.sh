#!/bin/bash

# List of ALL ports needed for the application (including Firebase emulator ports)
PORTS=(4000 5000 5001 8080 8085 9000 9099 9190 3000 5173 5175 5177 5179)

echo "Attempting to kill processes on all required ports for clean startup..."

for PORT in "${PORTS[@]}"; do
  echo "Checking port $PORT..."
  # Find PIDs listening on the port and kill them
  lsof -ti :$PORT | xargs -r kill -9
  if [ $? -eq 0 ]; then
    echo "Killed process on port $PORT"
  else
    echo "No process found or failed to kill on port $PORT"
  fi
done

echo "All ports cleared. Ready for clean startup with data preservation."