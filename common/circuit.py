"""Circuit breaker with its state in Redis, so every gateway replica and worker
shares one view of each upstream provider.

closed     -> calls flow; consecutive failures are counted (within a window).
open       -> after `threshold` failures, calls are refused until `cooldown_s` passes.
half_open  -> after the cooldown, exactly one caller wins a probe lock and is let
              through. Success closes the circuit; failure re-opens it.
"""
import time
from dataclasses import dataclass


@dataclass
class BreakerState:
    name: str
    state: str  # closed | open | half_open
    failures: int
    open_until: float | None
    trips: int


class CircuitBreaker:
    def __init__(self, redis, name: str, threshold: int = 5, cooldown_s: float = 30,
                 failure_window_s: int = 60):
        self.r = redis
        self.name = name
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self.window = failure_window_s
        p = f"cb:{name}"
        self.k_fails, self.k_open, self.k_probe, self.k_trips = (
            f"{p}:fails", f"{p}:open_until", f"{p}:probe", f"{p}:trips")

    async def allow(self) -> bool:
        raw = await self.r.get(self.k_open)
        if raw is None:
            return True
        if time.time() < float(raw):
            return False
        # Cooldown elapsed: half-open. Only one caller gets to probe.
        return bool(await self.r.set(self.k_probe, "1", nx=True, ex=max(1, int(self.cooldown_s))))

    async def record_success(self):
        await self.r.delete(self.k_fails, self.k_open, self.k_probe)

    async def record_failure(self):
        half_open = await self.r.exists(self.k_open)
        pipe = self.r.pipeline()
        pipe.incr(self.k_fails)
        pipe.expire(self.k_fails, self.window)
        fails, _ = await pipe.execute()
        if half_open or fails >= self.threshold:
            await self._trip()

    async def _trip(self):
        pipe = self.r.pipeline()
        pipe.set(self.k_open, str(time.time() + self.cooldown_s))
        pipe.delete(self.k_fails, self.k_probe)
        pipe.incr(self.k_trips)
        await pipe.execute()

    async def snapshot(self) -> BreakerState:
        fails, open_until, trips = await self.r.mget(self.k_fails, self.k_open, self.k_trips)
        state = "closed"
        if open_until is not None:
            state = "open" if time.time() < float(open_until) else "half_open"
        return BreakerState(
            name=self.name,
            state=state,
            failures=int(fails or 0),
            open_until=float(open_until) if open_until else None,
            trips=int(trips or 0),
        )
