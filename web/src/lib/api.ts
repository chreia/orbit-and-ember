/** A separate public data service may be used by static deployments. */
export const apiUrl = (path: string) => `${(import.meta.env.VITE_PUBLIC_API_BASE || import.meta.env.BASE_URL).replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
