export class AppError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 400) {
        super(message);
        this.name = new.target.name;
    }
}
export class NotFoundError extends AppError {
    constructor(entity: string, id: string) { super('NOT_FOUND', `${entity} ${id} was not found`, 404); }
}
