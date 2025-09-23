"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dummyFunction = void 0;
const firebase_functions_1 = require("firebase-functions");
exports.dummyFunction = firebase_functions_1.https.onCall({ region: "southamerica-west1" }, (data, context) => {
    return { message: 'This is a dummy function.' };
});
//# sourceMappingURL=dummy.js.map