export interface Transaction {
  id?: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  createdAt: Date;
}