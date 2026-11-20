class DovoServerNightly < Formula
  desc "Dovo Studio personal agent runtime and pairing CLI"
  homepage "https://github.com/dovocode/dovo-studio"
  version "0.0.9-nightly.1008"
  on_macos do
    depends_on arch: :arm64
    url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1008/Dovo-Server-Nightly-0.0.9-nightly.1008-macos-arm64.tar.gz"
      sha256 "f564092e1aaadabf7a6273a1bb9f0d0b7e97cfdd978ad8fd58195b8793ca410b"
  end
  on_linux do
    on_arm do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1008/Dovo-Server-Nightly-0.0.9-nightly.1008-linux-arm64.tar.gz"
      sha256 "18b64cecb8fbfcac9aef2131b35fd05734ed96911036d0a7867ae189dc0ec11d"
    end
    on_intel do
      url "https://github.com/dovocode/dovo-studio/releases/download/v0.0.9-nightly.1008/Dovo-Server-Nightly-0.0.9-nightly.1008-linux-x64.tar.gz"
      sha256 "705213059b004389d1c481adf73785371e5805faf229c34836e068edbf9badec"
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
