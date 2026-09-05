export async function login(username: string, password: string) { return { username, ok: Boolean(password) }; }
