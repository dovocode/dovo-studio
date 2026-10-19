# Local dictation attribution

Parakeet Redux model weights © Moondream, derived from NVIDIA Parakeet TDT 0.6B v3. Licensed under
Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/

Original Redux model: https://huggingface.co/moondream/parakeet-redux NVIDIA base model:
https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 GGUF conversion by NairoDorian / Nairod785:
https://huggingface.co/Nairod785/parakeet-redux-gguf

Dovo uses the TQ1_Q8_0 conversion: encoder ternary codes are retained; dense parameters are
quantized to Q8_0 and the tokenizer is embedded. Dovo does not further modify the model. Attribution
does not imply endorsement.

Inference engine: transcribe.cpp, MIT license. https://github.com/NairoDorian/transcribe.cpp Engine
and dependency licenses accompany the packaged native executable. Audio is processed locally. No
Photon or other proprietary inference engine is included.
