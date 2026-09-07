import { useState } from 'react';
import styles from './UserForm.module.css';
export function UserForm({ initialName, onSave }: {
    initialName: string;
    onSave: (name: string) => void;
}) {
    const [name, setName] = useState(initialName);
    const trimmed = name.trim();
    return <form className={styles.form} onSubmit={e => {
            e.preventDefault();
            if (trimmed)
                onSave(trimmed);
        }}><label htmlFor="user-name">Name</label><input id="user-name" value={name} onChange={e => setName(e.target.value)}/><button disabled={!trimmed}>Save</button></form>;
}

