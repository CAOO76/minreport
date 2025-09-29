
import { expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

// Mock global de firebase/firestore para todos los tests
vi.mock('firebase/firestore', async () => {
	const actual = await vi.importActual('firebase/firestore');
	return {
		...actual,
		collection: (_db: any, path: string) => ({ __mockCollection: path }),
		onSnapshot: (colRef: any, onNext: any) => {
			if (colRef && colRef.__mockCollection === 'plugins') {
				onNext({
					docs: [
						{
							id: 'plugin-externo',
							data: () => ({ name: 'Plugin Externo', url: 'http://localhost', status: 'enabled' })
						}
					],
					empty: false
				});
			} else {
				onNext({ docs: [], empty: true });
			}
			return () => {};
		},
	};
});