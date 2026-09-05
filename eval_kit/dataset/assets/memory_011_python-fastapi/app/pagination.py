from dataclasses import dataclass
from typing import Iterable, TypeVar

T = TypeVar('T')

@dataclass(frozen=True)
class PageRequest:
    offset: int
    limit: int

@dataclass(frozen=True)
class Page:
    items: list[T]
    offset: int
    limit: int
    total: int

class PaginationError(ValueError):
    pass

def parse_positive_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise PaginationError(f'{field} must be an integer')
    if value <= 0:
        raise PaginationError(f'{field} must be positive')
    return value

def parse_non_negative_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise PaginationError(f'{field} must be an integer')
    if value < 0:
        raise PaginationError(f'{field} must be non-negative')
    return value

def make_page_request(offset: object, limit: object) -> PageRequest:
    return PageRequest(
        offset=parse_non_negative_int(offset, 'offset'),
        limit=parse_positive_int(limit, 'limit'),
    )

def paginate(rows: Iterable[T], request: PageRequest) -> Page[T]:
    materialized=list(rows)
    start=request.offset
    end=start+request.limit
    return Page(materialized[start:end], request.offset, request.limit, len(materialized))

def normalize_display_name(value: str) -> str:
    normalized=' '.join(value.split())
    if len(normalized)<2:
        raise ValueError('display_name too short')
    if len(normalized)>80:
        raise ValueError('display_name too long')
    return normalized

def normalize_email(value: str) -> str:
    email=value.strip().lower()
    local, sep, domain=email.partition('@')
    if not sep or not local or '.' not in domain:
        raise ValueError('invalid email')
    return email
