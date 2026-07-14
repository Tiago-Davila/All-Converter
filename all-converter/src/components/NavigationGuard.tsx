import { useEffect } from 'react'
export function NavigationGuard({ active }: { active: boolean }) { useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (active) event.preventDefault() }; addEventListener('beforeunload', handler); return () => removeEventListener('beforeunload', handler) }, [active]); return null }
