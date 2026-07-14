export async function loadDomain<T>(loader: () => Promise<T>): Promise<T> { return loader() }
