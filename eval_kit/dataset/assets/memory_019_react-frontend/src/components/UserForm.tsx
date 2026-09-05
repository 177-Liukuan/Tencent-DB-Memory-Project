import { useState } from 'react';
export function UserForm() {
  const [name, setName] = useState('');
  return <form><label>Name<input value={name} onChange={e => setName(e.target.value)} /></label></form>;
}
