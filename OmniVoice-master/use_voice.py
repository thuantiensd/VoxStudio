"""
Dùng lại giọng đã lưu để tạo audio mới.

Dùng:
    python use_voice.py --voice voices/my_voice.pt --text "Xin chào" --output output.wav
"""

import argparse
import numpy as np
import soundfile as sf
import torch
from omnivoice import OmniVoice


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True, help="File giọng đã lưu (.pt)")
    parser.add_argument("--text", required=True, help="Nội dung muốn đọc")
    parser.add_argument("--output", default="output.wav", help="File output")
    parser.add_argument("--model", default="k2-fsa/OmniVoice", help="Model path")
    args = parser.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Loading model on {device}...")
    model = OmniVoice.from_pretrained(args.model, device_map=device)

    print(f"Loading voice from: {args.voice}")
    voice_prompt = torch.load(args.voice, map_location=device, weights_only=False)

    print(f"Generating: {args.text}")
    audio = model.generate(text=args.text, voice_clone_prompt=voice_prompt)

    waveform = audio[0].squeeze(0).numpy()
    sf.write(args.output, waveform, model.sampling_rate)
    print(f"Saved audio: {args.output}")


if __name__ == "__main__":
    main()
