#!/usr/bin/env python3
# Copyright    2026  Xiaomi Corp.        (authors:  Han Zhu)
#
# See ../../LICENSE for clarification regarding multiple authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
Gradio demo for OmniVoice.

Supports voice cloning and voice design.

Usage:
    omnivoice-demo --model /path/to/checkpoint --port 8000
"""

import argparse
import glob as glob_mod
import logging
import os
from typing import Any, Dict

import gradio as gr
import numpy as np
import torch

from omnivoice import OmniVoice, OmniVoiceGenerationConfig
from omnivoice.utils.lang_map import LANG_NAMES, lang_display_name

# ---------------------------------------------------------------------------
# Saved voices helpers
# ---------------------------------------------------------------------------
_VOICES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "voices")


def _list_saved_voices():
    """Return list of saved voice names from voices/ directory."""
    voices_dir = os.path.abspath(_VOICES_DIR)
    if not os.path.isdir(voices_dir):
        return ["None"]
    files = sorted(glob_mod.glob(os.path.join(voices_dir, "*.pt")))
    names = ["None"] + [os.path.splitext(os.path.basename(f))[0] for f in files]
    return names


def _load_saved_voice(name):
    """Load a saved VoiceClonePrompt by name."""
    if not name or name == "None":
        return None
    path = os.path.join(os.path.abspath(_VOICES_DIR), f"{name}.pt")
    if not os.path.exists(path):
        return None
    return torch.load(path, weights_only=False)


def get_best_device():
    """Auto-detect the best available device: CUDA > MPS > CPU."""
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ---------------------------------------------------------------------------
# Language list — all 600+ supported languages
# ---------------------------------------------------------------------------
_ALL_LANGUAGES = ["Auto"] + sorted(lang_display_name(n) for n in LANG_NAMES)


# ---------------------------------------------------------------------------
# Voice Design instruction templates
# ---------------------------------------------------------------------------
# Each option is displayed as "English / 中文".
# The model expects English for accents and Chinese for dialects.
_CATEGORIES = {
    "Gender / 性别": ["Male / 男", "Female / 女"],
    "Age / 年龄": [
        "Child / 儿童",
        "Teenager / 少年",
        "Young Adult / 青年",
        "Middle-aged / 中年",
        "Elderly / 老年",
    ],
    "Pitch / 音调": [
        "Very Low Pitch / 极低音调",
        "Low Pitch / 低音调",
        "Moderate Pitch / 中音调",
        "High Pitch / 高音调",
        "Very High Pitch / 极高音调",
    ],
    "Style / 风格": ["Whisper / 耳语"],
    "English Accent / 英文口音": [
        "American Accent / 美式口音",
        "Australian Accent / 澳大利亚口音",
        "British Accent / 英国口音",
        "Chinese Accent / 中国口音",
        "Canadian Accent / 加拿大口音",
        "Indian Accent / 印度口音",
        "Korean Accent / 韩国口音",
        "Portuguese Accent / 葡萄牙口音",
        "Russian Accent / 俄罗斯口音",
        "Japanese Accent / 日本口音",
    ],
    "Chinese Dialect / 中文方言": [
        "Henan Dialect / 河南话",
        "Shaanxi Dialect / 陕西话",
        "Sichuan Dialect / 四川话",
        "Guizhou Dialect / 贵州话",
        "Yunnan Dialect / 云南话",
        "Guilin Dialect / 桂林话",
        "Jinan Dialect / 济南话",
        "Shijiazhuang Dialect / 石家庄话",
        "Gansu Dialect / 甘肃话",
        "Ningxia Dialect / 宁夏话",
        "Qingdao Dialect / 青岛话",
        "Northeast Dialect / 东北话",
    ],
}

_ATTR_INFO = {
    "English Accent / 英文口音": "Only effective for English speech.",
    "Chinese Dialect / 中文方言": "Only effective for Chinese speech.",
}

# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="omnivoice-demo",
        description="Launch a Gradio demo for OmniVoice.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--model",
        default="k2-fsa/OmniVoice",
        help="Model checkpoint path or HuggingFace repo id.",
    )
    parser.add_argument(
        "--device", default=None, help="Device to use. Auto-detected if not specified."
    )
    parser.add_argument("--ip", default="0.0.0.0", help="Server IP (default: 0.0.0.0).")
    parser.add_argument(
        "--port", type=int, default=7860, help="Server port (default: 7860)."
    )
    parser.add_argument(
        "--root-path",
        default=None,
        help="Root path for reverse proxy.",
    )
    parser.add_argument(
        "--share", action="store_true", default=False, help="Create public link."
    )
    parser.add_argument(
        "--no-asr",
        action="store_true",
        default=False,
        help="Skip loading Whisper ASR model. Reference text auto-transcription"
        " will be unavailable.",
    )
    return parser


# ---------------------------------------------------------------------------
# Build demo
# ---------------------------------------------------------------------------


def build_demo(
    model: OmniVoice,
    checkpoint: str,
    generate_fn=None,
) -> gr.Blocks:

    sampling_rate = model.sampling_rate

    # Store last created voice_clone_prompt for saving
    _last_voice_prompt = {"prompt": None}

    # -- shared generation core --
    def _gen_core(
        text,
        language,
        ref_audio,
        instruct,
        num_step,
        guidance_scale,
        denoise,
        speed,
        duration,
        preprocess_prompt,
        postprocess_output,
        mode,
        ref_text=None,
        saved_voice=None,
    ):
        if not text or not text.strip():
            return None, "Please enter the text to synthesize."

        import time
        t0 = time.time()
        logging.info("[Generate] Starting... mode=%s, saved_voice=%s", mode, saved_voice)

        gen_config = OmniVoiceGenerationConfig(
            num_step=int(num_step or 16),
            guidance_scale=float(guidance_scale) if guidance_scale is not None else 2.0,
            denoise=bool(denoise) if denoise is not None else True,
            preprocess_prompt=bool(preprocess_prompt),
            postprocess_output=bool(postprocess_output),
        )

        lang = language if (language and language != "Auto") else None

        kw: Dict[str, Any] = dict(
            text=text.strip(), language=lang, generation_config=gen_config
        )

        if speed is not None and float(speed) != 1.0:
            kw["speed"] = float(speed)
        if duration is not None and float(duration) > 0:
            kw["duration"] = float(duration)

        # Check for saved voice first
        voice_prompt = _load_saved_voice(saved_voice)
        if voice_prompt is not None:
            logging.info("[Generate] Using saved voice: %s", saved_voice)
            kw["voice_clone_prompt"] = voice_prompt
        elif mode == "clone":
            if not ref_audio:
                return None, "Please upload a reference audio."
            logging.info("[Generate] Creating voice clone prompt (Whisper transcribing if no ref_text)...")
            voice_prompt = model.create_voice_clone_prompt(
                ref_audio=ref_audio,
                ref_text=ref_text,
            )
            logging.info("[Generate] Voice clone prompt created. ref_text=%s", voice_prompt.ref_text[:50] if voice_prompt.ref_text else "N/A")
            kw["voice_clone_prompt"] = voice_prompt
            # Store for saving later
            _last_voice_prompt["prompt"] = voice_prompt

        if instruct and instruct.strip():
            kw["instruct"] = instruct.strip()

        try:
            logging.info("[Generate] Generating audio... (this may take 1-3 min on MPS)")
            audio = model.generate(**kw)
        except Exception as e:
            logging.error("[Generate] Error: %s", e)
            return None, f"Error: {type(e).__name__}: {e}"

        elapsed = time.time() - t0
        waveform = audio[0].squeeze(0).numpy()  # (T,)
        waveform = (waveform * 32767).astype(np.int16)
        voice_info = f" | voice: {saved_voice}" if saved_voice and saved_voice != "None" else ""
        logging.info("[Generate] Done in %.1fs", elapsed)
        return (sampling_rate, waveform), f"Done ({elapsed:.1f}s){voice_info}"

    def _save_voice_fn(voice_name):
        """Save the last cloned voice prompt to a .pt file."""
        if not voice_name or not voice_name.strip():
            return "Please enter a name for the voice."
        if _last_voice_prompt["prompt"] is None:
            return "No voice to save. Please clone a voice first (upload audio + Generate)."
        name = voice_name.strip().replace(" ", "_")
        voices_dir = os.path.abspath(_VOICES_DIR)
        os.makedirs(voices_dir, exist_ok=True)
        save_path = os.path.join(voices_dir, f"{name}.pt")
        torch.save(_last_voice_prompt["prompt"], save_path)
        return f"Saved: {name}.pt"

    def _auto_transcribe(audio_path):
        """Auto-transcribe uploaded audio using Whisper."""
        if not audio_path:
            return ""
        try:
            logging.info("[ASR] Auto-transcribing: %s", audio_path)
            if model._asr_pipe is None:
                logging.info("[ASR] Loading Whisper model...")
                model.load_asr_model()
            text = model.transcribe(audio_path)
            logging.info("[ASR] Result: %s", text)
            return text
        except Exception as e:
            logging.error("[ASR] Error: %s", e)
            return f"(Transcription failed: {e})"

    # Allow external wrappers (e.g. spaces.GPU for ZeroGPU Spaces)
    _gen = generate_fn if generate_fn is not None else _gen_core

    # =====================================================================
    # UI
    # =====================================================================
    theme = gr.themes.Soft(
        font=["Inter", "Arial", "sans-serif"],
    )
    css = """
    .gradio-container {max-width: 100% !important; font-size: 16px !important;}
    .gradio-container h1 {font-size: 1.5em !important;}
    .gradio-container .prose {font-size: 1.1em !important;}
    .compact-audio audio {height: 60px !important;}
    .compact-audio .waveform {min-height: 80px !important;}
    """

    # Reusable: language dropdown component
    def _lang_dropdown(label="Language (optional) / 语种 (可选)", value="Auto"):
        return gr.Dropdown(
            label=label,
            choices=_ALL_LANGUAGES,
            value=value,
            allow_custom_value=False,
            interactive=True,
            info="Keep as Auto to auto-detect the language.",
        )

    # Reusable: optional generation settings accordion
    def _gen_settings():
        with gr.Accordion("Generation Settings (optional)", open=False):
            sp = gr.Slider(
                0.5,
                1.5,
                value=1.0,
                step=0.05,
                label="Speed",
                info="1.0 = normal. >1 faster, <1 slower. Ignored if Duration is set.",
            )
            du = gr.Number(
                value=None,
                label="Duration (seconds)",
                info=(
                    "Leave empty to use speed."
                    " Set a fixed duration to override speed."
                ),
            )
            ns = gr.Slider(
                4,
                64,
                value=16,
                step=1,
                label="Inference Steps",
                info="Default: 16 (fast). 32 = better quality but slower on MPS.",
            )
            dn = gr.Checkbox(
                label="Denoise",
                value=True,
                info="Default: enabled. Uncheck to disable denoising.",
            )
            gs = gr.Slider(
                0.0,
                4.0,
                value=2.0,
                step=0.1,
                label="Guidance Scale (CFG)",
                info="Default: 2.0.",
            )
            pp = gr.Checkbox(
                label="Preprocess Prompt",
                value=True,
                info="apply silence removal and trimming to the reference "
                "audio, add punctuation in the end of reference text (if not already)",
            )
            po = gr.Checkbox(
                label="Postprocess Output",
                value=True,
                info="Remove long silences from generated audio.",
            )
        return ns, gs, dn, sp, du, pp, po

    with gr.Blocks(theme=theme, css=css, title="OmniVoice Demo") as demo:
        gr.Markdown(
            """
