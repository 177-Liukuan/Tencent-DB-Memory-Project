import { useState } from 'react';
import { UserForm } from './components/UserForm';
import { UserDialog } from './components/UserDialog';
import { UserCard } from './components/UserCard';
export function App() { const [open, setOpen] = useState(false); const [name, setName] = useState('Ada'); return <main><h1>User center</h1><UserCard name={name} status="active"/><button onClick={() => setOpen(true)}>Edit</button><UserDialog open={open} onClose={() => setOpen(false)}><UserForm initialName={name} onSave={x => { setName(x); setOpen(false); }}/></UserDialog></main>; }
