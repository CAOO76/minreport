import * as functions from "firebase-functions";
export const helloWorld = functions
    .region("southamerica-east1")
    .https.onRequest((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Firebase!");
});
//# sourceMappingURL=index.js.map