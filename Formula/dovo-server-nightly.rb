class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1097"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1097/Dovo-Server-Nightly-0.0.9-nightly.1097-macos-arm64.tar.gz"
      sha256 "85f88bbf0495ee9a5bebdfaeeb6fe56982a7cbaa45395db36c34a36930e8b3f0"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1097/Dovo-Server-Nightly-0.0.9-nightly.1097-linux-arm64.tar.gz"
      sha256 "1222bd4545dd476b176ac6c496906569a2a765307a072506431602d8add448cf"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1097/Dovo-Server-Nightly-0.0.9-nightly.1097-linux-x64.tar.gz"
      sha256 "634004220d9b269d610aae47f8dd03a7577d6883d74376cc66d82bc7d0628f5d"
    end
  end
  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/dovo-server-nightly"
  end
  def caveats
    <<~EOS
      Configure: dovo-server-nightly setup
      Start:     dovo-server-nightly start
      Pair:      dovo-server-nightly pair
      Finish active work and stop before upgrading, then start again.
      Data is stored in ~/.dovo by default and is never removed by uninstall.
      This formula does not register an automatic login service.
    EOS
  end
  test do
    assert_match "Usage:", shell_output("#{bin}/dovo-server-nightly --help")
  end
end
