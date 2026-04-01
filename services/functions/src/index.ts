import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

export const helloWorld = onRequest({ region: "southamerica-west1" }, (request, response) => {
    logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Firebase!");
});
