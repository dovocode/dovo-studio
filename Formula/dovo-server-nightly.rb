class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1040"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1040/Dovo-Server-Nightly-0.0.9-nightly.1040-macos-arm64.tar.gz"
      sha256 "db8b41485969eeb616e176a0189bde8c73d4153e094a2734e95d0b553c0b5c89"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1040/Dovo-Server-Nightly-0.0.9-nightly.1040-linux-arm64.tar.gz"
      sha256 "a783728237e3ed0868b7185b6eea13185f46c699a0eb21458a8a24c70d1b4bc3"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1040/Dovo-Server-Nightly-0.0.9-nightly.1040-linux-x64.tar.gz"
      sha256 "8c50659362cd0d623eec145a8ed48fc05987d540609df4c8b868dccf7cd7c16c"
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
