export type LoginResult = {
    status: number;
    body: {
        message: string;
    };
};
export function login(username: string, password: string): LoginResult {
    if (!username || !password)
        return { status: 400, body: { message: 'missing credentials' } };
    if (password !== 'correct-horse')
        return { status: 401, body: { message: 'Invalid credentials' } };
    return { status: 200, body: { message: 'ok' } };
}
