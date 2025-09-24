import { https } from 'firebase-functions';
export const dummyFunction = https.onCall({ region: "southamerica-west1" }, (data, context) => {
    return { message: 'This is a dummy function.' };
});
//# sourceMappingURL=dummy.js.map