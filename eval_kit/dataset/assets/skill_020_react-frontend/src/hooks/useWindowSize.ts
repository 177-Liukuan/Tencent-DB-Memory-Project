import { useEffect, useState } from 'react';
export function useWindowSize() { const [width, setWidth] = useState<number | null>(null); useEffect(() => { const update = () => setWidth(window.innerWidth); update(); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []); return width; }

