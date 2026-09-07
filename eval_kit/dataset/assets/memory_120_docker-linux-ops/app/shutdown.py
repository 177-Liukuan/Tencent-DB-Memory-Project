from dataclasses import dataclass
from enum import Enum
import time

class ShutdownPhase(str, Enum):
    RUNNING='running'
    DRAINING='draining'
    STOPPED='stopped'

@dataclass
class DrainStatus:
    phase: ShutdownPhase=ShutdownPhase.RUNNING
    inflight: int=0
    started_at: float|None=None

class DrainController:
    def __init__(self): self.status=DrainStatus()
    def begin_request(self)->bool:
        if self.status.phase is not ShutdownPhase.RUNNING: return False
        self.status.inflight+=1; return True
    def finish_request(self)->None:
        if self.status.inflight<=0: raise RuntimeError('no request to finish')
        self.status.inflight-=1
    def begin_shutdown(self,now:float|None=None)->None:
        if self.status.phase is ShutdownPhase.RUNNING:
            self.status.phase=ShutdownPhase.DRAINING; self.status.started_at=time.monotonic() if now is None else now
    def ready(self)->bool:return self.status.phase is ShutdownPhase.RUNNING
    def live(self)->bool:return self.status.phase is not ShutdownPhase.STOPPED
    def complete_if_drained(self)->bool:
        if self.status.phase is ShutdownPhase.DRAINING and self.status.inflight==0:
            self.status.phase=ShutdownPhase.STOPPED; return True
        return False
    def expired(self,deadline_seconds:float,now:float|None=None)->bool:
        if self.status.started_at is None:return False
        current=time.monotonic() if now is None else now
        return current-self.status.started_at>=deadline_seconds

def json_log(event:str,request_id:str|None=None,**fields:object)->dict[str,object]:
    record:dict[str,object]={'event':event,'ts':time.time()}
    if request_id:record['request_id']=request_id
    record.update(fields)
    return record
