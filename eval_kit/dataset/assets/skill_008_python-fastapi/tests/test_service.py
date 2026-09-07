import pytest
from app.repositories.user_repository import UserRepository
from app.services.user_service import UserService

def test_create_normalizes_email():
    service = UserService(UserRepository())
    row = service.create_user('A@EXAMPLE.COM', 'Alice')
    assert row.email == 'a@example.com'

def test_short_name_is_rejected():
    with pytest.raises(ValueError):
        UserService(UserRepository()).create_user('a@example.com', 'x')
