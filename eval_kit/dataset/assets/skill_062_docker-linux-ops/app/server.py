import signal
import time
running = True
def stop(*_):
    global running
    running = False
signal.signal(signal.SIGTERM, stop)
while running:
    time.sleep(0.1)
