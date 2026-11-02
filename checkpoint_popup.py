"""Native, topmost checkpoint dialog. Kept separate from the WebView GUI loop."""
import json
import math
import struct
import sys
import threading
import tkinter as tk
import wave
import winsound
from pathlib import Path


def play_chime():
    path = Path(__file__).parent / 'instance' / 'checkpoint.wav'
    path.parent.mkdir(exist_ok=True)
    samples = []
    rate = 22050
    for frequency in (660, 880):
        length = int(rate * 0.16)
        for index in range(length):
            envelope = math.sin(math.pi * index / length) ** 2
            samples.append(int(5500 * envelope * math.sin(2 * math.pi * frequency * index / rate)))
    with wave.open(str(path), 'wb') as sound:
        sound.setnchannels(1)
        sound.setsampwidth(2)
        sound.setframerate(rate)
        sound.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
    winsound.PlaySound(str(path), winsound.SND_FILENAME)


def main():
    payload = json.loads(sys.argv[1])
    english = payload.get('language') == 'en'
    root = tk.Tk()
    root.title('Ajde. — Study break' if english else 'Ajde. — Vrijeme za pauzu')
    root.configure(bg='#f6f7f2')
    root.resizable(False, False)
    width, height = 490, 290
    root.geometry(f'{width}x{height}+{(root.winfo_screenwidth()-width)//2}+{(root.winfo_screenheight()-height)//2}')
    root.attributes('-topmost', True)
    finished_break = payload.get('kind') == 'break'
    title = ('Break is over.' if english else 'Pauza je završena.') if finished_break else ('Time for a small break.' if english else 'Vrijeme je za malu pauzu.')
    tk.Label(root, text=title, font=('Segoe UI', 20, 'bold'), bg='#f6f7f2', fg='#243d34').pack(pady=(27, 10))
    tk.Label(root, text=payload['subject'], wraplength=440, font=('Segoe UI', 12), bg='#f6f7f2', fg='#243d34').pack()
    message = 'Your timer is paused. What next?' if english else 'Tajmer je pauziran. Kako nastavljamo?'
    tk.Label(root, text=message, font=('Segoe UI', 11), bg='#f6f7f2', fg='#728474').pack(pady=20)

    def choose(action):
        print(action, flush=True)
        root.destroy()

    buttons = tk.Frame(root, bg='#f6f7f2')
    buttons.pack(pady=8)
    for text, action in [('Continue' if english else 'Nastavi', 'resume'),
                         (('Stay paused' if english else 'Ostani na pauzi') if finished_break else ('Break' if english else 'Pauza'), 'pause'),
                         ('Finish' if english else 'Završi', 'finish')]:
        tk.Button(buttons, text=text, command=lambda value=action: choose(value),
                  font=('Segoe UI', 11), bg='#295a45', fg='white', relief='flat',
                  padx=18, pady=9, cursor='hand2').pack(side='left', padx=5)
    root.protocol('WM_DELETE_WINDOW', lambda: choose('pause'))
    root.after(100, root.lift)
    # Topmost requests visibility without forcibly stealing keyboard input from a game.
    threading.Thread(target=play_chime, daemon=True).start()
    root.mainloop()


if __name__ == '__main__':
    main()
