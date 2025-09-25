#!/bin/bash

# List of ports to kill
PORTS=(4000 5000 5001 8080 8085 9000 9099 3000 5173) # Add more ports as needed

echo "Attempting to kill processes on specified ports..."

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

echo "Port killing complete."