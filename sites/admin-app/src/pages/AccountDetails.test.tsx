import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import AccountDetails from './AccountDetails.tsx';
import { useParams, useNavigate } from 'react-router-dom';
import { getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

// Mock Firebase Firestore and Functions
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal() as object;
  const mockFirestoreInstance = {
    _delegate: {}, // Mimic the structure connectFirestoreEmulator might expect
  };
  return {
    ...actual,
    doc: vi.fn(),
    getDoc: vi.fn(),
    getFirestore: vi.fn(() => mockFirestoreInstance),
    connectFirestoreEmulator: vi.fn(),
  };
});

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal() as object;
  return {
    ...actual,
    getFunctions: vi.fn(() => ({})), // Mock getFunctions to return a mock functions instance
    httpsCallable: vi.fn(() => vi.fn()), // Mock httpsCallable to return a mock callable function
    connectFunctionsEmulator: vi.fn(), // Add connectFunctionsEmulator to the mock
  };
});

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

// Mock the M3Switch web component
// This is a simplified mock. In a real scenario, you might want to mock its internal behavior more accurately.
customElements.define('md-switch', class extends HTMLElement {
  _selected = false; // Internal state

  connectedCallback() {
    this.onclick = () => {
      this.selected = !this.selected; // Toggle internal state
      // Simulate change event
      const event = new Event('change', { bubbles: true });
      Object.defineProperty(event, 'target', { value: this, writable: true });
      this.dispatchEvent(event);
    };
  }

  set selected(value: boolean) {
    this._selected = value;
    if (value) {
      this.setAttribute('selected', 'true'); // Explicitly set to 'true'
    } else {
      this.setAttribute('selected', 'false'); // Explicitly set to 'false'
    }
  }

  get selected() {
    return this._selected;
  }
});

describe('AccountDetails', () => {
  const mockAccountId = 'testAccountId123';
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as Mock).mockReturnValue({ accountId: mockAccountId });
    (useNavigate as Mock).mockReturnValue(mockNavigate);
  });

  const mockAccountData = {
    id: mockAccountId,
    status: 'active',
    createdAt: { toDate: () => new Date('2023-01-01') },
    institutionName: 'Test Institution',
    accountType: 'EMPRESARIAL',
    designatedAdminEmail: 'admin@test.com',
    adminName: 'Admin Test',
  };

  it('renders loading state initially', () => {
  (getDoc as Mock).mockReturnValueOnce(new Promise(() => {})); // Never resolve to keep loading
    render(<AccountDetails />);
    expect(screen.getByText('Cargando detalles de la cuenta...')).toBeInTheDocument();
  });

  it('renders error state if account not found', async () => {
  (getDoc as Mock).mockResolvedValueOnce({ exists: () => false });
    render(<AccountDetails />);
    await waitFor(() => {
      expect(screen.getByText('Cuenta no encontrada.')).toBeInTheDocument();
  });
  });

  it('renders account details correctly', async () => {
  (getDoc as Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => mockAccountData,
    });
    render(<AccountDetails />);

    await waitFor(async () => {
      await screen.findByText(`Detalles de la Cuenta: ${mockAccountData.institutionName}`);

      // For ID
      const idParagraph = screen.getByText((_, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('ID:');
      });
      const idText = idParagraph.textContent?.replace('ID:', '').trim();
      expect(idText).toBe('testAccountId123');

      // For Email Administrador
      const emailParagraph = screen.getByText((_, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Email Administrador:');
      });
      const emailText = emailParagraph.textContent?.replace('Email Administrador:', '').trim();
      expect(emailText).toBe('admin@test.com');

      // Keep other assertions as they are
      // For Tipo de Cuenta
      const accountTypeParagraph = screen.getByText((_, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Tipo de Cuenta:');
      });
      const accountTypeText = accountTypeParagraph.textContent?.replace('Tipo de Cuenta:', '').trim();
      expect(accountTypeText).toBe(mockAccountData.accountType);

      // For Estado
      const statusParagraph = screen.getByText((_, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Estado:');
      });
      const statusText = statusParagraph.textContent?.replace('Estado:', '').trim();
      expect(statusText).toBe(mockAccountData.status);

      // For Fecha de Creación
      const createdAtParagraph = screen.getByText((_, element) => {
        return element?.tagName.toLowerCase() === 'p' && element.textContent?.includes('Fecha de Creación:');
      });
      const createdAtText = createdAtParagraph.textContent?.replace('Fecha de Creación:', '').trim();
      expect(createdAtText).toBe(new Date('2023-01-01').toLocaleDateString());
    });
  });

});
