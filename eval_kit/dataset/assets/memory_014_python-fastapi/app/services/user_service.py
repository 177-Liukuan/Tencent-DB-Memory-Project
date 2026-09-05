from app.repositories.user_repository import UserRepository

class UserService:

    def __init__(self, repo: UserRepository):
        self.repo = repo

    def create_user(self, email: str, display_name: str):
        name = display_name.strip()
        if len(name) < 2:
            raise ValueError('display_name too short')
        return self.repo.create(email.lower(), name)

    def get_user(self, user_id: int):
        user = self.repo.get(user_id)
        if user is None:
            raise LookupError('user not found')
        return user
