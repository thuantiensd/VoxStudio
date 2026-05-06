"""
Lưu giọng nói từ file audio mẫu thành file .pt để dùng lại.

Dùng:
    python save_voice.py --audio giong_mau.wav --name tên_giọng
"""

import argparse
import torch
from omnivoice import OmniVoice


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="File audio mẫu (wav/mp3)")
    parser.add_argument("--text", default=None, help="Nội dung audio mẫu (bỏ qua thì tự nhận dạng)")
    parser.add_argument("--name", default="my_voice", help="Tên giọng để lưu")
    parser.add_argument("--model", default="k2-fsa/OmniVoice", help="Model path")
    args = parser.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Loading model on {device}...")
    model = OmniVoice.from_pretrained(args.model, device_map=device)

    print(f"Creating voice prompt from: {args.audio}")
    voice_prompt = model.create_voice_clone_prompt(
        ref_audio=args.audio,
        ref_text=args.text,
    )

    save_path = f"voices/{args.name}.pt"
    import os
    os.makedirs("voices", exist_ok=True)
    torch.save(voice_prompt, save_path)
    print(f"Saved: {save_path}")


if __name__ == "__main__":
    main()
