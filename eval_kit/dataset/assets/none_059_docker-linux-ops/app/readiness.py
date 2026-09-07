from dataclasses import dataclass

@dataclass
class DependencyState:
    name: str
    available: bool
    detail: str = ''

def aggregate(states: list[DependencyState]) -> dict:
    unavailable = [s for s in states if not s.available]
    return {'ready': not unavailable, 'dependencies': {s.name: {'available': s.available, 'detail': s.detail} for s in states}}

def local_process_health() -> dict:
    return {'status': 'ok'}