# OmniVoice Demo

State-of-the-art text-to-speech model for **600+ languages**, supporting:

- **Voice Clone** — Clone any voice from a reference audio
- **Voice Design** — Create custom voices with speaker attributes

Built with [OmniVoice](https://github.com/k2-fsa/OmniVoice)
by Xiaomi AI Lab Next-gen Kaldi team.
"""
        )

        with gr.Tabs():
            # ==============================================================
            # Voice Clone
            # ==============================================================
            with gr.TabItem("Voice Clone"):
                with gr.Row():
                    with gr.Column(scale=1):
                        vc_text = gr.Textbox(
                            label="Text to Synthesize / 待合成文本",
                            lines=4,
                            placeholder="Enter the text you want to synthesize...",
                        )
                        vc_saved = gr.Dropdown(
                            label="Saved Voice / Giọng đã lưu",
                            choices=_list_saved_voices(),
                            value="None",
                            info="Chọn giọng đã clone và lưu sẵn. Nếu chọn thì không cần upload audio.",
                        )
                        vc_refresh = gr.Button("🔄 Refresh voices", size="sm")
                        vc_ref_audio = gr.Audio(
                            label="Reference Audio / 参考音频 (bỏ qua nếu đã chọn Saved Voice)",
                            type="filepath",
                            elem_classes="compact-audio",
                        )
                        gr.Markdown(
                            "<span style='font-size:0.85em;color:#888;'>"
                            "Recommended: 3–10 seconds audio. "
                            "</span>"
                        )
                        vc_ref_text = gr.Textbox(
                            label="Reference Text / Noi dung audio (Whisper tu nhan dang)",
                            lines=2,
                            placeholder="Upload audio phia tren → Whisper se tu dong dien vao day...",
                        )
                        vc_lang = _lang_dropdown("Language (optional) / 语种 (可选)")
                        with gr.Accordion("Instruct (optional)", open=False):
                            vc_instruct = gr.Textbox(label="Instruct", lines=2)
                        (
                            vc_ns,
                            vc_gs,
                            vc_dn,
                            vc_sp,
                            vc_du,
                            vc_pp,
                            vc_po,
                        ) = _gen_settings()
                        vc_btn = gr.Button("Generate / 生成", variant="primary")
                    with gr.Column(scale=1):
                        vc_audio = gr.Audio(
                            label="Output Audio / 合成结果",
                            type="numpy",
                        )
                        vc_status = gr.Textbox(label="Status / 状态", lines=2)
                        gr.Markdown("---")
                        gr.Markdown("### Save Voice / Luu giong da clone")
                        vc_save_name = gr.Textbox(
                            label="Voice Name / Ten giong",
                            placeholder="vd: giong_anh_A, giong_chi_B...",
                            lines=1,
                        )
                        vc_save_btn = gr.Button("Save Voice / Luu giong", variant="secondary")
                        vc_save_status = gr.Textbox(label="Save Status", lines=1)

                # Auto-transcribe when audio is uploaded
                vc_ref_audio.change(
                    _auto_transcribe,
                    inputs=[vc_ref_audio],
                    outputs=[vc_ref_text],
                )

                def _clone_fn(
                    text, lang, saved_voice, ref_aud, ref_text, instruct, ns, gs, dn, sp, du, pp, po
                ):
                    return _gen(
                        text,
                        lang,
                        ref_aud,
                        instruct,
                        ns,
                        gs,
                        dn,
                        sp,
                        du,
                        pp,
                        po,
                        mode="clone",
                        ref_text=ref_text or None,
                        saved_voice=saved_voice,
                    )

                vc_refresh.click(
                    lambda: gr.update(choices=_list_saved_voices()),
                    outputs=[vc_saved],
                )

                # Save will be connected after vd_saved is created (see below)

                vc_btn.click(
                    _clone_fn,
                    inputs=[
                        vc_text,
                        vc_lang,
                        vc_saved,
                        vc_ref_audio,
                        vc_ref_text,
                        vc_instruct,
                        vc_ns,
                        vc_gs,
                        vc_dn,
                        vc_sp,
                        vc_du,
                        vc_pp,
                        vc_po,
                    ],
                    outputs=[vc_audio, vc_status],
                )

            # ==============================================================
            # Voice Design
            # ==============================================================
            with gr.TabItem("Voice Design"):
                with gr.Row():
                    with gr.Column(scale=1):
                        vd_text = gr.Textbox(
                            label="Text to Synthesize / 待合成文本",
                            lines=4,
                            placeholder="Enter the text you want to synthesize...",
                        )
                        vd_saved = gr.Dropdown(
                            label="Saved Voice / Giọng đã lưu (optional)",
                            choices=_list_saved_voices(),
                            value="None",
                            info="Chọn giọng đã clone. Kết hợp với Voice Design bên dưới.",
                        )
                        vd_refresh = gr.Button("🔄 Refresh voices", size="sm")
                        vd_lang = _lang_dropdown()

                        _AUTO = "Auto"
                        vd_groups = []
                        for _cat, _choices in _CATEGORIES.items():
                            vd_groups.append(
                                gr.Dropdown(
                                    label=_cat,
                                    choices=[_AUTO] + _choices,
                                    value=_AUTO,
                                    info=_ATTR_INFO.get(_cat),
                                )
                            )

                        (
                            vd_ns,
                            vd_gs,
                            vd_dn,
                            vd_sp,
                            vd_du,
                            vd_pp,
                            vd_po,
                        ) = _gen_settings()
                        vd_btn = gr.Button("Generate / 生成", variant="primary")
                    with gr.Column(scale=1):
                        vd_audio = gr.Audio(
                            label="Output Audio / 合成结果",
                            type="numpy",
                        )
                        vd_status = gr.Textbox(label="Status / 状态", lines=2)

                def _build_instruct(groups):
                    """Extract instruct text from UI dropdowns.

                    Language unification and validation is handled by
                    _resolve_instruct inside _preprocess_all.
                    """
                    selected = [g for g in groups if g and g != "Auto"]
                    if not selected:
                        return None
                    parts = []
                    for v in selected:
                        if " / " in v:
                            en, zh = v.split(" / ", 1)
                            # Dialects have no English equivalent
                            if "Dialect" in v.split(" / ")[0]:
                                parts.append(zh.strip())
                            else:
                                parts.append(en.strip())
                        else:
                            parts.append(v)
                    return ", ".join(parts)

                def _design_fn(text, lang, saved_voice, ns, gs, dn, sp, du, pp, po, *groups):
                    return _gen(
                        text,
                        lang,
                        None,
                        _build_instruct(groups),
                        ns,
                        gs,
                        dn,
                        sp,
                        du,
                        pp,
                        po,
                        mode="design",
                        saved_voice=saved_voice,
                    )

                vd_refresh.click(
                    lambda: gr.update(choices=_list_saved_voices()),
                    outputs=[vd_saved],
                )

                vd_btn.click(
                    _design_fn,
                    inputs=[
                        vd_text,
                        vd_lang,
                        vd_saved,
                        vd_ns,
                        vd_gs,
                        vd_dn,
                        vd_sp,
                        vd_du,
                        vd_pp,
                        vd_po,
                    ]
                    + vd_groups,
                    outputs=[vd_audio, vd_status],
                )

        # Connect Save button -> refresh both dropdowns
        def _save_and_refresh_all(name):
            status = _save_voice_fn(name)
            choices = _list_saved_voices()
            return status, gr.update(choices=choices), gr.update(choices=choices)

        vc_save_btn.click(
            _save_and_refresh_all,
            inputs=[vc_save_name],
            outputs=[vc_save_status, vc_saved, vd_saved],
        )

        # Auto-refresh saved voices on page load (F5)
        def _refresh_all_voices():
            choices = _list_saved_voices()
            return gr.update(choices=choices), gr.update(choices=choices)

        demo.load(
            _refresh_all_voices,
            outputs=[vc_saved, vd_saved],
        )

    return demo


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv=None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )
    parser = build_parser()
    args = parser.parse_args(argv)

    device = args.device or get_best_device()

    checkpoint = args.model
    if not checkpoint:
        parser.print_help()
        return 0
    # MPS (Apple Silicon) does not support float16 well, use float32 instead
    dtype = torch.float32 if device == "mps" else torch.float16
    logging.info(f"Loading model from {checkpoint}, device={device}, dtype={dtype} ...")
    model = OmniVoice.from_pretrained(
        checkpoint,
        device_map=device,
        dtype=dtype,
        load_asr=not args.no_asr,
    )
    print("Model loaded.")

    demo = build_demo(model, checkpoint)

    demo.queue().launch(
        server_name=args.ip,
        server_port=args.port,
        share=args.share,
        root_path=args.root_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
