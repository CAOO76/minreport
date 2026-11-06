import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/**
 * Healthcheck soberano minimalista de Cloud Functions Gen 2 (`southamerica-west1`).
 */
export const systemHealthCheck = onRequest(
    {
        region: "southamerica-west1",
        cors: ["https://minreport-access.web.app"],
        maxInstances: 5,
    },
    (request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
            return;
        }

        const payload = {
            service: "minreport-functions-gen2",
            region: "southamerica-west1",
            timestamp: new Date().toISOString(),
        };

        logger.info("MINREPORT systemHealthCheck ejecutado", {
            region: payload.region,
            method: request.method,
        });

        response.status(200).json(payload);
    }
);
