# Simulator protocol notices

`packages/runtime/src/previews/simulator-protocols.ts` contains reduced, wire-compatible message
schemas from these upstream interfaces. Field numbers and wire types are preserved; unused fields,
services and comments are omitted. Dovo's adapters and transport implementation are original.

- **idb**: Copyright Meta Platforms, Inc. and affiliates. Licensed under the MIT License.
  [Upstream schema](https://github.com/facebook/idb/blob/main/proto/idb.proto). Full notice:
  [idb-MIT.txt](idb-MIT.txt).
- **Android Emulator**: Copyright (C) 2018 The Android Open Source Project. Licensed under the
  Apache License, Version 2.0. Sourced from Android SDK `emulator/lib/emulator_controller.proto`.
  [Upstream schema](https://android.googlesource.com/platform/prebuilts/android-emulator/+/master/linux-x86_64/lib/emulator_controller.proto).
  Full license: [Apache-2.0.txt](Apache-2.0.txt).

idb's MINICAP video format uses the
[documented length-prefixed framing](https://github.com/openstf/minicap#usage). Dovo parses only
that framing. Native image decoding and encoding use Sharp/libvips, and wire serialization uses
protobufjs and grpc-js.
