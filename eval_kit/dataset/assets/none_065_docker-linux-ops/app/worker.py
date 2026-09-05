import signal, time
running = True

def stop(*_):
    global running
    running = False

def run():
    signal.signal(signal.SIGTERM, stop)
    while running:
        time.sleep(0.05)
if __name__ == '__main__':
    run()
