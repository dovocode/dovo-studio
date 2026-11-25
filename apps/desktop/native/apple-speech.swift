import AVFoundation
import Foundation
import Speech

@main
struct AppleSpeech {
  enum Failure: LocalizedError {
    case unavailable
    case locale(String)
    case audio

    var errorDescription: String? {
      switch self {
      case .unavailable: return "Apple Speech is unavailable on this Mac."
      case .locale(let language): return "Apple Speech does not support \(language). Choose another language in Speech settings."
      case .audio: return "Apple Speech could not read the recorded audio."
      }
    }
  }

  static func main() async {
    do {
      guard SpeechTranscriber.isAvailable else { throw Failure.unavailable }
      guard CommandLine.arguments.count == 2 else { throw Failure.unavailable }
      let language = CommandLine.arguments[1]
      if language == "available" { return }
      let preferred = Locale.preferredLanguages.first ?? "en-US"
      let requested = Locale(identifier: language == "auto" ? preferred : language)
      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
        throw Failure.locale(requested.identifier)
      }
      let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
      switch await AssetInventory.status(forModules: [transcriber]) {
      case .installed: break
      case .supported, .downloading:
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
          try await request.downloadAndInstall()
        }
      case .unsupported: throw Failure.locale(requested.identifier)
      @unknown default: throw Failure.unavailable
      }
      try await transcribe(transcriber)
    } catch {
      FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
      exit(1)
    }
  }

  static func emit(_ text: String) {
    let bytes = Data(text.utf8)
    var length = UInt32(bytes.count).littleEndian
    withUnsafeBytes(of: &length) { FileHandle.standardOutput.write(Data($0)) }
    FileHandle.standardOutput.write(bytes)
  }

  static func transcribe(_ transcriber: SpeechTranscriber) async throws {
    guard let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
          let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: pcm)
    else { throw Failure.audio }
    let converter = format == pcm ? nil : AVAudioConverter(from: pcm, to: format)
    if converter == nil && format != pcm { throw Failure.audio }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    try await analyzer.prepareToAnalyze(in: format)

    let (stream, input) = AsyncThrowingStream<AnalyzerInput, Error>.makeStream()
    let collect = Task {
      var finalText: [String] = []
      for try await result in transcriber.results {
        let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        if result.isFinal && !text.isEmpty { finalText.append(text) }
        let preview = result.isFinal || text.isEmpty ? finalText : finalText + [text]
        emit(preview.joined(separator: " "))
      }
    }

    emit("")
    // Stdin is owned by the parent process. EOF finishes recognition and killing this helper cancels it.
    let read = Task.detached {
      do {
        while !Task.isCancelled {
          let data = FileHandle.standardInput.readData(ofLength: 3200)
          if data.isEmpty { break }
          let samples = AVAudioFrameCount(data.count / 2)
          guard data.count.isMultiple(of: 2),
                let buffer = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: samples),
                let target = buffer.int16ChannelData?.pointee
          else { throw Failure.audio }
          buffer.frameLength = samples
          data.copyBytes(to: UnsafeMutableRawBufferPointer(start: target, count: data.count))
          let converted = try convert(buffer, to: format, using: converter)
          if converted.frameLength > 0 { input.yield(AnalyzerInput(buffer: converted)) }
        }
        input.finish()
      } catch {
        input.finish(throwing: error)
      }
    }
    do {
      if let lastSample = try await analyzer.analyzeSequence(stream) {
        try await analyzer.finalizeAndFinish(through: lastSample)
      } else {
        await analyzer.cancelAndFinishNow()
      }
      try await collect.value
    } catch {
      read.cancel()
      collect.cancel()
      await analyzer.cancelAndFinishNow()
      throw error
    }
  }

  static func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat, using converter: AVAudioConverter?) throws -> AVAudioPCMBuffer {
    guard let converter else { return buffer }
    let frames = ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate)
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else {
      throw Failure.audio
    }
    var offered = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      state.pointee = offered ? .noDataNow : .haveData
      if offered { return nil }
      offered = true
      return buffer
    }
    if status == .error { throw error ?? Failure.audio as NSError }
    return output
  }
}
