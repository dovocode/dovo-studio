// Wire-compatible subsets of the upstream native control protocols.
// idb: Copyright Meta Platforms, Inc. MIT; https://github.com/facebook/idb/blob/main/proto/idb.proto
// Emulator: Copyright 2018 AOSP. Apache-2.0; SDK emulator/lib/emulator_controller.proto.
// License notices: docs/licenses/simulator-protocols.md.
export const iosProtocol = `syntax = "proto3"; package idb;
message Empty {}
message Point { double x=1; double y=2; }
message Screen { uint64 width=1; uint64 height=2; double density=3; uint64 width_points=4; uint64 height_points=5; }
message Target { string udid=1; string name=2; Screen screen_dimensions=3; }
message Description { Target target_description=1; }
message HIDEvent {
 message Touch { Point point=1; }
 message Button { int32 button=1; }
 message Key { uint64 keycode=1; }
 message Action { Touch touch=1; Button button=2; Key key=3; }
 message Press { Action action=1; int32 direction=2; }
 message Swipe { Point start=1; Point end=2; double delta=5; double duration=6; }
 Press press=1; Swipe swipe=2;
}
message VideoRequest {
 message Start { string file_path=1; uint64 fps=2; int32 format=3; double compression_quality=4; double scale_factor=5; }
 Start start=1; Empty stop=2;
}
message Payload { bytes data=2; }
message VideoResponse { bytes log_output=1; Payload payload=2; }
`
export const androidProtocol = `syntax = "proto3"; package android.emulation.control;
message Empty {}
message ImageFormat { int32 format=1; uint32 width=3; uint32 height=4; uint32 display=5; }
message Image { ImageFormat format=1; bytes image=4; uint32 seq=5; }
message Touch { int32 x=1; int32 y=2; int32 identifier=3; int32 pressure=4; }
message TouchEvent { repeated Touch touches=1; int32 display=2; }
message KeyboardEvent { int32 codeType=1; int32 eventType=2; int32 keyCode=3; string key=4; string text=5; }
message WheelEvent { int32 dx=1; int32 dy=2; int32 display=3; }
message ClipData { string text=1; }
`
