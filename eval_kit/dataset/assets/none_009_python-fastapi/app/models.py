from pydantic import BaseModel, EmailStr, ConfigDict

class UserCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr
    display_name: str

class UserOut(BaseModel):
    id: int
    email: str
    display_name: str
