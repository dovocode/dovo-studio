// Private pipe protocol: stdin is little-endian 16 kHz mono PCM16; EOF finalizes.
// stdout is length-prefixed UTF-8 cumulative text. An empty first frame means ready.
// Keep diagnostics on stderr so model output never becomes protocol data.
#include "transcribe.h"
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static bool emit(const char *text) {
    if (!text) text = "";
    const uint32_t size = static_cast<uint32_t>(std::strlen(text));
    if (size > 100000) return false;
    const unsigned char header[] = {
        static_cast<unsigned char>(size), static_cast<unsigned char>(size >> 8),
        static_cast<unsigned char>(size >> 16), static_cast<unsigned char>(size >> 24)
    };
    return std::fwrite(header, 1, 4, stdout) == 4 &&
           std::fwrite(text, 1, size, stdout) == size && std::fflush(stdout) == 0;
}

int main(int argc, char **argv) {
    if (argc != 4) return 2;
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    transcribe_model_load_params load;
    transcribe_model_load_params_init(&load);
    load.backend = TRANSCRIBE_BACKEND_CPU;
    transcribe_session_params params;
    transcribe_session_params_init(&params);
    params.n_threads = std::atoi(argv[3]);
    transcribe_session *session = nullptr;
    transcribe_status status = transcribe_open(argv[1], &load, &params, &session);
    if (status != TRANSCRIBE_OK) {
        std::fprintf(stderr, "Could not load speech model: %s\n", transcribe_status_string(status));
        return 1;
    }
    transcribe_run_params run;
    transcribe_run_params_init(&run);
    // The generic ABI represents auto detection with a null language hint.
    run.language = std::strcmp(argv[2], "auto") == 0 ? nullptr : argv[2];
    // Use the trained maximum-quality streaming setting (1.12 s chunks).
    status = transcribe_stream_begin(session, &run, nullptr);
    bool ok = status == TRANSCRIBE_OK && emit("");
    unsigned char bytes[17920 * 2];
    float pcm[17920];
    size_t total = 0;
    bool audible = false;
    while (ok) {
        const size_t size = std::fread(bytes, 1, sizeof(bytes), stdin);
        if (size == 0) {
            ok = !std::ferror(stdin);
            break;
        }
        total += size;
        if (size % 2 || total > 16000 * 300 * 2) { ok = false; break; }
        for (size_t i = 0; i < size / 2; ++i) {
            const int value = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
            const int sample = value >= 32768 ? value - 65536 : value;
            pcm[i] = sample / 32768.0f;
            audible = audible || sample != 0;
        }
        transcribe_stream_update update;
        transcribe_stream_update_init(&update);
        status = transcribe_stream_feed(session, pcm, static_cast<int>(size / 2), &update);
        ok = status == TRANSCRIBE_OK;
        if (ok && update.result_changed && audible) ok = emit(transcribe_full_text(session));
        if (size < sizeof(bytes)) { ok = ok && !std::ferror(stdin); break; }
    }
    if (ok) {
        transcribe_stream_update update;
        transcribe_stream_update_init(&update);
        status = transcribe_stream_finalize(session, &update);
        ok = status == TRANSCRIBE_OK && emit(audible ? transcribe_full_text(session) : "");
    }
    if (!ok) std::fprintf(stderr, "Speech streaming failed: %s\n", transcribe_status_string(status));
    transcribe_session_free(session);
    return ok ? 0 : 1;
}
