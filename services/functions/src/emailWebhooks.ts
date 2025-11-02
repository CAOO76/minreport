import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const resendWebhook = onRequest(async (request, response) => {
    try {
        const db = getFirestore();
        const payload = request.body;



        // Basic validation of the payload
        if (!payload || !payload.data || !payload.data.email_id || !payload.type) {

            response.status(400).send('Invalid Payload');
            return;
        }

        const emailId = payload.data.email_id;
        const eventType = payload.type; // e.g., 'email.sent', 'email.bounced'

        let emailStatus: string;

        switch (eventType) {
            case 'email.delivered':
                emailStatus = 'delivered';
                break;
            case 'email.bounced':
                emailStatus = 'bounced';
                break;
            case 'email.delivery_delayed':
                emailStatus = 'delayed';
                break;
            case 'email.complained':
                emailStatus = 'complained';
                break;
            default:
                emailStatus = 'unknown';
                break;
        }

        // Find the request in Firestore by emailId and update its status
        const requestsRef = db.collection('requests');
        const querySnapshot = await requestsRef.where('emailId', '==', emailId).limit(1).get();

        if (querySnapshot.empty) {

            response.status(404).send('Request not found');
            return;
        }

        const requestDoc = querySnapshot.docs[0];
        await requestDoc.ref.update({
            emailStatus: emailStatus,
            updatedAt: FieldValue.serverTimestamp(),
            lastWebhookEvent: eventType,
            webhookPayload: payload // Store the full payload for debugging/auditing
        });


        response.status(200).send('Webhook received and processed');

    } catch (error) {
    
        response.status(500).send('Internal Server Error');
    }
});