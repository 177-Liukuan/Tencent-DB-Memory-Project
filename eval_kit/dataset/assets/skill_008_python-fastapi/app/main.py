from fastapi import FastAPI
from app.users import router as users_router
app = FastAPI(title='User Service', version='0.1.0')
app.include_router(users_router)

@app.get('/health')
def health():
    return {'status': 'ok'}
