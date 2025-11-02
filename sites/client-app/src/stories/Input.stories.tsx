// sites/client-app/src/stories/Input.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../components/Input';
import type { InputProps } from '../components/Input'; // Explicitly import InputProps

const meta: Meta<InputProps> = {
  title: 'UI/Forms/Input',
  component: Input,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<InputProps>;

export const Email: Story = {
  args: {
    label: 'Email Address',
    type: 'email',
    placeholder: 'user@example.com',
  },
};

export const Password: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter your password',
  },
};
