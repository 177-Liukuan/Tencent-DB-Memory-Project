export function UserCard({ name, status }: {
    name: string;
    status: 'active' | 'disabled';
}) { return <article><strong>{name}</strong><span aria-label="account status">{status}</span></article>; }

