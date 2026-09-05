from fastapi import APIRouter
router = APIRouter()

@router.get('/users/{user_id}')
async def get_user(user_id: str):
    return {'id': user_id, 'name': 'Ada'}
