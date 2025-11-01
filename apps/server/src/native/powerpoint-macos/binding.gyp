{
  "targets": [
    {
      "target_name": "powerpoint_macos",
      "sources": [
        "powerpoint_accessibility.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "13.0"
      },
      "libraries": [
        "-framework Foundation",
        "-framework AppKit",
        "-framework ScriptingBridge",
        "-framework ApplicationServices",
        "-framework AVFoundation",
        "-framework CoreAudio",
        "-framework AudioToolbox",
        "-framework ScreenCaptureKit"
      ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "powerpoint_accessibility.mm" ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }]
      ]
    }
  ]
}

