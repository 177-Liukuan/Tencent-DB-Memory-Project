from fastapi import APIRouter, Depends, HTTPException
from app.models import UserCreate, UserOut
from app.services.user_service import UserService
from app.dependencies import get_user_service
router = APIRouter(prefix='/users', tags=['users'])

@router.post('', response_model=UserOut, status_code=201)
def create_user(payload: UserCreate, service: UserService=Depends(get_user_service)):
    try:
        return service.create_user(payload.email, payload.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@router.get('/{user_id}', response_model=UserOut)
def get_user(user_id: int, service: UserService=Depends(get_user_service)):
    try:
        return service.get_user(user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
