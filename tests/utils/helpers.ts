import { Page, expect } from '@playwright/test';

/**
 * Helper utilities for E2E tests
 */

/**
 * Wait for Firebase Auth to be ready
 */
export async function waitForAuth(page: Page) {
    await page.waitForFunction(() => {
        return (window as any).firebase && (window as any).firebase.auth;
    }, { timeout: 10000 });
}

/**
 * Get current user from Firebase Auth
 */
export async function getCurrentUser(page: Page) {
    return await page.evaluate(() => {
        return (window as any).firebase?.auth?.currentUser;
    });
}

/**
 * Fill RUT/RUN input with formatting
 */
export async function fillRut(page: Page, selector: string, rut: string) {
    await page.fill(selector, rut);
    // Wait for formatting to apply
    await page.waitForTimeout(300);
}

/**
 * Wait for Firestore operation to complete
 */
export async function waitForFirestore(page: Page, timeout = 2000) {
    await page.waitForTimeout(timeout);
}

/**
 * Check if element is visible and enabled
 */
export async function isInteractable(page: Page, selector: string): Promise<boolean> {
    try {
        const element = page.locator(selector);
        const isVisible = await element.isVisible();
        const isEnabled = await element.isEnabled();
        return isVisible && isEnabled;
    } catch {
        return false;
    }
}

/**
 * Wait for navigation with retry
 */
export async function waitForNavigationWithRetry(
    page: Page,
    urlPattern: string | RegExp,
    maxAttempts = 3
) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await page.waitForURL(urlPattern, { timeout: 10000 });
            return;
        } catch (error) {
            if (i === maxAttempts - 1) throw error;
            await page.waitForTimeout(1000);
        }
    }
}

/**
 * Take screenshot with timestamp
 */
export async function takeTimestampedScreenshot(page: Page, name: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await page.screenshot({
        path: `test-results/screenshots/${name}-${timestamp}.png`,
        fullPage: true
    });
}

/**
 * Assert toast/notification appears
 */
export async function expectToast(page: Page, message: string) {
    const toast = page.locator(`text=${message}`).first();
    await expect(toast).toBeVisible({ timeout: 5000 });
}

/**
 * Assert error message appears
 */
export async function expectError(page: Page, message: string) {
    const error = page.locator(`.text-red-600:has-text("${message}")`).first();
    await expect(error).toBeVisible({ timeout: 5000 });
}

/**
 * Clear all inputs in a form
 */
export async function clearForm(page: Page, formSelector: string) {
    const inputs = await page.locator(`${formSelector} input`).all();
    for (const input of inputs) {
        await input.clear();
    }
}

/**
 * Wait for loading spinner to disappear
 */
export async function waitForLoading(page: Page) {
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 });
}

/**
 * Scroll element into view
 */
export async function scrollIntoView(page: Page, selector: string) {
    await page.locator(selector).scrollIntoViewIfNeeded();
}

/**
 * Get Firestore document (via page context)
 */
export async function getFirestoreDoc(page: Page, path: string) {
    return await page.evaluate(async (docPath) => {
        // En los tests, firebase suele estar expuesto en window por los emuladores o el bundle de dev
        const db = (window as any).db;
        if (!db) return null;
        const snap = await db.collection(docPath.split('/')[0]).doc(docPath.split('/')[1]).get();
        return snap.exists ? snap.data() : null;
    }, path);
}

/**
 * Elimina un usuario de Firestore vía consola (para limpieza)
 */
export async function deleteFirestoreUser(page: Page, run: string) {
    await page.evaluate(async (runId) => {
        const db = (window as any).db;
        if (db) {
            await db.collection('user_directory').doc(runId).delete();
        }
    }, run);
}

/**
 * Mobile-specific: Swipe gesture
 */
export async function swipe(
    page: Page,
    direction: 'left' | 'right' | 'up' | 'down',
    selector?: string
) {
    const element = selector ? page.locator(selector) : (page as any);
    const box = await (element as any).boundingBox();

    if (!box) throw new Error('Element not found for swipe');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    let endX = startX;
    let endY = startY;

    switch (direction) {
        case 'left':
            endX = box.x + 10;
            break;
        case 'right':
            endX = box.x + box.width - 10;
            break;
        case 'up':
            endY = box.y + 10;
            break;
        case 'down':
            endY = box.y + box.height - 10;
            break;
    }

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
}

/**
 * Busca el email más reciente enviado a un destinatario en la colección system_emails.
 * Útil para obtener links de activación (Mailbox Mock).
 */
export async function getLatestEmailLink(page: Page, toEmail: string): Promise<string | null> {
    return await page.evaluate(async (email) => {
        // @ts-ignore - Accedemos al db expuesto en window o inyectado
        const db = (window as any).db;
        if (!db) return null;

        const snapshot = await db.collection('system_emails')
            .where('to', '==', email)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        const data = snapshot.docs[0].data();

        // Si el backend guardó los params estructurados
        if (data.params?.oobCode) {
            const baseUrl = window.location.origin;
            const { accountId, taxId, oobCode } = data.params;
            return `${baseUrl}/setup-access?accountId=${accountId}&taxId=${taxId || ''}&email=${email}&oobCode=${oobCode}`;
        }

        // fallback: buscar link en el body html
        const match = data.body.match(/href="([^"]+)"/);
        return match ? match[1] : null;
    }, toEmail);
}
