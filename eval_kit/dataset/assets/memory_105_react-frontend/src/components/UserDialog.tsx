import { useEffect, useRef } from 'react';
export function UserDialog({ open, onClose, children }: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (open)
            closeRef.current?.focus();
    }, [open]);
    if (!open)
        return null;
    return <div role="dialog" aria-modal="true" aria-label="Edit user" onKeyDown={e => {
            if (e.key === 'Escape')
                onClose();
        }}><button ref={closeRef} onClick={onClose}>Close</button>{children}</div>;
}
