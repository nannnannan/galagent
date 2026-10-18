# Third-party resources

GalAgent includes Electron and Chromium. Their distributed license files remain in the application directory. JavaScript dependencies retain their upstream license files in the application archive.

The local retrieval model is **intfloat/multilingual-e5-small**, with **Xenova/multilingual-e5-small** ONNX conversion used for Transformers.js. The base model's upstream metadata declares **MIT**. These weights are used only for local retrieval, not generated dialogue. The four runtime model files were downloaded from the upstream repository and checked against its published LFS SHA256 or Git blob identifiers. They are not modified.

- Base model: https://huggingface.co/intfloat/multilingual-e5-small
- ONNX conversion: https://huggingface.co/Xenova/multilingual-e5-small
- Transformers.js: https://github.com/huggingface/transformers.js
- ONNX Runtime: https://github.com/microsoft/onnxruntime
- Electron: https://www.electronjs.org/

Character artwork was generated using the built-in image generation tool from this project's provided character reference. Expression prompts and review records accompany the project assets. No Live2D model, third-party avatar rig, or extracted copyrighted animation assets are bundled.

Kimi dialogue is an optional user-configured service. No API credentials, model account, or cloud authorization is included in this distribution.

The tool schemas and descriptions follow MoonshotAI Kimi Code 0.29.2 (MIT), using the user's captured OpenAI-compatible contract. The upstream MIT license is included in `dist/licenses/kimi-code-MIT.txt`. The GalAgent execution and orchestration implementation is independent; Kimi Code CLI is not bundled or launched.

Ajv is used for JSON Schema validation (MIT). Sharp/libvips is used for local image decoding; its upstream notices remain in the application dependencies.

Video decoding uses the separate FFmpeg 6.1.1 static Windows executable from ffmpeg-static / gyan.dev. Its GPLv3 license and build/source information are included in `dist/licenses/ffmpeg-GPL.txt` and `dist/licenses/ffmpeg-build.txt`. Upstream source pointer from that build: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 . The wrapper package's MIT notice remains in node_modules. No user media or API credentials are included.

## Acknowledgments

Special thanks to **Gemini4argon**, **opus5.5**, and **gpt-Astra**.
