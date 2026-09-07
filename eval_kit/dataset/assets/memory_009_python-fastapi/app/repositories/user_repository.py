from dataclasses import dataclass

@dataclass
class UserRow:
    id: int
    email: str
    display_name: str

class UserRepository:

    def __init__(self):
        self._rows: dict[int, UserRow] = {}
        self._seq = 1

    def create(self, email: str, display_name: str) -> UserRow:
        if any((x.email == email for x in self._rows.values())):
            raise ValueError('duplicate email')
        row = UserRow(self._seq, email, display_name)
        self._rows[row.id] = row
        self._seq += 1
        return row

    def get(self, user_id: int) -> UserRow | None:
        return self._rows.get(user_id)
