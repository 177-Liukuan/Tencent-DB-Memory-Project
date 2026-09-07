from app.repositories.user_repository import UserRepository
from app.services.user_service import UserService
_repo = UserRepository()

def get_user_service() -> UserService:
    return UserService(_repo)
