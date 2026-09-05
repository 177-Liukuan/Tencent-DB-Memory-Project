import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UserForm } from './UserForm';
describe('UserForm', () => { it('submits trimmed name', () => { const save = vi.fn(); render(<UserForm initialName=" Ada " onSave={save}/>); fireEvent.click(screen.getByRole('button', { name: 'Save' })); expect(save).toHaveBeenCalledWith('Ada'); }); });

