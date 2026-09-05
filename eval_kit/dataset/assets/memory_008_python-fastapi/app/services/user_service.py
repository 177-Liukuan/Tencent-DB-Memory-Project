async def create_user(payload: dict) -> dict:
    return {'id': 'u1', **payload}
